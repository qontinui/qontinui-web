/**
 * `/admin/coord/questions/[id]` — absence is UNKNOWN, not "not found".
 *
 * Follow-up to #1110, which removed the false all-clear from the INBOX and
 * amended R6 of `docs/console-ui-style-guide.md` to say a failed read needs
 * its own flag that every derived surface consults. Its sweep looked for
 * `RecordList`'s `empty=` prop and so never reached this route, where the same
 * slot is the trailing arm of a `question === null` ternary. That arm said
 * **"Question {id} not found."** for a read that failed — the inbox's green
 * all-clear in the singular, and a stronger claim, because it tells the
 * operator the record is GONE.
 *
 * This route had NO test file before this one, so every assertion below is
 * new ground rather than a tightened existing one.
 *
 * Each assertion checks **both directions** — the honest copy present AND the
 * false claim gone — for the reason #1110's tests give: a build that rendered
 * both would still be reassuring, and reassurance is the failure mode.
 *
 * The last block extends the same rule to the THIRD terminal state, `withdrawn`
 * (plan
 * `2026-09-20-a-pending-operator-question-outlives-the-condition-that-motivated-it`):
 * a live composer over a row that must not be answered is the same hazard as a
 * live composer over a body that could not be read.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

let routeId: string | undefined = "q-1";
vi.mock("next/navigation", () => ({
  useParams: () => (routeId === undefined ? {} : { id: routeId }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { email: "op@example.com" } }),
}));

// Not under test, and ESM-only — the markdown renderer would drag remark's
// whole ESM chain into this suite for a `<Context>` panel nothing asserts.
vi.mock("react-markdown", () => ({
  default: ({ children }: { children?: string }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => undefined }));

// `DestructiveButton` refuses synthetic clicks (`isTrusted === false`), which
// every jsdom `fireEvent.click` is. Swapped for a plain button so the proposal
// approve CONFIRM step can be driven; the confirm step itself is what is
// under test here, not the synthetic-click gate.
vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import CoordQuestionDetailPage from "./page";

const QUESTION = {
  question_id: "q-1",
  agent_id: "01a01de1-9d08-7c31-a055-271ad6df6217",
  question: "Bump or pin the dependency?",
  created_at: "2026-08-20T09:00:00Z",
};

/** The shape `httpClient.get` throws — the status is embedded in the message. */
const httpError = (status: number) =>
  new Error(`GET /api/v1/operations/agent-questions/q-1 failed: ${status} - x`);

beforeEach(() => {
  routeId = "q-1";
  get.mockReset();
  post.mockReset();
});

describe("a read that never landed is UNKNOWN, not 'not found'", () => {
  it("does not claim the question is missing when coord is unreachable", async () => {
    get.mockRejectedValue(new Error("Failed to fetch"));

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("coord-question-unreadable")
      ).toBeInTheDocument();
    });
    // The honest claim, in the operator's own words.
    expect(screen.getByTestId("coord-question-unreadable")).toHaveTextContent(
      /could not be read/
    );
    expect(screen.getByTestId("coord-question-unreadable")).toHaveTextContent(
      /unknown/
    );
    // And the false one is GONE, not merely accompanied.
    expect(
      screen.queryByTestId("coord-question-not-found")
    ).not.toBeInTheDocument();
  });

  it("treats a 500 as unreadable too — only a 404 is coord answering", async () => {
    get.mockRejectedValue(httpError(500));

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("coord-question-unreadable")
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("coord-question-not-found")
    ).not.toBeInTheDocument();
  });

  it("treats an unrecognised 200 as unreadable, not as a question", async () => {
    // A wrapper body, a coord error envelope or a `null` all pass
    // `typeof body === "object"`. The blind cast this replaces made `question`
    // a TRUTHY object with every field undefined, which rendered an empty
    // heading above a LIVE composer — an operator could answer a question
    // they were never shown.
    get.mockResolvedValue({ detail: "not authorized" });

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("coord-question-unreadable")
      ).toBeInTheDocument();
    });
    // The composer must not be live over a body we could not read.
    expect(
      screen.queryByTestId("coord-question-response-textarea")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-question-submit")
    ).not.toBeInTheDocument();
  });

  it("treats a null 200 body as unreadable rather than as a missing row", async () => {
    get.mockResolvedValue(null);

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("coord-question-unreadable")
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("coord-question-not-found")
    ).not.toBeInTheDocument();
  });
});

