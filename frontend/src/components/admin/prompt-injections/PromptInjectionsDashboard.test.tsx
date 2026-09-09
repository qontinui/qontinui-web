/**
 * Rendered-UI test for the prompt-injections dashboard.
 *
 * Post-merge follow-up to qontinui-web#1036 (Phase 3 Wave 5 of plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`). The route had
 * **no test of any kind** — the same coverage gap #1136 closed on
 * `/prompt-document-proposals`, and the reason Wave 5 could ship three R6
 * violations here while getting every one of them right on `/plan-library`.
 *
 * What is pinned, and why each one is a claim worth a test rather than a
 * rendering detail:
 *
 *  - a failed FIRST read never renders the empty state, and never renders `0`.
 *    Both are assertions about coord's corpus drawn from a read that answered
 *    nothing.
 *  - a failed REFETCH keeps its rows and SAYS they are old. Blanking them
 *    would discard rows the operator can still act on; staying silent would
 *    present 03:00's list as live.
 *  - a confirmed-empty read still says "empty", in the two different senses
 *    filtered and unfiltered carry. The unknown arm must not swallow this.
 *  - the detail panel's 404 is coord ANSWERING, not coord failing.
 *
 * The arms are driven through the real service module's error type, because
 * the 404 split branches on `PromptInjectionsApiError.status` — a mock that
 * threw a plain `Error` would pass the outage arm and prove nothing about the
 * split.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listPromptInjections = vi.fn();
const getPromptInjection = vi.fn();

vi.mock("@/services/prompt-injections-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/prompt-injections-api")
  >("@/services/prompt-injections-api");
  return {
    ...actual,
    listPromptInjections: (...a: unknown[]) => listPromptInjections(...a),
    getPromptInjection: (...a: unknown[]) => getPromptInjection(...a),
  };
});

import { PromptInjectionsApiError } from "@/services/prompt-injections-api";
import PromptInjectionsDashboard from "./PromptInjectionsDashboard";

const EVENT_A = "3f1c9d20-1111-4a5b-9c33-aaaaaaaaaaaa";
const EVENT_B = "3f1c9d20-2222-4a5b-9c33-bbbbbbbbbbbb";

function row(over: Record<string, unknown> = {}) {
  return {
    event_id: EVENT_A,
    source: "question_auto_answer",
    session_name: "merge-train-steward",
    agent_session_id: null,
    terminal_id: null,
    agent_id: null,
    device_id: null,
    trigger_kind: "regex",
    trigger_preview: "coord_ask_question returned a pending answer",
    injected_preview: "Answer: proceed.",
    truncated: false,
    policy_id: null,
    rule_id: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

/** Coord's envelope. `count` is `events.len()`, never a corpus total. */
function envelope(events: ReturnType<typeof row>[]) {
  return { events, count: events.length };
}

