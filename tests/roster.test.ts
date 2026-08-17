import { describe, it, expect } from "vitest";
import {
  normaliseEmail,
  normaliseLicence,
  toRoster,
  findPlayerByEmail,
  findPlayersByEmail,
  findPlayerByIdentifier,
} from "../server/utils/roster";
import type { JoueurRow } from "../server/utils/debts";

// Rows shaped the way getSheetData actually returns them: blank cells become
// null, and Licence comes back as a number when the sheet cell isn't text.
const JOUEURS: JoueurRow[] = [
  { Nom: "Alice Martin", Email: "Alice.Martin@Example.COM", Licence: "07012345" },
  { Nom: "Bob Durand", Email: "bob@example.com", Licence: 7654321 },
  { Nom: "Chloé Petit", Email: null as unknown as string, Licence: "07099999" },
  { Nom: "Zéro Test", Email: "zero@example.com", Licence: "0" },
];

describe("normaliseEmail", () => {
  it("lowercases and trims", () => {
    expect(normaliseEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
  it("maps null/undefined to empty string", () => {
    expect(normaliseEmail(null)).toBe("");
    expect(normaliseEmail(undefined)).toBe("");
  });
});

describe("normaliseLicence", () => {
  it("strips spaces, dashes and dots", () => {
    expect(normaliseLicence("07 01-23.45")).toBe("7012345");
  });
  it("drops leading zeros so 0012345 === 12345", () => {
    expect(normaliseLicence("0012345")).toBe("12345");
    expect(normaliseLicence("12345")).toBe("12345");
  });
  it("accepts a number (sheet cell formatted as numeric)", () => {
    expect(normaliseLicence(7654321)).toBe("7654321");
  });
  it("does not reduce a lone zero to the empty string", () => {
    // Guards the `(?=.)` lookahead — without it "0" would normalise to "" and
    // then match every player whose licence cell is blank.
    expect(normaliseLicence("0")).toBe("0");
  });
  it("maps blank input to empty string", () => {
    expect(normaliseLicence("")).toBe("");
    expect(normaliseLicence(null)).toBe("");
  });
});

describe("toRoster", () => {
  const roster = toRoster(JOUEURS);

  it("normalises emails and licences", () => {
    expect(roster[0]).toEqual({
      name: "Alice Martin",
      email: "alice.martin@example.com",
      licence: "7012345",
    });
  });
  it("leaves email undefined when the cell is blank", () => {
    expect(roster[2]!.email).toBeUndefined();
    expect(roster[2]!.name).toBe("Chloé Petit");
  });
  it("skips rows with no Nom — the key every other sheet joins on", () => {
    const withBlank = toRoster([...JOUEURS, { Nom: "  ", Email: "ghost@example.com" }]);
    expect(withBlank).toHaveLength(JOUEURS.length);
  });
});

describe("findPlayerByEmail", () => {
  const roster = toRoster(JOUEURS);

  it("matches case-insensitively", () => {
    expect(findPlayerByEmail(roster, "ALICE.MARTIN@example.com")?.name).toBe("Alice Martin");
  });
  it("returns null for an unknown address", () => {
    expect(findPlayerByEmail(roster, "nobody@example.com")).toBeNull();
  });
  it("returns null for empty input rather than matching a blank cell", () => {
    // Chloé has no email; an empty query must not resolve to her.
    expect(findPlayerByEmail(roster, "")).toBeNull();
  });
});

describe("findPlayersByEmail — shared family addresses", () => {
  // A parent and two children on one address, interleaved with an unrelated
  // player to prove the filter isn't just taking a contiguous run.
  const FAMILY: JoueurRow[] = [
    { Nom: "DUPONT Marc", Email: "famille.dupont@example.com", Licence: "1000001" },
    { Nom: "AUTRE Personne", Email: "autre@example.com", Licence: "1000002" },
    { Nom: "DUPONT Léa", Email: "Famille.Dupont@Example.com", Licence: "1000003" },
    { Nom: "DUPONT Tom", Email: "famille.dupont@example.com ", Licence: "1000004" },
  ];
  const roster = toRoster(FAMILY);

  it("returns every player on the address", () => {
    const found = findPlayersByEmail(roster, "famille.dupont@example.com");
    expect(found.map((p) => p.name)).toEqual(["DUPONT Marc", "DUPONT Léa", "DUPONT Tom"]);
  });

  it("groups regardless of case and stray whitespace in the sheet", () => {
    expect(findPlayersByEmail(roster, "  FAMILLE.DUPONT@EXAMPLE.COM ")).toHaveLength(3);
  });

  it("does not pull in unrelated players", () => {
    expect(findPlayersByEmail(roster, "autre@example.com").map((p) => p.name)).toEqual([
      "AUTRE Personne",
    ]);
  });

  it("returns an empty array for an unknown address", () => {
    expect(findPlayersByEmail(roster, "nobody@example.com")).toEqual([]);
  });

  it("returns an empty array for blank input rather than matching blank cells", () => {
    expect(findPlayersByEmail(roster, "")).toEqual([]);
  });

  it("preserves roster order", () => {
    // Order is stable but carries no meaning — the first row is not
    // necessarily the account holder (the live sheet has an address where the
    // child is listed first), which is why the UI labels a household by its
    // e-mail rather than by a name.
    expect(findPlayersByEmail(roster, "famille.dupont@example.com")[0]!.name).toBe("DUPONT Marc");
  });

  it("findPlayerByEmail stays consistent with the plural form", () => {
    expect(findPlayerByEmail(roster, "famille.dupont@example.com")!.name).toBe(
      findPlayersByEmail(roster, "famille.dupont@example.com")[0]!.name,
    );
  });

  it("a licence identifier resolves to that one player, not the whole family", () => {
    // Licences are per-player; the account grouping happens afterwards, from
    // the resolved player's e-mail.
    const child = findPlayerByIdentifier(roster, "1000003");
    expect(child?.name).toBe("DUPONT Léa");
    expect(findPlayersByEmail(roster, child!.email!)).toHaveLength(3);
  });
});

describe("findPlayerByIdentifier", () => {
  const roster = toRoster(JOUEURS);

  it("treats input containing @ as an email", () => {
    expect(findPlayerByIdentifier(roster, "bob@example.com")?.name).toBe("Bob Durand");
  });
  it("matches a licence stored as text", () => {
    expect(findPlayerByIdentifier(roster, "07012345")?.name).toBe("Alice Martin");
  });
  it("matches a licence stored as a number", () => {
    expect(findPlayerByIdentifier(roster, "7654321")?.name).toBe("Bob Durand");
  });
  it("tolerates the leading zeros members actually type", () => {
    expect(findPlayerByIdentifier(roster, "7012345")?.name).toBe("Alice Martin");
    expect(findPlayerByIdentifier(roster, "  07 01 23 45 ")?.name).toBe("Alice Martin");
  });
  it("returns a matched player even when they have no email on file", () => {
    // The caller must be able to tell "no such member" from "member we cannot
    // reach" so it can log the second case server-side — while showing the
    // user the same generic message either way.
    const found = findPlayerByIdentifier(roster, "07099999");
    expect(found?.name).toBe("Chloé Petit");
    expect(found?.email).toBeUndefined();
  });
  it("returns null for unknown identifiers", () => {
    expect(findPlayerByIdentifier(roster, "99999999")).toBeNull();
    expect(findPlayerByIdentifier(roster, "nobody@example.com")).toBeNull();
  });
  it("returns null for blank input", () => {
    expect(findPlayerByIdentifier(roster, "")).toBeNull();
    expect(findPlayerByIdentifier(roster, "   ")).toBeNull();
  });
});