describe("over-correction guards — coord ANSWERING is still real information", () => {
  it("keeps the calm 'not found' copy for a 404, and no failure banner", async () => {
    get.mockRejectedValue(httpError(404));

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("coord-question-not-found")
      ).toBeInTheDocument();
    });
    // Reports the fact and names the readings; it must NOT diagnose one.
    // Coord's lookup filters on tenant as well as id, and a 404 can be raised
    // by something in the chain that never reached coord.
    const copy = screen.getByTestId("coord-question-not-found");
    expect(copy).toHaveTextContent(/was not returned/);
    expect(copy).toHaveTextContent(/no such question exists for this tenant/);
    expect(copy).toHaveTextContent(/never reached coord/);
    // Not flattened into the unknown arm...
    expect(
      screen.queryByTestId("coord-question-unreadable")
    ).not.toBeInTheDocument();
    // ...and not reported as a load failure either: coord answered.
    expect(screen.queryByText(/Failed to load:/)).not.toBeInTheDocument();
  });

  it("still renders a question that was read successfully", async () => {
    get.mockResolvedValue(QUESTION);

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId("coord-question-meta")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Bump or pin the dependency?")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("coord-question-response-textarea")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-question-unreadable")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-question-not-found")
    ).not.toBeInTheDocument();
  });
});

describe("a route with no id explains itself instead of loading forever", () => {
  it("clears the skeleton rather than pinning it", async () => {
    routeId = undefined;
    get.mockResolvedValue(QUESTION);

    const { container } = render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId("coord-question-no-id")).toBeInTheDocument();
    });
    // Not the generic unreadable copy, which would interpolate an empty id
    // into "Question  could not be read".
    expect(
      screen.queryByTestId("coord-question-unreadable")
    ).not.toBeInTheDocument();
    // The bail used to skip the `finally`, leaving `loading` true forever:
    // a skeleton, no error, indistinguishable from a slow read.
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("a superseded read cannot paint the previous question under the new id", () => {
  it("drops question A's slow response after the route moved to B", async () => {
    // App Router keeps this component MOUNTED across an `[id]` change, so the
    // effect re-runs rather than the state being thrown away. Without the
    // generation guard, A's late `setQuestion` wins — the operator reads
    // question A while the breadcrumb, and `onSubmit`'s POST, both say B.
    // Answering the wrong agent is the failure this closes.
    let releaseA: (v: unknown) => void = () => {};
    const A = { question_id: "q-A", question: "Question A — do NOT show me" };
    const B = { question_id: "q-B", question: "Question B — the current one" };

    get.mockImplementation((url: string) =>
      url.includes("q-A")
        ? new Promise((resolve) => {
            releaseA = resolve;
          })
        : Promise.resolve(B)
    );

    routeId = "q-A";
    const { rerender } = render(<CoordQuestionDetailPage />);

    routeId = "q-B";
    rerender(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(B.question)).toBeInTheDocument();
    });

    // A finally answers, too late.
    releaseA(A);
    await Promise.resolve();

    await waitFor(() => {
      expect(screen.getByText(B.question)).toBeInTheDocument();
    });
    expect(screen.queryByText(A.question)).not.toBeInTheDocument();
  });

  // Pinned by the `setQuestion(null)` RESET on an id change, not by the seq
  // guard -- deleting the guards leaves this green. Named so a future editor
  // removing the reset knows which test guards it.
  it("[reset] does not resurrect the previous question when the new id fails to read", async () => {
    // The same hazard by the other door: B's read fails, and a retained A
    // would render A's text — beside a live composer that posts to B — under
    // a red banner that looks like it is only about freshness.
    const A = { question_id: "q-A", question: "Question A — do NOT show me" };
    get.mockImplementation((url: string) =>
      url.includes("q-A")
        ? Promise.resolve(A)
        : Promise.reject(new Error("Failed to fetch"))
    );

    routeId = "q-A";
    const { rerender } = render(<CoordQuestionDetailPage />);
    await waitFor(() => {
      expect(screen.getByText(A.question)).toBeInTheDocument();
    });

    routeId = "q-B";
    rerender(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("coord-question-unreadable")
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(A.question)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-question-response-textarea")
    ).not.toBeInTheDocument();
  });
});