describe("PromptInjectionsDashboard — R6's failed-read arms", () => {
  beforeEach(() => {
    listPromptInjections.mockReset();
    getPromptInjection.mockReset();
  });

  it("a failed FIRST read is UNKNOWN — no empty state, and the count is a dash", async () => {
    // The defect this test exists for: `rows` sits at its `useState([])`,
    // which is byte-identical to a successful empty read, and `loading` is
    // already false. The page used to answer that with "No prompt injections
    // matching the current filters" — a claim about coord's corpus, printed
    // directly under its own "Failed to load" line.
    listPromptInjections.mockRejectedValue(
      new PromptInjectionsApiError(503, "upstream unavailable")
    );

    render(<PromptInjectionsDashboard />);

    const banner = await screen.findByTestId("prompt-injections-error");
    expect(banner).toHaveTextContent(/unknown, not empty/i);
    expect(screen.queryByTestId("prompt-injections-empty")).toBeNull();
    expect(screen.getByTestId("prompt-injections-count")).toHaveTextContent(
      "–"
    );
  });

  it("a failed REFETCH keeps its rows and says they may be out of date", async () => {
    // The stale arm. Blanking the rows would discard a list the operator can
    // still act on; saying nothing would present them as current.
    listPromptInjections
      .mockResolvedValueOnce(envelope([row()]))
      .mockRejectedValue(new Error("network down"));

    render(<PromptInjectionsDashboard />);
    expect(await screen.findAllByTestId("prompt-injections-row")).toHaveLength(
      1
    );

    await userEvent.click(screen.getByTestId("prompt-injections-refresh"));

    const banner = await screen.findByTestId("prompt-injections-error");
    expect(banner).toHaveTextContent(/may be out of date/i);
    // The row survived, and the count is a real number — not a dash. Once
    // coord has answered, a later failure is staleness, not ignorance.
    expect(screen.getAllByTestId("prompt-injections-row")).toHaveLength(1);
    expect(screen.getByTestId("prompt-injections-count")).toHaveTextContent(
      "1"
    );
  });

  it("a CONFIRMED empty read still says empty — the unknown arm does not swallow it", async () => {
    listPromptInjections.mockResolvedValue(envelope([]));

    render(<PromptInjectionsDashboard />);

    const empty = await screen.findByTestId("prompt-injections-empty");
    // Unfiltered: the sentence is about the READ, not about a query.
    expect(empty).toHaveTextContent(/returned no prompt injections/i);
    expect(screen.queryByTestId("prompt-injections-error")).toBeNull();
    expect(screen.getByTestId("prompt-injections-count")).toHaveTextContent(
      "0"
    );
  });

  it("an empty read UNDER a filter says the filter is what matched nothing", async () => {
    listPromptInjections.mockResolvedValue(envelope([]));

    render(<PromptInjectionsDashboard />);

    // Assert the UNFILTERED wording first. Without this the test is vacuous:
    // the pre-fix component printed "matching the current filters"
    // unconditionally, so the post-type assertion alone passes against it.
    expect(await screen.findByTestId("prompt-injections-empty")).toHaveTextContent(
      /returned no prompt injections for this workspace/i
    );

    await userEvent.type(
      screen.getByTestId("prompt-injections-session-input"),
      "no-such-session"
    );

    await waitFor(() =>
      expect(screen.getByTestId("prompt-injections-empty")).toHaveTextContent(
        /matching the current filters/i
      )
    );
  });

  it("an unfiltered empty read describes the READ, not coord's corpus", async () => {
    // Coord answers a MISSING prompt_injection_events table with
    // `200 {"events":[],"count":0}` (prompt_injections.rs:363), so an
    // unprovisioned schema is indistinguishable here from a genuinely empty
    // one. "Coord has recorded none" would be a corpus claim this wire cannot
    // support.
    listPromptInjections.mockResolvedValue(envelope([]));

    render(<PromptInjectionsDashboard />);

    const empty = await screen.findByTestId("prompt-injections-empty");
    expect(empty).toHaveTextContent(/returned no prompt injections/i);
    expect(empty).not.toHaveTextContent(/has recorded/i);
  });

  it("a CONFIRMED empty read followed by a failed refresh stops asserting the emptiness", async () => {
    // The state `readIsUnknown` keys on `loaded` rather than `rows.length` for:
    // coord confirmed empty, a later read failed. The emptiness is now a PAST
    // answer and must not be restated in the present tense under a failure.
    listPromptInjections
      .mockResolvedValueOnce(envelope([]))
      .mockRejectedValue(new Error("network down"));

    render(<PromptInjectionsDashboard />);
    await screen.findByTestId("prompt-injections-empty");

    await userEvent.click(screen.getByTestId("prompt-injections-refresh"));

    const banner = await screen.findByTestId("prompt-injections-error");
    expect(banner).toHaveTextContent(/last successful read found none/i);
    // and crucially, the present-tense corpus sentence is gone.
    expect(screen.queryByTestId("prompt-injections-empty")).toBeNull();
    // "Showing the last rows loaded" would be a lie with zero rows on screen.
    expect(banner).not.toHaveTextContent(/showing the last rows/i);
  });
});

