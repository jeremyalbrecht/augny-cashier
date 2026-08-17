import { type H3Event } from "h3";

// Cloudflare D1 over the REST API.
//
// The app is deployed to Azure Static Web Apps, so there is no Workers binding
// available — every query is an authenticated HTTPS round-trip (~100-200 ms).
// That's acceptable because nothing here sits on a hot path: magic codes are
// verified about once a month per member, and push subscriptions are read only
// when reminders are actually sent. The debts data, which IS hot, never leaves
// Google Sheets.
//
// Schema lives in infra/schema.sql; the database itself is created by
// infra/d1.tf.

const API_BASE = "https://api.cloudflare.com/client/v4";

interface D1QueryResult<T> {
  results?: T[];
  success?: boolean;
  meta?: { changes?: number; last_row_id?: number; rows_written?: number };
}

interface D1Response<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result?: D1QueryResult<T>[];
}

/** True when D1 credentials are configured. Callers that must degrade
 *  gracefully (e.g. push sending) can check this instead of catching. */
export function isD1Configured(event: H3Event): boolean {
  const { cloudflare } = useRuntimeConfig(event);
  return Boolean(cloudflare?.accountId && cloudflare?.apiToken && cloudflare?.d1DatabaseId);
}

/**
 * Runs one parameterised statement and returns its rows.
 *
 * Always use `?` placeholders and the `params` array — never interpolate into
 * the SQL string. D1 is SQLite and is just as injectable as any other database.
 */
export async function d1Query<T = Record<string, unknown>>(
  event: H3Event,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { cloudflare } = useRuntimeConfig(event);
  const accountId = cloudflare?.accountId as string;
  const apiToken = cloudflare?.apiToken as string;
  const databaseId = cloudflare?.d1DatabaseId as string;

  if (!accountId || !apiToken || !databaseId) {
    throw new Error(
      "Cloudflare D1 not configured (set NUXT_CLOUDFLARE_ACCOUNT_ID, " +
        "NUXT_CLOUDFLARE_API_TOKEN and NUXT_CLOUDFLARE_D1_DATABASE_ID)",
    );
  }

  const res = await fetch(
    `${API_BASE}/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );

  // A non-2xx still carries a JSON error body describing what went wrong;
  // surface that rather than a bare status code.
  let body: D1Response<T>;
  try {
    body = (await res.json()) as D1Response<T>;
  } catch {
    throw new Error(`D1 request failed (HTTP ${res.status}) with a non-JSON response`);
  }

  if (!body.success) {
    const detail = body.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${res.status}`;
    throw new Error(`D1 query failed — ${detail}`);
  }

  return body.result?.[0]?.results ?? [];
}

/**
 * Runs a statement for its side effect and reports how many rows it changed.
 * Used by the "consume this magic code" update, where 0 changed rows means
 * somebody else consumed it first.
 */
export async function d1Execute(
  event: H3Event,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const { cloudflare } = useRuntimeConfig(event);
  const res = await fetch(
    `${API_BASE}/accounts/${cloudflare.accountId}/d1/database/${cloudflare.d1DatabaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cloudflare.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );

  let body: D1Response<unknown>;
  try {
    body = (await res.json()) as D1Response<unknown>;
  } catch {
    throw new Error(`D1 request failed (HTTP ${res.status}) with a non-JSON response`);
  }
  if (!body.success) {
    const detail = body.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${res.status}`;
    throw new Error(`D1 statement failed — ${detail}`);
  }
  return body.result?.[0]?.meta?.changes ?? 0;
}
