/**
 * The `/agents/[agent_id]` health strip's derivation.
 *
 * `agentLogHealth.tsx` landed with Phase 3 Wave 3 (qontinui-web#1035) carrying
 * three judgements and no test: an `error` row is RED, `warn` is amber, and an
 * unfetched count renders `–` rather than `0`. This file pins all three, plus
 * the failed-read arm the follow-up added.
 *
 * The dash assertions render through `<HealthStrip>` rather than reading
 * `badges` directly, because the rule they protect is about what the OPERATOR
 * sees: `<HealthStrip>` renders `badge.label` verbatim, so a `null` label
 * renders nothing at all and a unit assertion on the array would pass while
 * the strip showed a blank.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthStrip } from "@/components/console";
import { deriveAgentLogHealth } from "./agentLogHealth";
import type { AgentLogRow } from "./LogRow";

function row(level: string, i = 0): AgentLogRow {
  return { agent_id: "a", log_id: i, level, event: "tick" };
}

function renderStrip(h: ReturnType<typeof deriveAgentLogHealth>) {
  render(
    <HealthStrip
      level={h.level}
      headline={h.headline}
      detail={h.detail}
      badges={h.badges}
      data-testid="strip"
    />
  );
  return screen.getByTestId("strip");
}

describe("deriveAgentLogHealth", () => {
  it("renders every count as `–` before coord has answered — never `0`", () => {
    const h = deriveAgentLogHealth([], 0, false);
    expect(h.headline).toMatch(/Waiting for coord/);
    const strip = renderStrip(h);
    expect(strip).toHaveTextContent("rows –");
    expect(strip).toHaveTextContent("errors –");
    // The load-bearing clause: an unloaded page must not claim "0 errors".
    expect(strip).not.toHaveTextContent("errors 0");
  });

  it("goes red on an error row — the one thing on this page a human must act on", () => {
    const h = deriveAgentLogHealth([row("info"), row("error", 1)], 2, true);
    expect(h.level).toBe("red");
    expect(h.headline).toBe("1 error in this window");
  });

  it("goes amber, not red, when the worst row is a warning", () => {
    const h = deriveAgentLogHealth([row("warn"), row("info", 1)], 2, true);
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("1 warning, no errors");
  });

  it("counts `warning` and `err` as `warn` and `error`, like the badge does", () => {
    // A bare `toLowerCase()` reads `warning` as its own level and undercounts.
    const h = deriveAgentLogHealth([row("warning"), row("err", 1)], 2, true);
    expect(h.level).toBe("red");
    const strip = renderStrip(h);
    expect(strip).toHaveTextContent("warn 1");
    expect(strip).toHaveTextContent("errors 1");
  });

  it("keeps the filtered/total pair when a filter is hiding rows", () => {
    const h = deriveAgentLogHealth([row("info")], 400, true);
    const strip = renderStrip(h);
    // Collapsing this to one number loses the difference between "this agent
    // logged one thing" and "you are looking at one of four hundred".
    expect(strip).toHaveTextContent("rows 1/400");
    expect(h.detail).toMatch(/filters are active/);
  });

  it("says nothing matches the filters rather than that the log is clean", () => {
    const h = deriveAgentLogHealth([], 400, true);
    expect(h.headline).toBe("Nothing matches the current filters");
  });

  describe("a failed read (R6 — 'not fetched' includes 'fetched and FAILED')", () => {
    it("is UNKNOWN, not 'waiting', when it left nothing behind", () => {
      const h = deriveAgentLogHealth([], 0, false, true);
      // The failure arm has to win over `!loaded`: a first load that errors
      // leaves `loaded` false too, and "Waiting for coord…" would be a promise
      // about a request that is never arriving.
      expect(h.headline).toMatch(/unknown, not empty/);
      expect(h.headline).not.toMatch(/Waiting for coord/);
      const strip = renderStrip(h);
      expect(strip).toHaveTextContent("rows –");
      expect(strip).toHaveTextContent("warn –");
      expect(strip).toHaveTextContent("errors –");
      expect(strip).not.toHaveTextContent("errors 0");
    });

    it("does not go green off a window an earlier poll left behind", () => {
      const h = deriveAgentLogHealth([row("info")], 1, true, true);
      // The counts are real, so they keep rendering — but "No errors or
      // warnings" is the sentence that tells an operator to stop looking, and
      // it must not stand unqualified over a read that failed.
      expect(h.headline).toBe("No errors or warnings");
      expect(h.detail).toMatch(/^Last refresh failed — these counts are stale\./);
      expect(renderStrip(h)).toHaveTextContent("rows 1");
    });

    it("still reports a retained error window rather than dashing it", () => {
      // Stale is not unknown: a retained error is still actionable, and
      // blanking it would discard a count the operator can do something about.
      const h = deriveAgentLogHealth([row("error")], 1, true, true);
      expect(h.level).toBe("red");
      expect(h.headline).toBe("1 error in this window");
    });
  });
});
