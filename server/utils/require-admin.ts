import { createError, type H3Event } from "h3";
import { getSheetData } from "#server/utils/fetch";

const CACHE_TTL_MS = 60_000;
let cache: { fetchedAt: number; emails: Set<string> } | null = null;

async function loadAllowlist(event: H3Event): Promise<Set<string>> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.emails;

  const spreadsheetId = process.env.GOOGLE_SHEET_ID || "";
  const { sa } = useRuntimeConfig(event);
  const rows = await getSheetData({ spreadsheetId, range: "Comité!A1:A100", credentialsRaw: sa });

  // Be defensive about the header name in column A — pull the first value out
  // of each row regardless of what it's called, then keep only email-looking
  // strings. That way the Comité sheet doesn't need a specific header.
  const emails = new Set<string>();
  for (const row of rows) {
    const first = Object.values(row)[0];
    if (typeof first === "string" && first.includes("@")) {
      emails.add(first.trim().toLowerCase());
    }
  }

  cache = { fetchedAt: now, emails };
  return emails;
}

/**
 * Guard for admin-only routes. Requires a logged-in Google session whose email
 * is in the Comité sheet. Throws 401 if not logged in, 403 if not allowlisted.
 *
 * The User session shape is augmented in /auth.d.ts at the project root.
 */
export async function requireAdmin(event: H3Event): Promise<{ email: string; name?: string }> {
  const session = await getUserSession(event);
  const user = session?.user;
  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const allowed = await loadAllowlist(event);
  if (!allowed.has(user.email.toLowerCase())) {
    throw createError({ statusCode: 403, statusMessage: "Not authorized" });
  }

  return { email: user.email, name: user.name };
}
