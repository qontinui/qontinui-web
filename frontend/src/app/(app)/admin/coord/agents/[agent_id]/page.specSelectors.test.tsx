/**
 * Every page-owned selector in the COMMITTED Spec-CI spec for
 * `/admin/coord/agents/[agent_id]`, run against the migrated markup.
 *
 * ## Why this file exists
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 3 deletes this page's `<Card><CardHeader><CardTitle>` wrapper (R9) and
 * moves the back button, the agent-id chip and the session link out of that
 * header onto a control line. Two of those three are `critical` assertions in
 * `specs/pages/coord-agent-detail/state-machine.derived.json`, and a derived
 * spec is never hand-edited to match new markup (D4b) — so the migration has
 * to be shown to keep them resolvable, not asserted to.
 *
 * This file is that evidence, and it takes the same shape the Wave 1/2 ones do
 * (`trees/`, `lands/`, `pull-decisions/`): it READS the committed spec at test
 * time and asserts every page-owned criterion resolves against the real
 * rendered page, with the spec's own `metadata.routeStubs` rows as the data.
 * It holds no copy of the spec, so it cannot drift from it.
 *
 * ## The constraint this spec has and the other three do not
 *
 * **`transitions` is `[]`.** The executor therefore evaluates every criterion
 * with NOTHING expanded, so none of the six may move behind a click. That is
 * why the loop below renders and asserts without ever toggling a row, and why
 * `agent-log-row` is checked in its collapsed state.
 *
 * ## What it deliberately does NOT cover
 *
 * All three states in this spec are page-owned — unlike `coord-trees` there is
 * no `-shell` state here — so nothing is filtered out. The first test pins the
 * state list so a spec that GROWS a state moves the count rather than being
 * silently skipped.
 *
 * ## What it does not replace
 *
 * A jsdom render is not a browser and is not the Spec-CI executor. The
 * authoritative check is still a live authed run; see this PR's report for why
 * one could not be captured in this session.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

const get = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ agent_id: SENTINEL_AGENT }),
  useRouter: () => ({ push: vi.fn() }),
}));

const SENTINEL_AGENT = "spec-ci-sentinel-agent";

interface SpecCriteria {
  id?: string;
  role?: string;
  text?: string;
}
interface SpecAssertion {
  id: string;
  target?: { criteria?: SpecCriteria };
}
interface SpecState {
  id: string;
  assertions: SpecAssertion[];
}
interface StubLog {
  log_id?: string;
  level?: string;
  event?: string;
}
interface DerivedSpec {
  id: string;
  states: SpecState[];
  transitions: unknown[];
  metadata?: {
    routeStubs?: {
      urlPattern: string;
      body: { agent_id?: string; logs?: StubLog[] };
    }[];
  };
}

const SPEC: DerivedSpec = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../../../specs/pages/coord-agent-detail/state-machine.derived.json"
    ),
    "utf-8"
  )
);

/** The canned rows the spec itself stubs the by-agent endpoint with. */
const STUB_LOGS = SPEC.metadata?.routeStubs?.[0]?.body?.logs ?? [];

import CoordAgentLogPage from "./page";

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url.includes("/agent-logs/by-agent/")) {
      return { agent_id: SENTINEL_AGENT, logs: STUB_LOGS };
    }
    return {};
  });
});

describe("coord-agent-detail Spec-CI selectors survive the Wave 3 migration", () => {
  it("covers every state in the spec, and the spec expands nothing", () => {
    expect(SPEC.states.map((s) => s.id)).toEqual([
      "coord-agent-detail-header",
      "coord-agent-detail-controls",
      "coord-agent-detail-populated",
    ]);
    // The load-bearing property: with no transitions, every criterion is
    // evaluated on the COLLAPSED page. If a future spec revision adds one,
    // this test should be revisited rather than quietly relaxed.
    expect(SPEC.transitions).toEqual([]);
    expect(STUB_LOGS.length).toBeGreaterThan(0);
  });

  it("resolves every `id` criterion against the rendered page, unexpanded", async () => {
    render(<CoordAgentLogPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId("agent-log-row").length).toBeGreaterThan(0);
    });

    const missing: string[] = [];
    const checked: string[] = [];
    for (const state of SPEC.states) {
      for (const a of state.assertions) {
        const id = a.target?.criteria?.id;
        if (!id) continue;
        checked.push(`${a.id} → #${id}`);
        if (screen.queryAllByTestId(id).length === 0) {
          missing.push(`${a.id} → ${id}`);
        }
      }
    }

    // Every assertion in this spec is an `id` criterion; if that ever stops
    // being true this count catches it rather than the loop silently skipping
    // the new shape.
    expect(checked).toHaveLength(
      SPEC.states.reduce((n, s) => n + s.assertions.length, 0)
    );
    expect(missing).toEqual([]);
  });

  it("renders one row per canned log entry", async () => {
    render(<CoordAgentLogPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId("agent-log-row")).toHaveLength(
        STUB_LOGS.length
      );
    });
    // The agent-id chip echoes the decoded route param — the spec's own
    // description calls this the proof the dynamic route resolved.
    expect(screen.getByTestId("coord-agent-log-agent-id")).toHaveTextContent(
      SENTINEL_AGENT
    );
  });
});
