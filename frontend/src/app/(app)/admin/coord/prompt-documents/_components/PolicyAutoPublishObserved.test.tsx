/**
 * The auto-publish dial's "Observed:" line — what coord's worker ledger saw of
 * the publication pass, beside the level "In force".
 *
 * Plan `2026-10-17-auto-publish-lands-via-coord-2290-adoption` D5 / Phase 4.
 * The dial is driven through the SAME wiring the page uses — `usePublishAll`'s
 * one status read, mapped by `observedFromPublishAll` — so every arm below
 * exercises the real data path: fetch, hook, latch, and render.
 *
 * What is pinned, and how each would fail silently:
 *
 * 1. **One arm per worker status**, each with its own sentence.
 * 2. **"Last pass" is `last_work_tick_at`, never `last_tick_at`.** A follower's
 *    `follower_skip` keeps `last_tick_at` fresh on a coord where no pass ran.
 * 3. **Absent field, failed request, coord's `unknown` and an unrecognised
 *    status all read UNKNOWN** — never a healthy loop by default.
 * 4. **The silent latch hides the line**: outside the system tenant there is no
 *    auto-publisher of this tenant's to observe.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FleetPolicyView } from "@/lib/api/operations/tenantPolicy";
import type { AutoPublishStatusResponse } from "../types";

const policyGet = vi.fn();
const statusGet = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string, init: { method?: string }) => {
      const method = init.method ?? "GET";
      if (method !== "GET") {
        throw new Error(`fetch mock: unexpected ${method} ${url}`);
      }
      const out = url.includes("/auto-publish/status")
        ? await statusGet(url)
        : await policyGet(url);
      return out instanceof Response
        ? out
        : new Response(JSON.stringify(out ?? null));
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import {
  observedFromPublishAll,
  PolicyAutoPublishDialControl,
} from "./PolicyAutoPublishDialControl";
import { usePublishAll } from "../_hooks/usePublishAll";

/**
 * The dial over one `usePublishAll` read, as the page wires it. The page-level
 * properties (ONE shared fetch, the reload after a level change) are pinned
 * against the real page in `PromptDocumentsPageObserved.test.tsx`; this harness
 * exists to drive each worker state cheaply. `harness-settled` is a definite
 * signal that the hook's read has finished, so absence can be asserted after
 * it rather than after a guessed delay; `harness-reload` re-takes the read.
 */
function Harness() {
  const state = usePublishAll();
  return (
    <>
      <span data-testid="harness-settled">{String(state.statusSettled)}</span>
      <button data-testid="harness-reload" onClick={() => void state.reload()}>
        reload
      </button>
      <PolicyAutoPublishDialControl observed={observedFromPublishAll(state)} />
    </>
  );
}

const view: FleetPolicyView = {
  domain: "policy_auto_publish",
  effective_level: "on",
  master_enabled: true,
  resolved_scope: "tenant",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
};

function status(
  worker: AutoPublishStatusResponse["worker"]
): AutoPublishStatusResponse {
  const body: AutoPublishStatusResponse = {
    candidates: [],
    count: 0,
    publishing_enabled: true,
  };
  if (worker !== undefined) body.worker = worker;
  return body;
}

const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString();

function observedNow(): HTMLElement {
  return screen.getByTestId("policy-auto-publish-observed");
}

async function observed(): Promise<HTMLElement> {
  return screen.findByTestId("policy-auto-publish-observed");
}

const UNKNOWN =
  "Observed: UNKNOWN — no auto-publisher pass recorded on the serving coord";

beforeEach(() => {
  vi.clearAllMocks();
  policyGet.mockResolvedValue(view);
});

