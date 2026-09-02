/**
 * Contracts under test:
 *
 *  - the three-layer resolution (`account override → fleet default →
 *    embedded default`) and the two signals the server's resolved view cannot
 *    give: `shadowsFleet` and `pinsFleet`;
 *  - the style guide's §4.2 palette agreement — red iff `"author"`, amber iff
 *    `"waiting"`, and the `✕` glyph set is exactly the author kinds;
 *  - the health strip's UNKNOWN-not-zero rule (R6/R1);
 *  - the per-file comparison the multi-file version diff is built on.
 */

import { describe, expect, it } from "vitest";
import type { AgentTextUnit } from "@/lib/api/agent-text-units";
import { UNIT_KIND_CONFIGS, KIND_COMMAND, KIND_SKILL } from "../types";
import {
  ATTENTION_BY_KIND,
  AUTHOR_GLYPH_KINDS,
  STATUS_BADGE_CLASS,
  UNIT_FILTERS,
  buildUnitRows,
  countByStatus,
  deriveCorpusHealth,
  diffFileSets,
  filterCounts,
  matchesFilter,
  matchesQuery,
  rowAccentClass,
  statusOf,
  totalBytes,
  type UnitStatusKind,
} from "./unitRows";

const COMMAND = UNIT_KIND_CONFIGS[KIND_COMMAND];
const SKILL = UNIT_KIND_CONFIGS[KIND_SKILL];

function unit(overrides: Partial<AgentTextUnit> & { name: string }): AgentTextUnit {
  return {
    id: `id-${overrides.name}-${overrides.source ?? "user"}`,
    organization_id: overrides.source === "fleet" ? null : "org-1",
    created_by_user_id: null,
    kind: KIND_COMMAND,
    files: { [`${overrides.name}.md`]: "body" },
    entrypoint: `${overrides.name}.md`,
    checksum: "sha256-aaa",
    is_shared: false,
    is_invocable: true,
    current_version: 1,
    source: "user",
    source_path: null,
    source_commit: null,
    created_at: "2026-08-24T10:00:00Z",
    updated_at: "2026-08-24T10:00:00Z",
    ...overrides,
  };
}