describe("PromptInjectionsDashboard — a filter set is this route's param", () => {
  beforeEach(() => {
    listPromptInjections.mockReset();
    getPromptInjection.mockReset();
  });

  it("a read that fails under NEW filters is UNKNOWN, not stale", async () => {
    // The blocker in this file's first cut. A global `loaded` boolean stayed
    // true across the filter change, so `unknown` was false and the page took
    // the stale arm — printing "No prompt injections matching the current
    // filters" (arm 1, re-opened) beneath a failure banner.
    listPromptInjections
      .mockResolvedValueOnce(envelope([]))
      .mockRejectedValue(new PromptInjectionsApiError(503, "down"));

    render(<PromptInjectionsDashboard />);
    await screen.findByTestId("prompt-injections-empty");

    await userEvent.type(
      screen.getByTestId("prompt-injections-session-input"),
      "q"
    );

    const banner = await screen.findByTestId("prompt-injections-error");
    expect(banner).toHaveTextContent(/unknown, not empty/i);
    expect(screen.queryByTestId("prompt-injections-empty")).toBeNull();
    expect(screen.getByTestId("prompt-injections-count")).toHaveTextContent(
      "–"
    );
  });

  it("never shows rows fetched under a DIFFERENT filter set", async () => {
    // Stale means "an old answer to this question". Showing the unfiltered
    // row under a session filter it was never tested against is an answer to
    // a different question wearing the current filter's chrome.
    listPromptInjections
      .mockResolvedValueOnce(envelope([row()]))
      .mockRejectedValue(new PromptInjectionsApiError(503, "down"));

    render(<PromptInjectionsDashboard />);
    expect(await screen.findAllByTestId("prompt-injections-row")).toHaveLength(
      1
    );

    await userEvent.type(
      screen.getByTestId("prompt-injections-session-input"),
      "zzz"
    );

    await screen.findByTestId("prompt-injections-error");
    expect(screen.queryAllByTestId("prompt-injections-row")).toHaveLength(0);
    expect(screen.getByTestId("prompt-injections-count")).toHaveTextContent(
      "–"
    );
  });

  it("a superseded read on the SAME filters does not paint stale over fresh rows", async () => {
    // This is the case the sequence guard actually carries, and the reason it
    // is not redundant with the filter key: BOTH reads carry the same key, so
    // the key cannot discriminate them and only ordering can.
    //
    // Reachable without touching the filters at all — a poll tick does not set
    // `loading`, so a manual refresh can overlap one, and two poll ticks can
    // overlap each other. Here the mount read hangs, a poll tick supersedes it
    // with real rows, and the mount read then rejects.
    vi.useFakeTimers();
    try {
      let failFirst: (e: unknown) => void = () => {};
      listPromptInjections
        .mockImplementationOnce(
          () => new Promise((_, reject) => (failFirst = reject))
        )
        .mockResolvedValue(envelope([row()]));

      render(<PromptInjectionsDashboard />);

      // Drive one poll tick; that read resolves with a row.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_001);
      });
      expect(screen.getAllByTestId("prompt-injections-row")).toHaveLength(1);

      // Now the superseded mount read fails, late.
      await act(async () => {
        failFirst(new PromptInjectionsApiError(503, "the OLD request died"));
      });

      expect(screen.queryByTestId("prompt-injections-error")).toBeNull();
      expect(screen.getAllByTestId("prompt-injections-row")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a superseded read under OLD filters is discarded by the key too", async () => {
    // The belt to the sequence guard's braces: even if ordering were lost, a
    // failure stamped with the previous filter set is not about this one.
    let failFirst: (e: unknown) => void = () => {};
    listPromptInjections
      .mockImplementationOnce(
        () => new Promise((_, reject) => (failFirst = reject))
      )
      .mockResolvedValue(envelope([row()]));

    render(<PromptInjectionsDashboard />);
    await userEvent.type(
      screen.getByTestId("prompt-injections-session-input"),
      "a"
    );
    expect(await screen.findAllByTestId("prompt-injections-row")).toHaveLength(
      1
    );

    failFirst(new PromptInjectionsApiError(503, "the OLD request died"));

    await waitFor(() =>
      expect(screen.queryByTestId("prompt-injections-error")).toBeNull()
    );
    expect(screen.getAllByTestId("prompt-injections-row")).toHaveLength(1);
  });
});

describe("PromptInjectionsDashboard — the fields the wire carried and nothing read", () => {
  beforeEach(() => {
    listPromptInjections.mockReset();
    getPromptInjection.mockReset();
  });

  it("marks a row whose preview COORD cut, distinct from CSS clipping", async () => {
    listPromptInjections.mockResolvedValue(
      envelope([row({ truncated: true })])
    );

    render(<PromptInjectionsDashboard />);

    expect(await screen.findByTestId("pinj-row-truncated")).toBeInTheDocument();
  });

  it("leaves an untruncated row unmarked", async () => {
    listPromptInjections.mockResolvedValue(envelope([row()]));

    render(<PromptInjectionsDashboard />);
    await screen.findAllByTestId("prompt-injections-row");

    expect(screen.queryByTestId("pinj-row-truncated")).toBeNull();
  });

  it("renders trigger_kind and metadata in the expanded detail", async () => {
    listPromptInjections.mockResolvedValue(envelope([row()]));
    getPromptInjection.mockResolvedValue({
      event_id: EVENT_A,
      tenant_id: null,
      source: "question_auto_answer",
      agent_session_id: null,
      session_name: "merge-train-steward",
      terminal_id: null,
      agent_id: null,
      device_id: null,
      trigger_kind: "regex",
      trigger_text: "the full triggering output",
      injected_prompt: "the full injected prompt",
      policy_id: null,
      rule_id: null,
      created_at: new Date().toISOString(),
      metadata: { rule: "auto-answer", attempt: 2 },
    });

    render(<PromptInjectionsDashboard />);
    await userEvent.click(
      (await screen.findAllByTestId("prompt-injections-row"))[0]
    );

    const detail = await screen.findByTestId("pinj-detail");
    expect(detail).toHaveTextContent("regex");
    expect(await screen.findByTestId("pinj-metadata")).toHaveTextContent(
      "auto-answer"
    );
  });

  it("renders no metadata block when the bag is empty", async () => {
    listPromptInjections.mockResolvedValue(envelope([row()]));
    getPromptInjection.mockResolvedValue({
      event_id: EVENT_A,
      tenant_id: null,
      source: "question_auto_answer",
      agent_session_id: null,
      session_name: null,
      terminal_id: null,
      agent_id: null,
      device_id: null,
      trigger_kind: "regex",
      trigger_text: null,
      injected_prompt: "p",
      policy_id: null,
      rule_id: null,
      created_at: new Date().toISOString(),
      metadata: {},
    });

    render(<PromptInjectionsDashboard />);
    await userEvent.click(
      (await screen.findAllByTestId("prompt-injections-row"))[0]
    );

    await screen.findByTestId("pinj-detail");
    expect(screen.queryByTestId("pinj-metadata")).toBeNull();
  });
});

