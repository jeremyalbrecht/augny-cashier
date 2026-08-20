import { randomUUID } from "node:crypto";
import { google } from "googleapis";
import type { H3Event } from "h3";

// Google Cloud Firestore (Native mode) over its REST API.
//
// Reuses the SAME service account already used for Google Sheets (`NUXT_SA`)
// — no new secret to create or rotate, and the club's GCP project is already
// dedicated to this app, so `roles/datastore.user` on it is no broader a
// grant than the Sheets access already in place. This replaced Cloudflare D1:
// a D1 API token has no way to scope below "every D1 database in the
// account," while this stays inside the same project boundary as everything
// else the app touches.
//
// Free-tier Firestore does not support TTL-based auto-deletion (that needs
// billing enabled) — not a regression, since D1 never had it either. Expiry
// was always enforced in application code (see magic-code.ts's
// `checkConsumable`) and cleanup is a best-effort delete-on-write, same as
// before.
//
// Everything here goes through a single `commit` call for writes (create,
// conditional update, delete, increment) and `runQuery` for reads, mirroring
// Firestore's own transactional write model rather than mixing REST verbs.

const API_BASE = "https://firestore.googleapis.com/v1";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const DATABASE_ID = "(default)";

type FsPrimitive = string | number | boolean | null;
export type FsFields = Record<string, FsPrimitive>;

interface FsDoc<T> {
  id: string;
  fields: T;
  /** Opaque version stamp — pass back as `ifUpdateTime` for an atomic
   *  compare-and-swap update (the Firestore equivalent of a SQL `WHERE`
   *  guard on a plain `UPDATE`). */
  updateTime: string;
}

interface ServiceAccountCredentials {
  project_id: string;
  [key: string]: unknown;
}