describe("the guards a stale read must not get past", () => {
  it("[finally] does not claim B is unreadable when A's read settles late", async () => {
    // The `finally` seq guard. Without it, A settling after B was requested
    // runs `setLoading(false)` while B is still in flight — and `question` is
    // null (the id-change reset), `notFound` false, so the page renders
    // "Question q-B could not be read … is unknown". A definite unknown-claim
    // off a read that has not failed: this PR's own defect, inverted.
    let releaseA: (v: unknown) => void = () => {};
    get.mockImplementation((url: string) =>
      url.includes("q-A")
        ? new Promise((resolve) => {
            releaseA = resolve;
          })
        : new Promise(() => {}) // B never settles
    );

    routeId = "q-A";
    const { container, rerender } = render(<CoordQuestionDetailPage />);
    routeId = "q-B";
    rerender(<CoordQuestionDetailPage />);

    releaseA({ question_id: "q-A", question: "Question A" });
    await waitFor(() => {
      expect(container.querySelector(".animate-pulse")).toBeTruthy();
    });

    // B is still in flight — nothing is known yet, and nothing is claimed.
    expect(
      screen.queryByTestId("coord-question-unreadable")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-question-not-found")
    ).not.toBeInTheDocument();
  });

  it("[catch] does not banner A's failure while B is still in flight", async () => {
    // The catch-arm seq guard. Its observable consequence is narrow, and worth
    // stating precisely rather than overclaiming: a stale `setNotFound` is
    // masked (`shown` wins, and `loading` covers the in-flight window), but a
    // stale non-404 `setError` is NOT -- the banner is `{error && !notFound}`,
    // so A's failure paints a red "Failed to load" over B's skeleton, about a
    // read that has been superseded and is no longer on screen.
    let rejectA: (e: unknown) => void = () => {};
    get.mockImplementation((url: string) =>
      url.includes("q-A")
        ? new Promise((_r, reject) => {
            rejectA = reject;
          })
        : new Promise(() => {}) // B never settles
    );

    routeId = "q-A";
    const { container, rerender } = render(<CoordQuestionDetailPage />);
    routeId = "q-B";
    rerender(<CoordQuestionDetailPage />);

    rejectA(httpError(500));
    await waitFor(() => {
      expect(container.querySelector(".animate-pulse")).toBeTruthy();
    });

    expect(screen.queryByText(/Failed to load:/)).not.toBeInTheDocument();
  });

  it("[identity] never renders a question whose id is not the route's", async () => {
    // The render-time identity check, which closes the SYNCHRONOUS door the
    // seq guard cannot: the id-change reset lives in an effect, and React
    // commits the render that ran with the new `id` and the old `question`
    // before effects fire. That frame would paint A's text, options and a LIVE
    // composer under breadcrumb B, with `onSubmit` posting to B.
    //
    // Asserted directly rather than by frame-timing: a response whose
    // `question_id` disagrees with the route id is never displayed.
    get.mockResolvedValue({
      question_id: "q-OTHER",
      question: "A different question entirely",
    });

    const { container } = render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(get).toHaveBeenCalled();
    });
    expect(
      screen.queryByText("A different question entirely")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-question-response-textarea")
    ).not.toBeInTheDocument();
    // Treated as "the read for THIS id has not landed", not as an absence.
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
    expect(
      screen.queryByTestId("coord-question-unreadable")
    ).not.toBeInTheDocument();
  });

  it("[identity] accepts a canonical-case id against a differently-cased route", async () => {
    // Coord returns a canonical lowercase uuid; the route id is whatever was
    // pasted. An exact-match comparison would render a legitimate question as
    // permanently pending — the over-correction guard for the check above.
    routeId = "00000000-0000-0000-0000-DEADBEEF0001";
    get.mockResolvedValue({
      question_id: "00000000-0000-0000-0000-deadbeef0001",
      question: "Bump or pin the dependency?",
    });

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Bump or pin the dependency?")
      ).toBeInTheDocument();
    });
  });
});