describe("PromptInjectionsDashboard — a 404 is an ANSWER", () => {
  beforeEach(() => {
    listPromptInjections.mockReset();
    getPromptInjection.mockReset();
  });

  it("reports a missing event as absent, not as an outage", async () => {
    listPromptInjections.mockResolvedValue(envelope([row({ event_id: EVENT_B })]));
    getPromptInjection.mockRejectedValue(
      new PromptInjectionsApiError(404, "not found")
    );

    render(<PromptInjectionsDashboard />);
    await userEvent.click(
      (await screen.findAllByTestId("prompt-injections-row"))[0]
    );

    expect(
      await screen.findByTestId("pinj-detail-not-found")
    ).toHaveTextContent(/an answer, not a failed read/i);
    expect(screen.queryByTestId("pinj-detail-error")).toBeNull();
  });

  it("still reports a genuine outage as one", async () => {
    // The negative control. It is NOT what proves the keying — it passes
    // against the unfixed component too, and with `notFound` hardwired false.
    // The positive case above is the one that proves it: its message is
    // "not found", which `isNotFoundError`'s /\sfailed:\s404\s-\s/ would NOT
    // match, so only a branch on the structured `.status` can classify it.
    // This arm exists so the fix cannot over-apply and call every unreachable
    // coord a tidy "no such event".
    listPromptInjections.mockResolvedValue(envelope([row({ event_id: EVENT_B })]));
    getPromptInjection.mockRejectedValue(
      new PromptInjectionsApiError(502, "bad gateway")
    );

    render(<PromptInjectionsDashboard />);
    await userEvent.click(
      (await screen.findAllByTestId("prompt-injections-row"))[0]
    );

    expect(await screen.findByTestId("pinj-detail-error")).toHaveTextContent(
      /502/
    );
    expect(screen.queryByTestId("pinj-detail-not-found")).toBeNull();
  });
});

describe("PromptInjectionsDashboard — truncation is derived, because no total exists", () => {
  beforeEach(() => {
    listPromptInjections.mockReset();
    getPromptInjection.mockReset();
  });

  it("says the list is capped when a full page comes back", async () => {
    // Coord's `count` is `events.len()` over rows already LIMITed, so a full
    // page is the ONLY evidence on the wire that older events exist. Without
    // this the badge reads "200" as if that were the corpus.
    const full = Array.from({ length: 200 }, (_, i) =>
      row({ event_id: `3f1c9d20-0000-4a5b-9c33-${String(i).padStart(12, "0")}` })
    );
    listPromptInjections.mockResolvedValue(envelope(full));

    render(<PromptInjectionsDashboard />);

    expect(
      await screen.findByTestId("prompt-injections-capped")
    ).toHaveTextContent(/newest 200/i);
    expect(screen.getByTestId("prompt-injections-count")).toHaveTextContent(
      "200+"
    );
  });

  it("says nothing about capping on a short page", async () => {
    listPromptInjections.mockResolvedValue(envelope([row()]));

    render(<PromptInjectionsDashboard />);
    await screen.findAllByTestId("prompt-injections-row");

    expect(screen.queryByTestId("prompt-injections-capped")).toBeNull();
  });

  it("says nothing about capping on an UNKNOWN read", async () => {
    // `capped` is derived from `rows.length === LIST_LIMIT`, and on an unknown
    // read `rows` is the derived empty — so this is really asserting that the
    // cap notice cannot be resurrected by a stale answer under new filters.
    listPromptInjections.mockRejectedValue(
      new PromptInjectionsApiError(503, "down")
    );

    render(<PromptInjectionsDashboard />);
    await screen.findByTestId("prompt-injections-error");

    expect(screen.queryByTestId("prompt-injections-capped")).toBeNull();
    expect(screen.getByTestId("prompt-injections-count")).toHaveTextContent(
      "–"
    );
  });
});
