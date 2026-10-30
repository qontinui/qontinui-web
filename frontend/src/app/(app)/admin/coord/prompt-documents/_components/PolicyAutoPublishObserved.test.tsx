/**
 * The auto-publish dial's "Observed" lines — what coord's worker ledger saw of
 * the publication pass and of the recovery reconcile, beside the level
 * "In force".
 *
 * Plan `2026-10-17-auto-publish-lands-via-coord-2290-adoption` D5 / Phase 4.
 * The dial is driven through the SAME wiring the page uses — `usePublishAll`'s
 * one status read, mapped by `observedFromPublishAll` — so every arm below
 * exercises the real data path: fetch, hook, latch, and render.
 *
 * What is pinned, and how each would fail silently:
 *
 * 1. **One arm per worker status**, each with its own sentence — `erroring`
 *    included: a loop coord observed FAILING is not UNKNOWN.
 * 2. **"Last pass" is `last_work_tick_at`, never `last_tick_at`.** A follower's
 *    `follower_skip` keeps `last_tick_at` fresh on a coord where no pass ran.
 * 3. **Absent field, failed request, coord's `unknown` and an unrecognised
 *    status all read UNKNOWN** — never a healthy loop by default.
 * 4. **The silent latch hides the line**: outside the system tenant there is no
 *    auto-publisher of this tenant's to observe.
 * 5. **The reconcile rests healthy on exactly one idle code.** It does its work
 *    once a day and the ledger keeps only the latest outcome, so `recovery:not_due`
 *    with no work tick is its ordinary state. Any other idle code does not read
 *    healthy, and coord's `recovery:not_due_after_errors` reads failing all day.
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

async function observedReconcile(): Promise<HTMLElement> {
  return screen.findByTestId("policy-auto-publish-observed-reconcile");
}

const UNKNOWN =
  "Observed: UNKNOWN — no auto-publisher pass recorded on the serving coord";
const RECONCILE_UNKNOWN =
  "Observed reconcile: UNKNOWN — no recovery reconcile recorded on the serving coord";

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

  it("alive whose last tick skipped: says the tick did no pass work, never that no pass ever ran", async () => {
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "alive",
          nominal: true,
          reason: null,
          unknown_reason: null,
          last_tick_at: minutesAgo(1),
          last_work_tick_at: null,
          last_decision_code: "skip:switch_off",
        },
      })
    );
    render(<Harness />);

    const line = await observed();
    expect(line).toHaveTextContent(
      "Observed: loop alive, last tick did no pass work — skip:switch_off"
    );
    expect(line).not.toHaveTextContent(/no pass body recorded/);
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it("alive but coord says not nominal (a future reason): never the healthy tone, and coord's reason is shown", async () => {
    // No reason coord serves today pairs with `alive` (the round-6 lease case
    // has its own arm above); this guards whatever reason a later coord adds.
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "alive",
          nominal: false,
          reason: "a_reason_this_build_does_not_know",
          unknown_reason: null,
          last_tick_at: minutesAgo(0),
          last_work_tick_at: minutesAgo(4),
          last_decision_code: "ran:published",
        },
      })
    );
    render(<Harness />);

    const line = await observed();
    expect(line).toHaveTextContent(
      "Observed: last pass 4m ago — ran:published"
    );
    expect(line).toHaveTextContent("a_reason_this_build_does_not_know");
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it("alive with an unreadable lease: never claims no pass ran, and is not nominal", async () => {
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "alive",
          nominal: false,
          reason: "lease_holder_unknown",
          unknown_reason: null,
          last_tick_at: minutesAgo(1),
          last_work_tick_at: null,
          last_decision_code: null,
        },
      })
    );
    render(<Harness />);

    const line = await observed();
    expect(line).toHaveTextContent(
      "Observed: loop alive, but coord cannot tell which replica runs the pass"
    );
    expect(line).not.toHaveTextContent(/no pass body recorded/);
    expect(line).toHaveAttribute("data-observed-tone", "attention");
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

  it("erroring on a failure code: names it as context beside coord's reason, never UNKNOWN or a healthy last pass", async () => {
    const reason =
      "`prompt_document_auto_publish.pass` is running but reported a failure (ran:publish_failed): its last pass could not decide or publish some documents; the coord log names them";
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "erroring",
          unknown_reason: reason,
          last_tick_at: minutesAgo(0),
          last_work_tick_at: minutesAgo(3),
          last_decision_code: "ran:publish_failed",
        },
      })
    );
    render(<Harness />);

    const line = await observed();
    expect(line).toHaveTextContent(
      "Observed: running but failing (last decision: ran:publish_failed)"
    );
    expect(line).toHaveTextContent("the coord log names them");
    expect(line).not.toHaveTextContent(UNKNOWN);
    expect(line).not.toHaveTextContent(/last pass \d/);
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it("erroring on an error streak (the ledger's tick_error): says the body errors, with coord's reason", async () => {
    // The shape coord serves for a body that errors on every tick: the lease
    // holder's row carries the ledger's `tick_error` code.
    const reason =
      "`prompt_document_auto_publish.pass` is running but its body is failing on every tick (error_streak); coord_query_workers name=prompt_document_auto_publish.pass has the streak";
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "erroring",
          unknown_reason: reason,
          last_tick_at: minutesAgo(0),
          last_work_tick_at: minutesAgo(0),
          last_decision_code: "tick_error",
        },
      })
    );
    render(<Harness />);

    const line = await observed();
    expect(line).toHaveTextContent(
      "Observed: running but failing — the pass body errors on every tick"
    );
    expect(line).not.toHaveTextContent(/last decision/);
    expect(line).toHaveTextContent("has the streak");
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it("erroring with no lease-holder row (no code, no work tick): says failing and lets coord's reason name the code", async () => {
    statusGet.mockResolvedValue(
      status({
        pass: {
          status: "erroring",
          unknown_reason:
            "`prompt_document_auto_publish.pass` is running but reported a failure (ran:decide_failed): its last pass could not decide or publish some documents; the coord log names them",
          last_tick_at: minutesAgo(1),
          last_work_tick_at: null,
          last_decision_code: null,
        },
      })
    );
    render(<Harness />);

    const line = await observed();
    expect(line).toHaveTextContent("Observed: running but failing");
    expect(line).not.toHaveTextContent(/body errors|last decision/);
    expect(line).toHaveTextContent("reported a failure (ran:decide_failed)");
    expect(line).toHaveAttribute("data-observed-tone", "attention");
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
    expect(
      screen.queryByTestId("policy-auto-publish-observed-reconcile")
    ).not.toBeInTheDocument();
  });

  it("renders nothing when the page has not wired an observation", async () => {
    render(<PolicyAutoPublishDialControl />);

    await screen.findByTestId("policy-auto-publish-in-force");
    expect(
      screen.queryByTestId("policy-auto-publish-observed")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("policy-auto-publish-observed-reconcile")
    ).not.toBeInTheDocument();
  });
});

describe("the observed recovery reconcile, per worker status", () => {
  // The switch being on says nothing about the reconcile: the pass stays
  // healthy in every arm below, so a reconcile reading can only come from its
  // own observation.
  const healthyPass = {
    status: "alive",
    nominal: true,
    reason: null,
    last_tick_at: minutesAgo(0),
    last_work_tick_at: minutesAgo(5),
    last_decision_code: "ran:nothing_due",
  };

  function reconcileStatus(
    recovery_reconcile: NonNullable<
      AutoPublishStatusResponse["worker"]
    >["recovery_reconcile"]
  ) {
    return status({ pass: healthyPass, recovery_reconcile });
  }

  it("reads the reconcile's own observation, not the pass's", async () => {
    statusGet.mockResolvedValue(
      status({
        pass: {
          ...healthyPass,
          status: "dead",
          nominal: false,
          reason: "dead",
        },
        recovery_reconcile: {
          status: "alive",
          nominal: true,
          reason: null,
          last_tick_at: minutesAgo(0),
          last_work_tick_at: minutesAgo(9),
          last_decision_code: "recovery:reconciled",
        },
      })
    );
    render(<Harness />);

    const line = await observedReconcile();
    expect(line).toHaveTextContent(
      "Observed reconcile: last ran 9m ago — recovery:reconciled"
    );
    expect(line).toHaveAttribute("data-observed-tone", "nominal");
    expect(observedNow()).toHaveTextContent("Observed: dead since");
  });

  it("not due after a clean run: the resting state reads healthy, with no work tick", async () => {
    statusGet.mockResolvedValue(
      reconcileStatus({
        status: "alive",
        nominal: true,
        reason: null,
        last_tick_at: minutesAgo(1),
        last_work_tick_at: null,
        last_decision_code: "recovery:not_due",
      })
    );
    render(<Harness />);

    const line = await observedReconcile();
    expect(line).toHaveTextContent(
      "Observed reconcile: clean within the last day, next run not due — recovery:not_due"
    );
    expect(line).toHaveAttribute("data-observed-tone", "nominal");
  });

  it("the resting code outranked by coord's nominal false: flagged, with coord's reason", async () => {
    statusGet.mockResolvedValue(
      reconcileStatus({
        status: "alive",
        nominal: false,
        reason: "body_in_flight",
        last_tick_at: minutesAgo(1),
        last_work_tick_at: null,
        last_decision_code: "recovery:not_due",
      })
    );
    render(<Harness />);

    const line = await observedReconcile();
    expect(line).toHaveTextContent(
      "Observed reconcile: loop alive, last tick did no reconcile — recovery:not_due"
    );
    expect(line).toHaveTextContent("body_in_flight");
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it("another idle code: never reads healthy", async () => {
    statusGet.mockResolvedValue(
      reconcileStatus({
        status: "alive",
        nominal: true,
        reason: null,
        last_tick_at: minutesAgo(1),
        last_work_tick_at: null,
        last_decision_code: "recovery:some_future_idle",
      })
    );
    render(<Harness />);

    const line = await observedReconcile();
    expect(line).toHaveTextContent(
      "Observed reconcile: loop alive, last tick did no reconcile — recovery:some_future_idle"
    );
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it("no code and no work tick: says nothing has been recorded", async () => {
    statusGet.mockResolvedValue(
      reconcileStatus({
        status: "alive",
        nominal: true,
        reason: null,
        last_tick_at: minutesAgo(1),
        last_work_tick_at: null,
        last_decision_code: null,
      })
    );
    render(<Harness />);

    const line = await observedReconcile();
    expect(line).toHaveTextContent(
      "Observed reconcile: loop alive, no reconcile recorded yet"
    );
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it("an unreadable lease: names the reconcile as what cannot be attributed", async () => {
    statusGet.mockResolvedValue(
      reconcileStatus({
        status: "alive",
        nominal: false,
        reason: "lease_holder_unknown",
        last_tick_at: minutesAgo(1),
        last_work_tick_at: null,
        last_decision_code: null,
      })
    );
    render(<Harness />);

    const line = await observedReconcile();
    expect(line).toHaveTextContent(
      "Observed reconcile: loop alive, but coord cannot tell which replica runs the reconcile"
    );
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it("not due AFTER errors: reads failing with coord's sentence, never the resting state", async () => {
    // The whole point of coord's second idle code: a failure stays visible for
    // the day instead of being erased by the next not-due tick.
    const reason =
      "`prompt_document_auto_publish.recovery_reconcile` is running but reported a failure (recovery:not_due_after_errors): the last recovery reconcile counted per-tenant errors; the coord log names the tenants, and the next reconcile retries them";
    statusGet.mockResolvedValue(
      reconcileStatus({
        status: "erroring",
        unknown_reason: reason,
        nominal: false,
        reason: "last_pass_failed",
        last_tick_at: minutesAgo(1),
        last_work_tick_at: null,
        last_decision_code: "recovery:not_due_after_errors",
      })
    );
    render(<Harness />);

    const line = await observedReconcile();
    expect(line).toHaveTextContent(
      "Observed reconcile: running but failing (last decision: recovery:not_due_after_errors)"
    );
    expect(line).toHaveTextContent("the coord log names the tenants");
    expect(line).not.toHaveTextContent(/clean within/);
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it("erroring on the ledger's tick_error: says the reconcile errors", async () => {
    statusGet.mockResolvedValue(
      reconcileStatus({
        status: "erroring",
        unknown_reason:
          "`prompt_document_auto_publish.recovery_reconcile` is running but its body is failing on every tick (error_streak)",
        nominal: false,
        reason: "error_streak",
        last_tick_at: minutesAgo(1),
        last_work_tick_at: minutesAgo(1),
        last_decision_code: "tick_error",
      })
    );
    render(<Harness />);

    const line = await observedReconcile();
    expect(line).toHaveTextContent(
      "Observed reconcile: running but failing — the reconcile errors on every attempt"
    );
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it.each(["stale", "dead"] as const)(
    "%s: says since when",
    async (workerStatus) => {
      statusGet.mockResolvedValue(
        reconcileStatus({
          status: workerStatus,
          nominal: false,
          reason: workerStatus,
          last_tick_at: minutesAgo(120),
          last_work_tick_at: null,
          last_decision_code: null,
        })
      );
      render(<Harness />);

      const line = await observedReconcile();
      expect(line).toHaveTextContent(
        `Observed reconcile: ${workerStatus} since`
      );
      expect(line).toHaveAttribute("data-observed-tone", "attention");
    }
  );

  it("not_leader_here: no replica runs it", async () => {
    statusGet.mockResolvedValue(
      reconcileStatus({
        status: "not_leader_here",
        nominal: false,
        reason: "no_leader_tick",
        last_tick_at: minutesAgo(1),
        last_work_tick_at: null,
        last_decision_code: null,
      })
    );
    render(<Harness />);

    const line = await observedReconcile();
    expect(line).toHaveTextContent(
      "Observed reconcile: no live replica is running the recovery reconcile"
    );
    expect(line).toHaveAttribute("data-observed-tone", "attention");
  });

  it("unknown, with coord's reason", async () => {
    statusGet.mockResolvedValue(
      reconcileStatus({
        status: "unknown",
        unknown_reason:
          "no ledger row for `prompt_document_auto_publish.recovery_reconcile`",
        nominal: false,
        reason: null,
        last_tick_at: null,
        last_work_tick_at: null,
        last_decision_code: null,
      })
    );
    render(<Harness />);

    const line = await observedReconcile();
    expect(line).toHaveTextContent(RECONCILE_UNKNOWN);
    expect(line).toHaveTextContent("no ledger row for");
    expect(line).toHaveAttribute("data-observed-tone", "unknown");
  });

  it("a status this build does not know: UNKNOWN, naming it in the tooltip", async () => {
    statusGet.mockResolvedValue(
      reconcileStatus({ status: "hibernating", last_tick_at: minutesAgo(1) })
    );
    render(<Harness />);

    const line = await observedReconcile();
    expect(line).toHaveTextContent(RECONCILE_UNKNOWN);
    expect(line).toHaveAttribute(
      "title",
      "Coord reported a worker status this console does not recognise: hibernating"
    );
  });

  it("absent while the pass is served: UNKNOWN, not inferred from the pass", async () => {
    statusGet.mockResolvedValue(status({ pass: healthyPass }));
    render(<Harness />);

    const line = await observedReconcile();
    expect(line).toHaveTextContent(RECONCILE_UNKNOWN);
    expect(line).toHaveAttribute("data-observed-tone", "unknown");
    expect(observedNow()).toHaveAttribute("data-observed-tone", "nominal");
  });

  it("request failed: UNKNOWN, not nothing", async () => {
    statusGet.mockResolvedValue(new Response("boom", { status: 500 }));
    render(<Harness />);

    const line = await observedReconcile();
    expect(line).toHaveTextContent(RECONCILE_UNKNOWN);
  });
});