describe("the observed auto-publisher, per worker status", () => {
  it("alive: names the last BODY execution and the decision code verbatim", async () => {
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "alive",
          // A follower_skip one second ago must not be read as the last pass.
          last_tick_at: minutesAgo(0),
          last_work_tick_at: minutesAgo(5),
          last_decision_code: "ran:nothing_due",
        },
      })
    );
    render(<Harness />);

    const line = await observed();
    expect(line).toHaveTextContent(
      "Observed: last pass 5m ago — ran:nothing_due"
    );
    expect(line).not.toHaveTextContent(/just now|0s ago/);
    expect(line).toHaveAttribute("data-observed-tone", "nominal");
  });

  it("alive with an unparseable work tick: flags it rather than reading nominal", async () => {
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "alive",
          last_tick_at: minutesAgo(0),
          last_work_tick_at: "not-a-timestamp",
          last_decision_code: "ran:published",
        },
      })
    );
    render(<Harness />);

    const line = await observed();
    expect(line).toHaveTextContent(
      "Observed: last pass at an unknown time — ran:published"
    );
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it("alive with no work tick yet: says the loop is alive and nothing more", async () => {
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "alive",
          last_tick_at: minutesAgo(1),
          last_work_tick_at: null,
          last_decision_code: null,
        },
      })
    );
    render(<Harness />);

    expect(await observed()).toHaveTextContent(
      "Observed: loop alive, no pass body recorded yet"
    );
    // A leader that never ran a body is not nominal.
    expect(await observed()).toHaveAttribute("data-observed-tone", "attention");
  });

  it("stale: says stale since the last tick", async () => {
    const at = minutesAgo(45);
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "stale",
          last_tick_at: at,
          last_work_tick_at: minutesAgo(50),
          last_decision_code: "ran:published",
        },
      })
    );
    render(<Harness />);

    const line = await observed();
    expect(line).toHaveTextContent(
      `Observed: stale since ${new Date(at).toLocaleString()}`
    );
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it("dead: says dead since the last tick, or since unknown when there is none", async () => {
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "dead",
          last_tick_at: null,
          last_work_tick_at: null,
          last_decision_code: null,
        },
      })
    );
    render(<Harness />);

    const line = await observed();
    expect(line).toHaveTextContent("Observed: dead since unknown");
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it("not_leader_here: says no live replica is running it", async () => {
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "not_leader_here",
          last_tick_at: minutesAgo(0),
          last_work_tick_at: null,
          last_decision_code: null,
        },
      })
    );
    render(<Harness />);

    expect(await observed()).toHaveTextContent(
      "Observed: no live replica is running the auto-publisher"
    );
  });

  it("unknown: renders UNKNOWN and carries coord's reason", async () => {
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "unknown",
          unknown_reason: "ledger_unreadable",
          last_tick_at: null,
          last_work_tick_at: null,
          last_decision_code: null,
        },
      })
    );
    render(<Harness />);

    const line = await observed();
    expect(line).toHaveTextContent(UNKNOWN);
    expect(line).toHaveTextContent("ledger_unreadable");
    expect(line).toHaveAttribute("data-observed-tone", "unknown");
  });

  it("field absent (a coord older than Phase 3): renders UNKNOWN", async () => {
    statusGet.mockResolvedValue(status(undefined));
    render(<Harness />);

    const line = await observed();
    expect(line).toHaveTextContent(UNKNOWN);
    expect(line).not.toHaveTextContent(/last pass/);
  });

  it("request failed: renders UNKNOWN, not nothing and not a healthy loop", async () => {
    statusGet.mockResolvedValue(new Response("boom", { status: 500 }));
    render(<Harness />);

    const line = await observed();
    expect(line).toHaveTextContent(UNKNOWN);
    expect(line).toHaveAttribute("data-observed-tone", "unknown");
  });

  it("a status this build does not know: renders UNKNOWN", async () => {
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "hibernating",
          last_tick_at: minutesAgo(1),
          last_work_tick_at: minutesAgo(1),
          last_decision_code: "ran:published",
        },
      })
    );
    render(<Harness />);

    expect(await observed()).toHaveTextContent(UNKNOWN);
  });
});

describe("a later read", () => {
  it("that fails turns an alive observation UNKNOWN rather than leaving it standing", async () => {
    statusGet.mockResolvedValueOnce(
      status({
        pass: {
          status: "alive",
          last_tick_at: minutesAgo(1),
          last_work_tick_at: minutesAgo(2),
          last_decision_code: "ran:published",
        },
      })
    );
    render(<Harness />);
    expect(await observed()).toHaveTextContent(
      "Observed: last pass 2m ago — ran:published"
    );

    statusGet.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    fireEvent.click(screen.getByTestId("harness-reload"));

    await waitFor(() => expect(statusGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(observedNow()).toHaveTextContent(UNKNOWN));
    expect(observedNow()).not.toHaveTextContent(/last pass/);
  });
});

describe("where the observation is withheld", () => {
  it("renders nothing under the not_system_tenant latch", async () => {
    statusGet.mockResolvedValue(
      new Response(JSON.stringify({ error: "not_system_tenant" }), {
        status: 403,
      })
    );
    render(<Harness />);

    await screen.findByTestId("policy-auto-publish-in-force");
    // The read has definitely settled (failed and latched) before absence is
    // asserted — no guessed delay.
    await waitFor(() =>
      expect(screen.getByTestId("harness-settled")).toHaveTextContent("true")
    );
    expect(statusGet).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("policy-auto-publish-observed")
    ).not.toBeInTheDocument();
  });

  it("renders nothing when the page has not wired an observation", async () => {
    render(<PolicyAutoPublishDialControl />);

    await screen.findByTestId("policy-auto-publish-in-force");
    expect(
      screen.queryByTestId("policy-auto-publish-observed")
    ).not.toBeInTheDocument();
  });
});
