import { describe, expect, it } from "vitest";
import {
  agentNameProblem,
  enforcementLabel,
  mergeLines,
  normalizeAgentName,
  sourceBadges,
  spawnSwitchState,
  type AgentLine,
} from "./agentCatalog";
import type {
  AdminAgentRegistryRow,
  AgentCatalogEntry,
} from "@/lib/api/agent-registry";

function entry(overrides: Partial<AgentCatalogEntry> = {}): AgentCatalogEntry {
  return {
    agent_name: "x",
    has_row: false,
    spawn_path: "in_session_subagent",
    purpose: "",
    sources: [],
    admin_disabled: false,
    default_enabled: true,
    enforcement: "hook",
    ...overrides,
  };
}

const row = { agent_name: "r", default_enabled: true } as AdminAgentRegistryRow;

describe("the agent-name grammar (coord's validate_agent_name)", () => {
  it("lowercases ASCII only, as coord's normalize_agent_name does", () => {
    expect(normalizeAgentName("  Explore ")).toBe("explore");
    // Non-ASCII is left as it is, so the grammar check still refuses it.
    expect(normalizeAgentName("ÉMILE")).toBe("Émile");
  });

  it.each([
    ["explore", null],
    ["general-purpose", null],
    ["a_b-9", null],
    ["", /Enter/],
    ["a".repeat(64), null],
    ["a".repeat(65), /64/],
    ["Upper", /lowercase/],
    ["dot.name", /lowercase/],
    ["effective-for", /reserved/],
    ["retire", /reserved/],
  ])("%j -> %s", (name, expected) => {
    const problem = agentNameProblem(name);
    if (expected === null) expect(problem).toBeNull();
    else expect(problem).toMatch(expected);
  });
});

describe("mergeLines", () => {
  it("joins by name, keeps rows the catalog lacks, and sorts", () => {
    const lines = mergeLines(
      [entry({ agent_name: "r" }), entry({ agent_name: "a" })],
      [row, { ...row, agent_name: "z" }]
    );
    expect(lines.map((l) => l.agent_name)).toEqual(["a", "r", "z"]);
    expect(lines[1].row).not.toBeNull();
    expect(lines[2].catalog).toBeNull();
  });

  it("a line with no catalog entry reads its switch as unknown, never on", () => {
    const [line] = mergeLines(null, [row]);
    expect(spawnSwitchState(line)).toBe("unknown");
  });
});

describe("sourceBadges", () => {
  const line = (e: AgentCatalogEntry): AgentLine => ({
    agent_name: e.agent_name,
    catalog: e,
    row: null,
  });

  it("dates an observed name", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    const badges = sourceBadges(
      line(
        entry({
          sources: [
            { source: "observed", last_seen_at: "2026-11-25T10:00:00Z" },
          ],
        })
      ),
      now
    );
    expect(badges.map((b) => b.label)).toContain("observed 2h ago");
  });

  it("names a source kind it has no label for without echoing it as a label", () => {
    const badges = sourceBadges(
      line(entry({ sources: [{ source: "future_kind" }] }))
    );
    expect(badges.map((b) => b.label)).toContain("other source");
  });
});

describe("enforcementLabel", () => {
  it("an unlabelled enforcement on a subagent still says advisory elsewhere", () => {
    const label = enforcementLabel({
      agent_name: "x",
      catalog: entry({ enforcement: "something_new" }),
      row: null,
    });
    expect(label.reach).toBe("unknown");
    expect(label.detail).toContain("advisory elsewhere");
  });

  it("advisory says nothing stops the spawn", () => {
    const label = enforcementLabel({
      agent_name: "x",
      catalog: entry({ enforcement: "advisory" }),
      row: null,
    });
    expect(label.reach).toBe("none");
    expect(label.detail).toMatch(/Nothing stops/);
  });
});