function decodeCredentials(event: H3Event): ServiceAccountCredentials | null {
  const { sa } = useRuntimeConfig(event);
  if (!sa) return null;
  try {
    return JSON.parse(Buffer.from(sa as string, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function isFirestoreConfigured(event: H3Event): boolean {
  return decodeCredentials(event) !== null;
}

async function connection(event: H3Event): Promise<{ token: string; projectId: string }> {
  const credentials = decodeCredentials(event);
  if (!credentials) {
    throw new Error("Firestore not configured (NUXT_SA is missing or not valid base64 JSON)");
  }
  const auth = new google.auth.GoogleAuth({ credentials, scopes: [FIRESTORE_SCOPE] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to obtain a Firestore access token");
  return { token, projectId: credentials.project_id };
}

function databasePath(projectId: string): string {
  return `projects/${projectId}/databases/${DATABASE_ID}`;
}

function docName(projectId: string, collection: string, id: string): string {
  return `${databasePath(projectId)}/documents/${collection}/${id}`;
}

function encodeValue(v: FsPrimitive): Record<string, unknown> {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return { integerValue: String(Math.trunc(v)) };
  return { stringValue: v };
}

function decodeValue(v: Record<string, unknown>): FsPrimitive {
  if ("stringValue" in v) return v.stringValue as string;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue as number;
  if ("booleanValue" in v) return v.booleanValue as boolean;
  return null;
}

function encodeFields(fields: FsFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = encodeValue(v);
  return out;
}

function decodeFields<T>(fields: Record<string, Record<string, unknown>> | undefined): T {
  const out: Record<string, FsPrimitive> = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = decodeValue(v);
  return out as T;
}

async function request(
  event: H3Event,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const { token } = await connection(event);
  const res = await fetch(`${API_BASE}/${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = body.error as { status?: string; message?: string } | undefined;
    const err = new Error(`Firestore request failed — ${error?.message ?? res.status}`) as Error & {
      status?: string;
    };
    err.status = error?.status;
    throw err;
  }
  return body;
}

/** Fetch a single document by its known ID. Returns null if it doesn't exist. */
export async function fsGet<T>(event: H3Event, collection: string, id: string): Promise<FsDoc<T> | null> {
  const { projectId } = await connection(event);
  try {
    const body = await request(event, docName(projectId, collection, id));
    return { id, fields: decodeFields<T>(body.fields as never), updateTime: body.updateTime as string };
  } catch (e) {
    if ((e as { status?: string }).status === "NOT_FOUND") return null;
    throw e;
  }
}

export interface FsWhere {
  field: string;
  op: "EQUAL" | "LESS_THAN" | "GREATER_THAN" | "IN";
  value: FsPrimitive | FsPrimitive[];
}

export interface FsQueryOptions {
  where?: FsWhere[];
  orderBy?: { field: string; direction?: "ASCENDING" | "DESCENDING" }[];
  limit?: number;
}

/**
 * Structured query over a collection. Equality-plus-range/order queries on
 * different fields (e.g. `email == X order by created_at`) need a composite
 * index — see infra/firestore.tf, which declares every index these queries
 * require.
 */
export async function fsQuery<T>(
  event: H3Event,
  collection: string,
  opts: FsQueryOptions = {},
): Promise<FsDoc<T>[]> {
  const { projectId } = await connection(event);

  const toFilter = (w: FsWhere) => ({
    fieldFilter: {
      field: { fieldPath: w.field },
      op: w.op,
      value:
        w.op === "IN"
          ? { arrayValue: { values: (w.value as FsPrimitive[]).map(encodeValue) } }
          : encodeValue(w.value as FsPrimitive),
    },
  });

  const filters = (opts.where ?? []).map(toFilter);
  const structuredQuery: Record<string, unknown> = { from: [{ collectionId: collection }] };
  if (filters.length === 1) structuredQuery.where = filters[0];
  else if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: "AND", filters } };
  if (opts.orderBy) {
    structuredQuery.orderBy = opts.orderBy.map((o) => ({
      field: { fieldPath: o.field },
      direction: o.direction ?? "ASCENDING",
    }));
  }
  if (opts.limit) structuredQuery.limit = opts.limit;

  const body = await request(event, `${databasePath(projectId)}/documents:runQuery`, {
    method: "POST",
    body: { structuredQuery },
  });
  const rows = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
  return rows
    .filter((r) => r.document)
    .map((r) => {
      const document = r.document as { name: string; fields?: Record<string, never>; updateTime: string };
      return {
        id: document.name.split("/").pop() as string,
        fields: decodeFields<T>(document.fields),
        updateTime: document.updateTime,
      };
    });
}

interface FsWrite {
  update?: { name: string; fields: Record<string, unknown> };
  delete?: string;
  updateMask?: { fieldPaths: string[] };
  currentDocument?: { exists?: boolean; updateTime?: string };
  transform?: { document: string; fieldTransforms: unknown[] };
}

async function commit(event: H3Event, writes: FsWrite[]): Promise<boolean> {
  const { projectId } = await connection(event);
  try {
    await request(event, `${databasePath(projectId)}/documents:commit`, { method: "POST", body: { writes } });
    return true;
  } catch (e) {
    const status = (e as { status?: string }).status;
    if (status === "FAILED_PRECONDITION" || status === "ABORTED" || status === "ALREADY_EXISTS") return false;
    throw e;
  }
}

/** Creates a new document with a random ID (or the given one) and every field
 *  in `fields`. Returns the document ID. */
export async function fsCreate(
  event: H3Event,
  collection: string,
  fields: FsFields,
  id: string = randomUUID(),
): Promise<string> {
  const { projectId } = await connection(event);
  const ok = await commit(event, [
    {
      update: { name: docName(projectId, collection, id), fields: encodeFields(fields) },
      currentDocument: { exists: false },
    },
  ]);
  if (!ok) throw new Error(`Firestore create failed — document ${collection}/${id} already exists`);
  return id;
}

/**
 * Replaces the listed fields on an existing document, leaving every other
 * field untouched. With `ifUpdateTime`, the write is a compare-and-swap: it
 * silently fails (returns false) if the document changed since that
 * `updateTime` was read — this is what makes single-use consumption
 * race-free, the same job `WHERE used_at IS NULL` did in D1.
 */
export async function fsPatch(
  event: H3Event,
  collection: string,
  id: string,
  fields: FsFields,
  opts: { ifUpdateTime?: string } = {},
): Promise<boolean> {
  const { projectId } = await connection(event);
  return commit(event, [
    {
      update: { name: docName(projectId, collection, id), fields: encodeFields(fields) },
      updateMask: { fieldPaths: Object.keys(fields) },
      ...(opts.ifUpdateTime ? { currentDocument: { updateTime: opts.ifUpdateTime } } : {}),
    },
  ]);
}

/** Upserts a document at a caller-chosen (deterministic) ID: creates it with
 *  every field in `fields` if absent, or replaces just `updateFields` if
 *  present. Mirrors `INSERT ... ON CONFLICT (...) DO UPDATE SET ...`. */
export async function fsUpsert(
  event: H3Event,
  collection: string,
  id: string,
  fields: FsFields,
  updateFields: string[],
): Promise<void> {
  const existing = await fsGet(event, collection, id);
  if (existing) {
    const patch: FsFields = {};
    for (const f of updateFields) patch[f] = fields[f];
    await fsPatch(event, collection, id, patch);
  } else {
    await fsCreate(event, collection, fields, id);
  }
}

export async function fsDelete(event: H3Event, collection: string, id: string): Promise<void> {
  const { projectId } = await connection(event);
  await commit(event, [{ delete: docName(projectId, collection, id) }]);
}

/** Deletes every document matching `where`, in one atomic batch. Returns how
 *  many rows matched. Firestore caps a single query/commit at 500 documents,
 *  which every caller here is far under. */
export async function fsDeleteWhere(event: H3Event, collection: string, where: FsWhere[]): Promise<number> {
  const rows = await fsQuery(event, collection, { where, limit: 500 });
  if (rows.length === 0) return 0;
  const { projectId } = await connection(event);
  await commit(
    event,
    rows.map((r) => ({ delete: docName(projectId, collection, r.id) })),
  );
  return rows.length;
}

/** Atomically creates several documents (random IDs) in one batch — either
 *  all land or none do, matching a single multi-row SQL INSERT. */
export async function fsCreateMany(event: H3Event, collection: string, rows: FsFields[]): Promise<void> {
  if (rows.length === 0) return;
  const { projectId } = await connection(event);
  const ok = await commit(
    event,
    rows.map((fields) => ({
      update: { name: docName(projectId, collection, randomUUID()), fields: encodeFields(fields) },
      currentDocument: { exists: false },
    })),
  );
  if (!ok) throw new Error(`Firestore batch create failed for collection ${collection}`);
}
