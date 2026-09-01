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
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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
