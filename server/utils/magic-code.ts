import { createHash, randomInt, randomBytes, timingSafeEqual } from "node:crypto";

// Magic-link code generation and validation rules.
//
// Pure — no I/O, no D1 — so the security-relevant rules (expiry, single use,
// attempt limit) are unit-testable in isolation, same contract as debts.ts.

/** How long a code / link stays valid. Short, because the e-mail arrives in
 *  seconds and a stale code is a standing risk. */
export const CODE_TTL_MS = 15 * 60 * 1000;

/** Wrong-code guesses allowed before the row is dead. A 6-digit code has a
 *  1-in-a-million hit rate, so 5 tries is generous without being brute-forceable. */
export const MAX_ATTEMPTS = 5;

/** Magic-link requests allowed per identifier per hour. */
export const MAX_REQUESTS_PER_HOUR = 5;
export const RATE_WINDOW_MS = 60 * 60 * 1000;

/** The subset of a `magic_codes` row the validation rules care about. */
export interface MagicCodeRow {
  id: number;
  code_hash: string;
  token_hash: string;
  expires_at: number;
  used_at: number | null;
  attempts: number;
}

/**
 * A 6-digit numeric code, zero-padded. `randomInt` is the CSPRNG — `Math.random`
 * would make codes predictable from a handful of observations.
 */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** A 32-byte URL-safe token for the one-tap link. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256 hex. Codes and tokens are only ever stored hashed, so a leak of the
 * magic_codes table doesn't let anyone log in. No salt or slow KDF: these are
 * high-entropy, single-use and expire in 15 minutes, so the offline-cracking
 * threat a password hash defends against doesn't apply.
 */
export function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type ConsumeFailure = "expired" | "already-used" | "too-many-attempts" | "wrong-code";

/**
 * Whether a row is still in a usable state, ignoring the code value itself.
 * Order matters only for the failure reason we report internally — the caller
 * shows the user the same generic message either way.
 */
export function checkConsumable(
  row: MagicCodeRow,
  now: number = Date.now(),
): { ok: true } | { ok: false; reason: ConsumeFailure } {
  if (row.used_at != null) return { ok: false, reason: "already-used" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "too-many-attempts" };
  if (now >= row.expires_at) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** Full check for the typed-code path: state plus the code itself. */
export function verifyCode(
  row: MagicCodeRow,
  submittedCode: string,
  now: number = Date.now(),
): { ok: true } | { ok: false; reason: ConsumeFailure } {
  const state = checkConsumable(row, now);
  if (!state.ok) return state;
  if (!hashesEqual(hash(submittedCode), row.code_hash)) {
    return { ok: false, reason: "wrong-code" };
  }
  return { ok: true };
}

/** Expiry timestamp for a code minted now. */
export function expiryFrom(now: number = Date.now()): number {
  return now + CODE_TTL_MS;
}

/** Whether another magic-link request is allowed, given recent request times. */
export function withinRateLimit(
  recentRequestTimes: number[],
  now: number = Date.now(),
): boolean {
  const cutoff = now - RATE_WINDOW_MS;
  const recent = recentRequestTimes.filter((t) => t > cutoff);
  return recent.length < MAX_REQUESTS_PER_HOUR;
}
