import { describe, it, expect } from "vitest";
import {
  generateCode,
  generateToken,
  hash,
  hashesEqual,
  checkConsumable,
  verifyCode,
  expiryFrom,
  withinRateLimit,
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  MAX_REQUESTS_PER_HOUR,
  type MagicCodeRow,
} from "../server/utils/magic-code";

const NOW = 1_700_000_000_000;

function row(overrides: Partial<MagicCodeRow> = {}): MagicCodeRow {
  return {
    id: 1,
    code_hash: hash("123456"),
    token_hash: hash("tok"),
    expires_at: NOW + CODE_TTL_MS,
    used_at: null,
    attempts: 0,
    ...overrides,
  };
}

describe("generateCode", () => {
  it("is always 6 digits, zero-padded", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });
  it("produces varied values", () => {
    const seen = new Set(Array.from({ length: 100 }, () => generateCode()));
    expect(seen.size).toBeGreaterThan(50);
  });
});

describe("generateToken", () => {
  it("is URL-safe (no +, / or = to mangle in a query string)", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(seen.size).toBe(200);
  });
});

describe("hash", () => {
  it("never returns the plaintext", () => {
    expect(hash("123456")).not.toBe("123456");
    expect(hash("123456")).toMatch(/^[a-f0-9]{64}$/);
  });
  it("is deterministic", () => {
    expect(hash("abc")).toBe(hash("abc"));
  });
  it("differs for different inputs", () => {
    expect(hash("123456")).not.toBe(hash("123457"));
  });
});

describe("hashesEqual", () => {
  it("matches identical digests", () => {
    expect(hashesEqual(hash("x"), hash("x"))).toBe(true);
  });
  it("rejects different digests", () => {
    expect(hashesEqual(hash("x"), hash("y"))).toBe(false);
  });
  it("rejects different lengths without throwing", () => {
    // timingSafeEqual throws on length mismatch — the guard must catch it.
    expect(() => hashesEqual("abc", hash("x"))).not.toThrow();
    expect(hashesEqual("abc", hash("x"))).toBe(false);
  });
});

describe("checkConsumable", () => {
  it("accepts a fresh unused row", () => {
    expect(checkConsumable(row(), NOW)).toEqual({ ok: true });
  });

  it("rejects a row already consumed", () => {
    expect(checkConsumable(row({ used_at: NOW - 1000 }), NOW)).toEqual({
      ok: false,
      reason: "already-used",
    });
  });

  it("rejects once the attempt limit is reached", () => {
    expect(checkConsumable(row({ attempts: MAX_ATTEMPTS }), NOW)).toEqual({
      ok: false,
      reason: "too-many-attempts",
    });
  });

  it("still accepts on the last permitted attempt", () => {
    expect(checkConsumable(row({ attempts: MAX_ATTEMPTS - 1 }), NOW)).toEqual({ ok: true });
  });

  describe("expiry boundary", () => {
    it("accepts one millisecond before expiry", () => {
      const r = row({ expires_at: NOW + 1 });
      expect(checkConsumable(r, NOW)).toEqual({ ok: true });
    });
    it("rejects exactly at expiry", () => {
      const r = row({ expires_at: NOW });
      expect(checkConsumable(r, NOW)).toEqual({ ok: false, reason: "expired" });
    });
    it("rejects after expiry", () => {
      const r = row({ expires_at: NOW - 1 });
      expect(checkConsumable(r, NOW)).toEqual({ ok: false, reason: "expired" });
    });
  });
});

describe("verifyCode", () => {
  it("accepts the correct code", () => {
    expect(verifyCode(row(), "123456", NOW)).toEqual({ ok: true });
  });

  it("rejects the wrong code", () => {
    expect(verifyCode(row(), "999999", NOW)).toEqual({ ok: false, reason: "wrong-code" });
  });

  it("rejects a consumed row even with the correct code", () => {
    // Single-use is the point: knowing the code must not be enough twice.
    const consumed = row({ used_at: NOW - 1 });
    expect(verifyCode(consumed, "123456", NOW)).toEqual({ ok: false, reason: "already-used" });
  });

  it("rejects an expired row even with the correct code", () => {
    const expired = row({ expires_at: NOW - 1 });
    expect(verifyCode(expired, "123456", NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a locked-out row before ever comparing the code", () => {
    const locked = row({ attempts: MAX_ATTEMPTS });
    expect(verifyCode(locked, "123456", NOW)).toEqual({ ok: false, reason: "too-many-attempts" });
  });

  it("is not fooled by a code that hashes to a different value", () => {
    expect(verifyCode(row(), "12345", NOW).ok).toBe(false);
    expect(verifyCode(row(), "1234567", NOW).ok).toBe(false);
    expect(verifyCode(row(), "", NOW).ok).toBe(false);
  });
});

describe("expiryFrom", () => {
  it("is exactly the TTL ahead", () => {
    expect(expiryFrom(NOW)).toBe(NOW + CODE_TTL_MS);
  });
  it("produces a row that is immediately consumable", () => {
    expect(checkConsumable(row({ expires_at: expiryFrom(NOW) }), NOW)).toEqual({ ok: true });
  });
});

describe("withinRateLimit", () => {
  it("allows the first request", () => {
    expect(withinRateLimit([], NOW)).toBe(true);
  });

  it("allows up to the limit", () => {
    const times = Array.from({ length: MAX_REQUESTS_PER_HOUR - 1 }, () => NOW - 1000);
    expect(withinRateLimit(times, NOW)).toBe(true);
  });

  it("blocks once the limit is reached", () => {
    const times = Array.from({ length: MAX_REQUESTS_PER_HOUR }, () => NOW - 1000);
    expect(withinRateLimit(times, NOW)).toBe(false);
  });

  it("ignores requests outside the window", () => {
    // An attacker probing licence numbers all day must not be permanently
    // locked out, but neither should old attempts count against a real member.
    const old = Array.from({ length: 50 }, () => NOW - 2 * 60 * 60 * 1000);
    expect(withinRateLimit(old, NOW)).toBe(true);
  });

  it("counts only the in-window requests when both are present", () => {
    const times = [
      ...Array.from({ length: 20 }, () => NOW - 2 * 60 * 60 * 1000),
      ...Array.from({ length: MAX_REQUESTS_PER_HOUR }, () => NOW - 60_000),
    ];
    expect(withinRateLimit(times, NOW)).toBe(false);
  });
});