describe("buildUnitRows", () => {
  it("resolves account over fleet, and fleet over embedded", () => {
    const rows = buildUnitRows(
      COMMAND,
      [unit({ name: "implement-plan" })],
      [unit({ name: "vet-plan", source: "fleet", checksum: "sha256-bbb" })]
    );

    // implement-plan resolves from the account layer, vet-plan from the fleet
    // layer; the known-embedded seed names both, so nothing extra appears.
    expect(rows.map((r) => r.name)).toEqual(["implement-plan", "vet-plan"]);
    expect(rows[0].layer).toBe("account");
    expect(rows[1].layer).toBe("fleet");
  });

  it("shows a known-embedded name with no stored row as embedded", () => {
    const rows = buildUnitRows(COMMAND, [], []);
    expect(rows).toHaveLength(COMMAND.knownEmbedded.length);
    for (const row of rows) {
      expect(row.layer).toBe("embedded");
      expect(row.resolved).toBeNull();
      expect(statusOf(row).kind).toBe("embedded-only");
    }
  });

  it("keeps a name that is in neither the seed nor one layer out of the list", () => {
    const rows = buildUnitRows(COMMAND, [], []);
    expect(rows.some((r) => r.name === "coord-revive")).toBe(false);
  });

  it("flags an override that SHADOWS a stored fleet default", () => {
    const rows = buildUnitRows(
      COMMAND,
      [unit({ name: "vet-plan", checksum: "sha256-account" })],
      [unit({ name: "vet-plan", source: "fleet", checksum: "sha256-fleet" })]
    );
    const row = rows.find((r) => r.name === "vet-plan")!;
    expect(row.shadowsFleet).toBe(true);
    expect(row.pinsFleet).toBe(false);
    expect(statusOf(row).kind).toBe("account-override");
  });

  it("flags an override that PINS the fleet default (identical checksums)", () => {
    const rows = buildUnitRows(
      COMMAND,
      [unit({ name: "vet-plan", checksum: "sha256-same" })],
      [unit({ name: "vet-plan", source: "fleet", checksum: "sha256-same" })]
    );
    const row = rows.find((r) => r.name === "vet-plan")!;
    expect(row.pinsFleet).toBe(true);
    expect(statusOf(row).kind).toBe("account-pinned");
    expect(statusOf(row).attention).toBe("author");
  });

  it("treats a null checksum as UNKNOWN, never as equal", () => {
    const rows = buildUnitRows(
      COMMAND,
      [unit({ name: "vet-plan", checksum: null })],
      [unit({ name: "vet-plan", source: "fleet", checksum: null })]
    );
    expect(rows.find((r) => r.name === "vet-plan")!.pinsFleet).toBe(false);
  });

  it("ignores units of another kind handed to it", () => {
    const rows = buildUnitRows(
      SKILL,
      [unit({ name: "vet-plan", kind: KIND_COMMAND })],
      [unit({ name: "coord-revive", kind: KIND_SKILL, source: "fleet" })]
    );
    expect(rows.map((r) => r.name)).toEqual(["coord-revive"]);
  });

  it("derives invocability from the name for a unit that has no row yet", () => {
    const rows = buildUnitRows(
      { ...COMMAND, knownEmbedded: ["_gate-registration", "vet-plan"] },
      [],
      []
    );
    expect(rows.find((r) => r.name === "_gate-registration")!.isInvocable).toBe(
      false
    );
    expect(rows.find((r) => r.name === "vet-plan")!.isInvocable).toBe(true);
  });

  it("takes invocability from the stored row when one exists", () => {
    const rows = buildUnitRows(
      COMMAND,
      [unit({ name: "vet-plan", is_invocable: false })],
      []
    );
    expect(rows.find((r) => r.name === "vet-plan")!.isInvocable).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// The palette contract (console style guide §4.2)
// -----------------------------------------------------------------------------

describe("ATTENTION_BY_KIND — the colour/attention contract", () => {
  it("keys the badge palette off attention — red only for author-action", () => {
    for (const [kind, attention] of Object.entries(ATTENTION_BY_KIND)) {
      const cls = STATUS_BADGE_CLASS[kind as UnitStatusKind];
      expect(cls, `${kind} has no badge class`).toBeTruthy();
      expect(/\bbg-red-/.test(cls), `${kind} red?`).toBe(attention === "author");
      expect(/\bbg-amber-/.test(cls), `${kind} amber?`).toBe(
        attention === "waiting"
      );
    }
  });

  it("carries the ✕ glyph on exactly the author kinds", () => {
    for (const [kind, attention] of Object.entries(ATTENTION_BY_KIND)) {
      expect(
        AUTHOR_GLYPH_KINDS.has(kind as UnitStatusKind),
        `${kind} glyph?`
      ).toBe(attention === "author");
    }
  });

  it("gives every kind a badge class and a label, with no orphans", () => {
    expect(Object.keys(STATUS_BADGE_CLASS).sort()).toEqual(
      Object.keys(ATTENTION_BY_KIND).sort()
    );
  });

  it("puts a left accent on an author row and nothing on a calm one", () => {
    expect(rowAccentClass({ attention: "author" })).toContain("border-l-red");
    expect(rowAccentClass({ attention: "none" })).toBe("");
  });
});

// -----------------------------------------------------------------------------
// Health strip + filters
// -----------------------------------------------------------------------------

describe("deriveCorpusHealth", () => {
  it("renders every count as – before the fetch lands, never 0", () => {
    const health = deriveCorpusHealth(COMMAND, [], false);
    expect(health.level).toBe("unknown");
    expect(health.badges.map((b) => b.value)).toEqual(["–", "–", "–", "–"]);
  });

  it("is calm when nothing is pinned", () => {
    const rows = buildUnitRows(
      COMMAND,
      [unit({ name: "vet-plan", checksum: "sha256-account" })],
      [unit({ name: "vet-plan", source: "fleet", checksum: "sha256-fleet" })]
    );
    const health = deriveCorpusHealth(COMMAND, rows, true);
    expect(health.level).toBe("ok");
    expect(health.badges.find((b) => b.label === "pinned")!.value).toBe(0);
  });

  it("raises attention, and counts it, when an override is pinned", () => {
    const rows = buildUnitRows(
      COMMAND,
      [unit({ name: "vet-plan", checksum: "sha256-same" })],
      [unit({ name: "vet-plan", source: "fleet", checksum: "sha256-same" })]
    );
    const health = deriveCorpusHealth(COMMAND, rows, true);
    expect(health.level).toBe("attention");
    expect(health.headline).toContain("1 override is a pinned copy");
    expect(health.badges.find((b) => b.label === "pinned")!.value).toBe(1);
  });

  it("counts a pinned row on the account side of the badge cluster too", () => {
    const rows = buildUnitRows(
      COMMAND,
      [
        unit({ name: "vet-plan", checksum: "sha256-same" }),
        unit({ name: "implement-plan", checksum: "sha256-x" }),
      ],
      [unit({ name: "vet-plan", source: "fleet", checksum: "sha256-same" })]
    );
    const health = deriveCorpusHealth(COMMAND, rows, true);
    expect(health.badges.find((b) => b.label === "account")!.value).toBe(2);
  });

  it("says the corpus is empty rather than healthy when it holds nothing", () => {
    const health = deriveCorpusHealth(SKILL, [], true);
    expect(health.headline).toContain("No agent skills stored");
  });
});

describe("filters", () => {
  const rows = buildUnitRows(
    COMMAND,
    [
      unit({ name: "vet-plan", checksum: "sha256-same" }),
      unit({ name: "_loop-control", is_invocable: false, checksum: "sha256-z" }),
    ],
    [
      unit({ name: "vet-plan", source: "fleet", checksum: "sha256-same" }),
      unit({ name: "coord-doctor", source: "fleet", checksum: "sha256-y" }),
    ]
  );

  it("counts every declared filter", () => {
    const counts = filterCounts(rows);
    for (const { id } of UNIT_FILTERS) {
      expect(counts[id], `${id} uncounted`).toBeGreaterThanOrEqual(0);
    }
    // implement-plan (embedded seed), vet-plan, _loop-control, coord-doctor
    expect(counts.all).toBe(4);
    expect(counts.account).toBe(2);
    expect(counts.fleet).toBe(1);
    expect(counts.embedded).toBe(1);
    expect(counts.pinned).toBe(1);
    expect(counts["copy-source"]).toBe(1);
  });

  it("matches the query against the name and every stored file path", () => {
    const skillRows = buildUnitRows(
      SKILL,
      [],
      [
        unit({
          name: "coord-revive",
          kind: KIND_SKILL,
          source: "fleet",
          entrypoint: "SKILL.md",
          files: { "SKILL.md": "a", "coord-revive.sh": "b" },
        }),
      ]
    );
    expect(matchesQuery(skillRows[0], "revive.sh")).toBe(true);
    expect(matchesQuery(skillRows[0], "SKILL")).toBe(true);
    expect(matchesQuery(skillRows[0], "nothing")).toBe(false);
    expect(matchesQuery(skillRows[0], "   ")).toBe(true);
  });

  it("keeps a pinned row inside the account filter as well", () => {
    const pinned = rows.find((r) => r.name === "vet-plan")!;
    expect(matchesFilter(pinned, "account")).toBe(true);
    expect(matchesFilter(pinned, "pinned")).toBe(true);
    expect(matchesFilter(pinned, "fleet")).toBe(false);
  });

  it("agrees with countByStatus", () => {
    const counts = countByStatus(rows);
    expect(counts["account-pinned"]).toBe(1);
    expect(counts["account-override"]).toBe(1);
    expect(counts["fleet-default"]).toBe(1);
    expect(counts["embedded-only"]).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// Multi-file comparison
// -----------------------------------------------------------------------------

describe("diffFileSets", () => {
  it("classifies added, removed, changed and unchanged paths", () => {
    const diff = diffFileSets(
      { "SKILL.md": "one", "old.sh": "x", "same.md": "s" },
      { "SKILL.md": "two", "new.sh": "y", "same.md": "s" }
    );
    expect(diff.added).toEqual(["new.sh"]);
    expect(diff.removed).toEqual(["old.sh"]);
    expect(diff.changed).toEqual(["SKILL.md"]);
    expect(diff.unchanged).toEqual(["same.md"]);
    expect(diff.all).toEqual(["SKILL.md", "new.sh", "old.sh", "same.md"]);
  });

  it("does not report a CRLF hop as a change", () => {
    const diff = diffFileSets(
      { "SKILL.md": "a\r\nb\r\n" },
      { "SKILL.md": "a\nb\n" }
    );
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual(["SKILL.md"]);
  });

  it("handles two empty maps without inventing a path", () => {
    expect(diffFileSets({}, {})).toEqual({
      added: [],
      removed: [],
      changed: [],
      unchanged: [],
      all: [],
    });
  });
});

describe("totalBytes", () => {
  it("measures UTF-8 bytes across the whole map, not characters", () => {
    expect(totalBytes({ "a.md": "abc", "b.md": "dé" })).toBe(3 + 3);
  });
});
