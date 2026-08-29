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
    expect(screen.queryByText(/not found\./)).not.toBeInTheDocument();
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
    expect(screen.getByTestId("coord-question-not-found")).toHaveTextContent(
      /coord holds no such question/
    );
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
      expect(
        screen.getByTestId("coord-question-unreadable")
      ).toBeInTheDocument();
    });
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

  it("does not resurrect the previous question when the new id fails to read", async () => {
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