describe("a WITHDRAWN question offers no composer — nobody is waiting on it", () => {
  // The defect this pins: `withdrawn_at` is set while `responded_at` stays
  // NULL, so the page's old two-valued `answered` predicate read a withdrawn
  // row as PENDING. The badge said "withdrawn" — it comes off the
  // three-valued `deriveQuestionStatus` — while the section below it rendered
  // the "Respond" heading, a live textarea, an enabled "Send response" and
  // enabled option cards. Submitting POSTs to a door coord will refuse.
  const WITHDRAWN = {
    ...QUESTION,
    options: ["override the hold", "wait for CI"],
    withdrawn_at: "2026-09-20T09:10:00Z",
    withdrawn_by: "auto:predicate",
    withdrawal_reason: "qontinui-web#1393 landed at 2026-09-20T08:54:33Z",
  };

  it("renders NO response composer", async () => {
    get.mockResolvedValue(WITHDRAWN);

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId("coord-question-meta")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("coord-question-response-textarea")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-question-submit")
    ).not.toBeInTheDocument();
    // And not the invitation either: the heading is the record, not the ask.
    expect(screen.queryByText("Respond")).not.toBeInTheDocument();
    expect(screen.getByText("Withdrawal record")).toBeInTheDocument();
  });

  it("leaves NO option button enabled — the other way into the composer", async () => {
    get.mockResolvedValue(WITHDRAWN);

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId("coord-question-options")).toBeInTheDocument();
    });
    const cards = screen.getAllByTestId("coord-question-option-card");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card).toBeDisabled();
    }
  });

  it("shows the withdrawal record where an answered row shows its response", async () => {
    get.mockResolvedValue(WITHDRAWN);

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("coord-question-withdrawal-detail")
      ).toBeInTheDocument();
    });
    const block = screen.getByTestId("coord-question-withdrawal-detail");
    expect(block).toHaveTextContent(/Withdrawn/);
    expect(block).toHaveTextContent("auto:predicate");
    expect(block).toHaveTextContent("#1393 landed");
  });

  it("says coord recorded no reason rather than rendering an empty block", async () => {
    // Coord requires a reason on the withdrawal door, so an absent one is a
    // claim about THIS read — never a withdrawal that had no cause.
    get.mockResolvedValue({
      ...QUESTION,
      withdrawn_at: "2026-09-20T09:10:00Z",
    });

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("coord-question-withdrawal-detail")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("coord-question-withdrawal-detail")
    ).toHaveTextContent("coord recorded no reason for this withdrawal");
  });

  it("prefers the withdrawal record when a row somehow carries both stamps", async () => {
    // Defensive, and it must agree with `deriveQuestionStatus`, which tests
    // `withdrawn_at` first: the console can explain a withdrawal record and
    // cannot reconcile a response against one.
    get.mockResolvedValue({
      ...WITHDRAWN,
      responded_at: "2026-09-20T09:00:00Z",
      response: "go ahead",
      responded_by_operator: "josh@qontinui.io",
    });

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("coord-question-withdrawal-detail")
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Withdrawal record")).toBeInTheDocument();
    expect(screen.queryByText("go ahead")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-question-response-textarea")
    ).not.toBeInTheDocument();
  });

  it("[over-correction] still offers the composer on a PENDING question with options", async () => {
    // The mirror guard: `withdrawn` must not have made every option card dead.
    get.mockResolvedValue({
      ...QUESTION,
      options: ["override the hold", "wait for CI"],
    });

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("coord-question-response-textarea")
      ).toBeInTheDocument();
    });
    for (const card of screen.getAllByTestId("coord-question-option-card")) {
      expect(card).toBeEnabled();
    }
    expect(screen.getByText("Respond")).toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-question-withdrawal-detail")
    ).not.toBeInTheDocument();
  });

  it("[over-correction] still renders an ANSWERED question read-only", async () => {
    get.mockResolvedValue({
      ...QUESTION,
      options: ["override the hold"],
      responded_at: "2026-09-20T09:00:00Z",
      response: "pin it",
      responded_by_operator: "josh@qontinui.io",
    });

    render(<CoordQuestionDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Recorded response")).toBeInTheDocument();
    });
    expect(screen.getByText("pin it")).toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-question-response-textarea")
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByTestId("coord-question-option-card")[0]
    ).toBeDisabled();
    expect(
      screen.queryByTestId("coord-question-withdrawal-detail")
    ).not.toBeInTheDocument();
  });
});

describe("an [id] change clears the draft written for the previous question", () => {
  it("does not carry question A's draft into question B's composer", async () => {
    // The third door onto the wrong-question hazard the generation guard and
    // the identity check already close from the READ side. Both of those are
    // about which row is displayed; the draft is WRITE state, so neither could
    // see it. App Router keeps this component mounted across an `[id]` change,
    // so `response` and `selectedOption` simply persisted — A's sentence
    // pre-filled B's textarea, and `onSubmit` posts to `id`, which is B.
    const A = {
      ...QUESTION,
      question_id: "q-1",
      question: "Bump or pin the dependency?",
      options: ["bump", "pin"],
    };
    const B = {
      ...QUESTION,
      question_id: "q-2",
      question: "Revert the migration or roll forward?",
      // "bump" is DELIBERATELY shared with A. Were B's options disjoint from
      // A's, a stale `selectedOption` would match no B card and the
      // border-primary loop below would pass with or without
      // `setSelectedOption(null)` — i.e. it would assert nothing. The overlap
      // is what makes that half of the reset actually pinned.
      options: ["bump", "roll forward"],
    };
    get.mockImplementation(async (url: string) =>
      url.endsWith("/q-2") ? B : A
    );

    routeId = "q-1";
    const { rerender } = render(<CoordQuestionDetailPage />);
    await waitFor(() => {
      expect(
        screen.getByText("Bump or pin the dependency?")
      ).toBeInTheDocument();
    });

    // Stage the draft with the option card ALONE, which sets BOTH halves at
    // once (`onClick` does `setSelectedOption(value); setResponse(value)`).
    //
    // Deliberately do NOT also edit the textarea here, however operator-like
    // that would read: the composer's own `onChange` calls
    // `setSelectedOption(null)`, so typing would null the selection BEFORE the
    // route change and the border-primary loop below could never bite — it
    // would pass whether or not the `[id]` effect resets anything. Staging by
    // click keeps both halves live across the navigation, which is what makes
    // this test pin both. The textarea-edit path is NOT exercised here, so it
    // gets its own test below rather than being left uncovered.
    fireEvent.click(screen.getAllByTestId("coord-question-option-card")[0]);
    expect(screen.getByTestId("coord-question-response-textarea")).toHaveValue(
      "bump"
    );
    expect(
      screen.getAllByTestId("coord-question-option-card")[0].className
    ).toContain("border-primary");

    routeId = "q-2";
    rerender(<CoordQuestionDetailPage />);
    await waitFor(() => {
      expect(
        screen.getByText("Revert the migration or roll forward?")
      ).toBeInTheDocument();
    });

    // The draft is gone — not merely hidden behind B's own text.
    expect(screen.getByTestId("coord-question-response-textarea")).toHaveValue(
      ""
    );
    // ...and so is the staged option selection, which is the other half of the
    // draft: `selectedOption` survives independently of `response`. B shares
    // the "bump" option with A precisely so a surviving selection WOULD paint
    // one of these cards — see the note on B's `options` above. Both halves of
    // this assertion are mutation-proved: removing either setter from the
    // `[id]` effect fails this test.
    for (const card of screen.getAllByTestId("coord-question-option-card")) {
      expect(card.className).not.toContain("border-primary");
    }
    // The send button is disabled again, because an empty draft is what
    // disables it — the end-to-end statement that nothing is submittable yet.
    expect(screen.getByTestId("coord-question-submit")).toBeDisabled();
  });
});

describe("the composer's own onChange", () => {
  // This is the ONLY test that types into the textarea, and it exists because
  // the route-change test above deliberately does not. `onChange` does two
  // things -- `setResponse(e.target.value)` AND `setSelectedOption(null)` --
  // and before this test neither was pinned: deleting the whole handler body
  // left the suite green. The second half matters out of proportion to its
  // size: misreading exactly that line is what produced a wrong diagnosis
  // during review, when the route-change test's option assertion was found
  // vacuous and the cause was attributed to the option VALUES rather than to
  // this setter nulling the selection first.
  it("sets the response and clears a staged option selection", async () => {
    get.mockResolvedValue({
      ...QUESTION,
      question_id: "q-1",
      options: ["bump", "pin"],
    });

    render(<CoordQuestionDetailPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId("coord-question-response-textarea")
      ).toBeInTheDocument();
    });

    // Stage a selection first, so there is something for onChange to clear.
    fireEvent.click(screen.getAllByTestId("coord-question-option-card")[0]);
    expect(
      screen.getAllByTestId("coord-question-option-card")[0].className
    ).toContain("border-primary");

    fireEvent.change(screen.getByTestId("coord-question-response-textarea"), {
      target: { value: "bump, and pin the transitive one" },
    });

    // Half one: the typed text is the response.
    expect(screen.getByTestId("coord-question-response-textarea")).toHaveValue(
      "bump, and pin the transitive one"
    );
    // Half two: the staged selection is dropped, because the text no longer
    // says what the card said. Nothing asserted this before.
    for (const card of screen.getAllByTestId("coord-question-option-card")) {
      expect(card.className).not.toContain("border-primary");
    }
  });
});

/**
 * Decision effects — plan
 * `2026-09-12-one-decision-row-one-inbox-clause-model-is-the-home-for-proposed-policy`
 * Phases 2–3. An effect row is answered through the SAME `/respond` door, but
 * only with the effect's canonical values — coord routes them through the
 * gate / proposal core, which cannot apply free text. So the composer is
 * replaced by one button per value, and the body POSTed is pinned here.
 */
describe("a decision-effect row is answered with the effect's own values", () => {
  const GATE_ROW = {
    ...QUESTION,
    question: "Approve phase 2 of wu-42?",
    options: ["met", "not_met"],
    effect_kind: "gate",
    effect_ref: {
      id: "gate-7",
      gate_id: "gate-7",
      work_unit_id: "wu-42",
      phase_name: "Phase 2",
    },
  };

  function decisionButtons(): HTMLElement[] {
    return screen.queryAllByTestId("coord-question-effect-decision");
  }

  it("posts `met` for a gate row, to the existing respond door", async () => {
    get.mockResolvedValue(GATE_ROW);
    post.mockResolvedValue({});
    render(<CoordQuestionDetailPage />);

    await waitFor(() => expect(decisionButtons()).toHaveLength(2));
    expect(decisionButtons().map((b) => b.getAttribute("data-decision-value")))
      .toEqual(["met", "not_met"]);
    // No free-text composer and no seed-the-composer option cards.
    expect(
      screen.queryByTestId("coord-question-response-textarea")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-question-options")
    ).not.toBeInTheDocument();
    // The linked chip names the gate's work unit and phase.
    expect(
      screen.getByTestId("coord-question-effect-link").getAttribute("href")
    ).toBe("/admin/coord/gates?gate=gate-7");
    expect(screen.getByTestId("coord-question-effect-detail")).toHaveTextContent(
      "wu-42 · Phase 2"
    );

    fireEvent.click(decisionButtons()[0]);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      "/api/v1/operations/agent-questions/q-1/respond",
      { response: "met", responded_by_operator: "op@example.com" }
    );
  });

  it("posts `not_met` for the gate's second button", async () => {
    get.mockResolvedValue(GATE_ROW);
    post.mockResolvedValue({});
    render(<CoordQuestionDetailPage />);
    await waitFor(() => expect(decisionButtons()).toHaveLength(2));
    fireEvent.click(decisionButtons()[1]);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/operations/agent-questions/q-1/respond",
        { response: "not_met", responded_by_operator: "op@example.com" }
      )
    );
  });

  const PROPOSAL_ROW = {
    ...QUESTION,
    options: ["approve", "reject"],
    effect_kind: "proposal",
    effect_ref: { id: "p-1", proposal_id: "p-1" },
  };

  it("posts `approve` for a proposal row only after the confirm step", async () => {
    get.mockResolvedValue(PROPOSAL_ROW);
    post.mockResolvedValue({});
    render(<CoordQuestionDetailPage />);
    await waitFor(() => expect(decisionButtons()).toHaveLength(2));
    expect(
      screen.getByTestId("coord-question-effect-link").getAttribute("href")
    ).toBe("/admin/coord/prompt-document-proposals?proposal=p-1");

    // One click opens the confirm dialog; it does NOT apply the edit.
    fireEvent.click(decisionButtons()[0]);
    const dialog = await screen.findByTestId("coord-question-approve-confirm");
    expect(post).not.toHaveBeenCalled();
    // The dialog carries the way to the diff at the moment of decision.
    expect(
      screen
        .getByTestId("coord-question-approve-confirm-review-link")
        .getAttribute("href")
    ).toBe("/admin/coord/prompt-document-proposals?proposal=p-1");
    expect(dialog).toHaveTextContent(/Approve and apply/);

    fireEvent.click(screen.getByTestId("coord-question-approve-confirm-confirm"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/operations/agent-questions/q-1/respond",
        { response: "approve", responded_by_operator: "op@example.com" }
      )
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("cancelling the approve confirm posts nothing", async () => {
    get.mockResolvedValue(PROPOSAL_ROW);
    render(<CoordQuestionDetailPage />);
    await waitFor(() => expect(decisionButtons()).toHaveLength(2));
    fireEvent.click(decisionButtons()[0]);
    await screen.findByTestId("coord-question-approve-confirm");
    fireEvent.click(screen.getByTestId("coord-question-approve-confirm-cancel"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("coord-question-approve-confirm")
      ).not.toBeInTheDocument()
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("puts a review-the-diff link inside the proposal decision block", async () => {
    get.mockResolvedValue(PROPOSAL_ROW);
    render(<CoordQuestionDetailPage />);
    await waitFor(() => expect(decisionButtons()).toHaveLength(2));
    const link = screen.getByTestId("coord-question-effect-review-link");
    expect(link).toHaveTextContent("Open proposal to review the diff");
    expect(link.getAttribute("href")).toBe(
      "/admin/coord/prompt-document-proposals?proposal=p-1"
    );
    expect(
      screen.getByRole("group", { name: "Decide this proposal" })
    ).toBeInTheDocument();
  });

  it("rejects a proposal in one click (no confirm — nothing is applied)", async () => {
    get.mockResolvedValue(PROPOSAL_ROW);
    post.mockResolvedValue({});
    render(<CoordQuestionDetailPage />);
    await waitFor(() => expect(decisionButtons()).toHaveLength(2));
    fireEvent.click(decisionButtons()[1]);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/operations/agent-questions/q-1/respond",
        { response: "reject", responded_by_operator: "op@example.com" }
      )
    );
    expect(
      screen.queryByTestId("coord-question-approve-confirm")
    ).not.toBeInTheDocument();
  });

  it("labels the gate decision group for assistive tech", async () => {
    get.mockResolvedValue(GATE_ROW);
    render(<CoordQuestionDetailPage />);
    await waitFor(() => expect(decisionButtons()).toHaveLength(2));
    expect(
      screen.getByRole("group", { name: "Decide this gate" })
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-question-effect-review-link")
    ).not.toBeInTheDocument();
  });

  it.each([
    ["a renamed value", ["met", "blocked"]],
    ["an extra option", ["met", "not_met", "defer"]],
    ["no options", null],
  ])(
    "falls back to the composer with a notice when options disagree (%s)",
    async (_l, options) => {
      get.mockResolvedValue({ ...GATE_ROW, options });
      render(<CoordQuestionDetailPage />);
      await waitFor(() =>
        expect(
          screen.getByTestId("coord-question-response-textarea")
        ).toBeInTheDocument()
      );
      expect(decisionButtons()).toHaveLength(0);
      expect(
        screen.getByTestId("coord-question-effect-mismatch")
      ).toHaveTextContent(/met \/ not_met/);
    }
  );

  it("offers no decision on an ANSWERED effect row", async () => {
    get.mockResolvedValue({
      ...GATE_ROW,
      responded_at: "2026-09-26T10:00:00Z",
      response: "met",
      responded_by_operator: "josh@qontinui.io",
    });
    render(<CoordQuestionDetailPage />);
    await waitFor(() =>
      expect(screen.getByTestId("coord-question-respond")).toHaveTextContent(
        /Recorded response/i
      )
    );
    expect(decisionButtons()).toHaveLength(0);
  });

  it.each([
    ["a clause row (reserved)", { effect_kind: "clause", effect_ref: { id: "c-1" } }],
    ["an effect-less row", { effect_kind: "none", effect_ref: null }],
    ["a row from an older coord", {}],
  ])("keeps the free-text composer for %s", async (_l, extra) => {
    get.mockResolvedValue({ ...QUESTION, options: ["pin", "bump"], ...extra });
    render(<CoordQuestionDetailPage />);
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-question-response-textarea")
      ).toBeInTheDocument()
    );
    expect(decisionButtons()).toHaveLength(0);
    expect(screen.getByTestId("coord-question-options")).toBeInTheDocument();
  });
});
