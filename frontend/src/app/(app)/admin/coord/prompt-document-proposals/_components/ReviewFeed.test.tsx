/**
 * ReviewFeed — the two collapsed sections below the pending queue ("Retired as
 * stale" and "Recently proposed & approved"), and the deploy-order tolerance
 * that lets them ship before coord does.
 *
 * Plan `2026-09-13-policy-proposals-agent-decidable-dial-driven-self-retiring`,
 * Phase 4. coord retires a pending proposal inside the same transaction that
 * bumps its target document's version. Before this section existed, the whole
 * of that from the operator's chair was a row that was in the queue on one
 * refresh and gone on the next — a proposal apparently decided by nobody.
 *
 * Three things are pinned here, and each one fails SILENTLY if it regresses:
 *
 *  1. **The three states are three different claims.** Populated, "none retired
 *     recently", and UNKNOWN. The third is the one worth a test: a section that
 *     could not be read and renders as "none" asserts something it does not
 *     know [`verification-and-evidence` `silent-empty-is-unknown`], and it does
 *     so in exactly the calm chrome that makes nobody look twice.
 *
 *  2. **A 400 from an older coord is contained.** Vercel and ECS deploy
 *     independently, so this page WILL run against a coord that rejects
 *     `?status=stale` with `400 invalid status`. The plan chose the tolerant
 *     read over waiting for coord's deploy precisely so that failure costs
 *     nothing — which is only true if it never reaches the pending queue's
 *     error banner. Asserting the retired section went UNKNOWN is half the
 *     test; asserting the queue above it is untouched is the half that
 *     encodes the design decision.
 *
 *  3. **The state survives the collapse.** The panel is closed by default and
 *     `<CollapsibleContent>` unmounts its children, so anything stated only in
 *     the body is invisible until someone clicks. The header summary is
 *     therefore where "could not be read" has to live (R7 — secondary material
 *     collapses, its signal does not), and that is asserted with the panel
 *     SHUT.
 *
 *  4. **A decided row actually reaches `<ProposalCard>`.** The card's own unit
 *     tests construct a decided proposal and hand it to the card, which proves
 *     rendering and nothing about reachability — and for the whole life of this
 *     page nothing reached it, because the only read was `?status=pending` and
 *     coord filters by status. The self-decided provenance line was unreachable
 *     code wearing a passing test. That assertion has to be made through the
 *     real hook and the real feed, and it is, below.
 *
 *  5. **The UNKNOWN box does not diagnose what it has not observed.** It is
 *     reached by a pre-deploy 400, by coord being down, by a timeout and by a
 *     parse error; only the first is a deploy window. Both arms are pinned,
 *     because a one-sided test is satisfied by a constant.
 *
 * The hook is deliberately NOT mocked: the branch under test is a `catch` in
 * the hook talking to a `?:` chain in the component, and a mocked hook would
 * let either half be wrong while the test stayed green.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

import type { PromptDocumentProposal } from "../types";
import { ReviewFeed } from "./ReviewFeed";

const RETIRED: PromptDocumentProposal = {
  id: "p-stale-1",
  doc_kind: "policy",
  doc_name: "escalation-bar",
  clause_id: "escalation-closed-list",
  proposed_content: "Agents may escalate on any ambiguity.",
  direction: "loosening",
  from_tier: "ask-first",
  to_tier: "proceed",
  rationale: "The closed list is too narrow in practice.",
  proposed_by: "session:bdaaeba8",
  base_version: 4,
  status: "stale",
  created_at: "2026-09-12T10:00:00Z",
  decided_by: "system:proposal-staleness",
  decided_at: "2026-09-14T11:30:00Z",
  decision_note: "the document moved to v9 while this was pending",
};

/**
 * A second retirement. Present so the per-row decision-note testid is actually
 * EXERCISED: with one row, a repeated constant testid and a per-row one are
 * indistinguishable, which is why the previous single-row fixture let a
 * `getByTestId` that throws on any real two-retirement page stay green.
 */
const RETIRED_2: PromptDocumentProposal = {
  ...RETIRED,
  id: "p-stale-2",
  doc_name: "operating-rules",
  clause_id: null,
  base_version: 2,
  decision_note: "the document moved to v3 while this was pending",
};

/**
 * The document-version rows the page reads to derive staleness.
 *
 * **Not `[]`, deliberately.** This fallback used to answer every
 * `/coord/prompt-documents` read with an empty list, which made
 * `liveVersionFor` return `null` for every row on the page — and `null`
 * short-circuits the whole staleness comparison. So the end-to-end test never
 * exercised the live-version path at all, and an approved row rendering as a
 * red act-now `stale` alarm was invisible here as well as in the card's own
 * unit tests.
 *
 * `security-and-autonomy` is at v9, past `SELF_APPROVED.base_version` (6) —
 * which is not a contrivance but what approving DOES: the approval applied the
 * edit as a new version, so a decided row whose document has not moved past its
 * base is the shape that cannot occur.
 */
const DOCUMENTS = {
  documents: [
    { kind: "policy", name: "security-and-autonomy", current_version: 9 },
    { kind: "policy", name: "escalation-bar", current_version: 9 },
    { kind: "policy", name: "operating-rules", current_version: 3 },
  ],
};

/**
 * Route the five reads the page makes. Each status is overridable; whatever is
 * not overridden answers benignly, so a failure in one test can only be about
 * the section that test names.
 */
function routes(
  staleResult: () => Promise<unknown>,
  opts: {
    approved?: () => Promise<unknown>;
    pending?: () => Promise<unknown>;
  } = {}
) {
  getMock.mockImplementation((url: string) => {
    if (url.includes("status=stale")) return staleResult();
    if (url.includes("status=approved"))
      return (
        opts.approved ?? (() => Promise.resolve({ proposals: [], total: 0 }))
      )();
    if (url.includes("prompt-document-proposals"))
      return (
        opts.pending ?? (() => Promise.resolve({ proposals: [], total: 0 }))
      )();
    if (url.includes("prompt-document-writes"))
      return Promise.resolve({ writes: [], total: 0 });
    return Promise.resolve(DOCUMENTS);
  });
}

/** A clean stale read — for tests whose subject is some other section. */
const NO_RETIREMENTS = () => Promise.resolve({ proposals: [], total: 0 });

beforeEach(() => {
  getMock.mockReset();
  // The panel persists its open/closed choice per `storageKey`. Without this,
  // a test that opens it leaves every later test hydrating OPEN — and the
  // collapsed-header assertions would pass for the wrong reason.
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom without storage — the panel falls back to `defaultOpen`. */
  }
});

/** The header summary, which the panel keeps visible while collapsed. */
async function summary(): Promise<string> {
  const el = await screen.findByTestId("retired-summary");
  return el.textContent ?? "";
}

describe("ReviewFeed — the retired section, populated", () => {
  it("counts the retirements in the header and lists each one on open", async () => {
    routes(() =>
      Promise.resolve({ proposals: [RETIRED, RETIRED_2], total: 2 })
    );
    const user = userEvent.setup();
    render(<ReviewFeed />);

    await waitFor(async () => expect(await summary()).toMatch(/2 proposals\b/));

    // Closed by default: a retirement asks nothing of anyone.
    expect(screen.queryByTestId(`retired-proposal-${RETIRED.id}`)).toBeNull();
    await user.click(screen.getByRole("button", { name: /retired as stale/i }));

    const row = await screen.findByTestId(`retired-proposal-${RETIRED.id}`);
    const text = row.textContent ?? "";
    // The four facts the plan names for a row: the target document, the
    // version it was written against, coord's note, and when it was retired.
    expect(text).toMatch(/escalation-bar/);
    expect(text).toMatch(/escalation-closed-list/);
    expect(text).toMatch(/v4/);
    expect(text).toMatch(/moved to v9/);
    expect(text).toMatch(/Retired /);

    // Scoped per row, and asserted with TWO retirements on screen. A shared
    // constant testid would make `getByTestId` throw here — which is exactly
    // what it did on any page with more than one retirement, while this test
    // stayed green on a one-row fixture.
    expect(
      screen.getByTestId(`retired-decision-note-${RETIRED.id}`).textContent
    ).toMatch(/moved to v9/);
    expect(
      screen.getByTestId(`retired-decision-note-${RETIRED_2.id}`).textContent
    ).toMatch(/moved to v3/);
  });
});

describe("ReviewFeed — the retired section, genuinely empty", () => {
  it("says 'none retired recently' only after a read that succeeded", async () => {
    routes(() => Promise.resolve({ proposals: [], total: 0 }));
    const user = userEvent.setup();
    render(<ReviewFeed />);

    await waitFor(async () =>
      expect(await summary()).toMatch(/none retired recently/i)
    );

    await user.click(screen.getByRole("button", { name: /retired as stale/i }));
    expect(await screen.findByTestId("retired-empty")).toBeTruthy();
    expect(screen.queryByTestId("retired-unknown")).toBeNull();
  });
});

describe("ReviewFeed — the retired section, unreadable", () => {
  it("reads UNKNOWN, never empty, when coord refuses the status", async () => {
    // Exactly the pre-deploy answer: coord's `get_list` rejects a status it
    // does not know, and the web proxy forwards it verbatim.
    routes(() => Promise.reject(new Error("400: invalid status")));
    const user = userEvent.setup();
    render(<ReviewFeed />);

    // Stated in the HEADER, while the panel is still shut — the one thing that
    // must not hide behind a click.
    await waitFor(async () =>
      expect(await summary()).toMatch(/could not be read/i)
    );
    expect(await summary()).not.toMatch(/none retired recently/i);

    await user.click(screen.getByRole("button", { name: /retired as stale/i }));
    const box = await screen.findByTestId("retired-unknown");
    expect(box.textContent ?? "").toMatch(/unknown/i);
    expect(box.textContent ?? "").toMatch(/not empty/i);
    expect(box.textContent ?? "").toMatch(/invalid status/);
    // The 400 IS the pre-deploy evidence, so this is the one failure allowed to
    // name that cause.
    const cause = screen.getByTestId("retired-unknown-cause");
    expect(cause.getAttribute("data-cause")).toBe("not-deployed");
    expect(cause.textContent ?? "").toMatch(/older than this page/i);
    // Never the reassuring empty state on an unreadable read.
    expect(screen.queryByTestId("retired-empty")).toBeNull();
  });

  it("does not let that 400 touch the pending queue", async () => {
    // The design decision, encoded. The plan preferred the tolerant read over
    // an ordering dependency on coord's deploy; that is only true if a section
    // coord has never heard of cannot make the working queue above it look
    // broken.
    routes(() => Promise.reject(new Error("400: invalid status")));
    render(<ReviewFeed />);

    await waitFor(async () =>
      expect(await summary()).toMatch(/could not be read/i)
    );
    expect(screen.queryByTestId("proposals-error")).toBeNull();
    expect(screen.queryByTestId("proposals-unavailable")).toBeNull();
    // The queue still renders its own honest empty state, not a failure.
    expect(screen.getByTestId("proposal-queue").textContent ?? "").toMatch(
      /No proposals waiting/i
    );
  });
});

/**
 * The UNKNOWN box used to print ONE explanation for every failure: "Expected
 * while coord is older than this page…". That sentence is a diagnosis, and the
 * box is reached by at least four faults — coord's pre-deploy 400, coord down
 * (a 502/504 the proxy turns into a 200 carrying `unavailable`), a timeout, a
 * parse error. Three of them are not a deploy window, and reassuring an
 * operator that coord is merely behind while it is actually unreachable is a
 * confident wrong answer in the calmest chrome on the page.
 *
 * Both arms are pinned, because a one-sided test is satisfied by a constant.
 */
describe("ReviewFeed — the UNKNOWN box only claims a cause it has evidence for", () => {
  it("does NOT claim a deploy window on a timeout", async () => {
    routes(() => Promise.reject(new Error("Request timed out")));
    const user = userEvent.setup();
    render(<ReviewFeed />);

    await waitFor(async () =>
      expect(await summary()).toMatch(/could not be read/i)
    );
    await user.click(screen.getByRole("button", { name: /retired as stale/i }));

    const cause = await screen.findByTestId("retired-unknown-cause");
    expect(cause.getAttribute("data-cause")).toBe("undiagnosed");
    expect(cause.textContent ?? "").not.toMatch(/older than this page/i);
    expect(cause.textContent ?? "").toMatch(/could not be reached/i);
    // The neutral sentence still has to say what IS known — the queue above was
    // read on its own request, so its state is not implicated.
    expect(cause.textContent ?? "").toMatch(/read separately/i);
  });

  it("does NOT claim a deploy window when coord is down behind a 200", async () => {
    // The proxy's degrade path: a 502/504 comes back as HTTP 200 with a note
    // and `unavailable_kind: "unreachable"`. Nothing throws, so a catch-arm
    // heuristic cannot see this one at all — the kind has to be carried.
    routes(() =>
      Promise.resolve({
        proposals: [],
        total: 0,
        unavailable: "coord did not answer",
        unavailable_kind: "unreachable",
      })
    );
    const user = userEvent.setup();
    render(<ReviewFeed />);

    await waitFor(async () =>
      expect(await summary()).toMatch(/could not be read/i)
    );
    await user.click(screen.getByRole("button", { name: /retired as stale/i }));

    const cause = await screen.findByTestId("retired-unknown-cause");
    expect(cause.getAttribute("data-cause")).toBe("undiagnosed");
    expect(cause.textContent ?? "").not.toMatch(/older than this page/i);
  });
});

/**
 * The third leg of the `staleRead` distinction, which had no test at all.
 *
 * "Not read yet" is neither "empty" nor "unreadable", and it is the state the
 * section is in for the whole of its first paint. A regression that made it
 * render as `retired-empty` would show a reassuring "none retired recently" on
 * every page load, before anything had been asked — the one failure that looks
 * completely normal.
 */
describe("ReviewFeed — the retired section, not yet read", () => {
  it("says 'reading…' and claims neither empty nor unknown", async () => {
    // Never settles: the read is in flight for the lifetime of the test.
    routes(() => new Promise<never>(() => {}));
    const user = userEvent.setup();
    render(<ReviewFeed />);

    await waitFor(async () => expect(await summary()).toMatch(/reading…/i));
    expect(await summary()).not.toMatch(/none retired recently/i);
    expect(await summary()).not.toMatch(/could not be read/i);

    await user.click(screen.getByRole("button", { name: /retired as stale/i }));
    expect(screen.queryByTestId("retired-empty")).toBeNull();
    expect(screen.queryByTestId("retired-unknown")).toBeNull();
  });
});

/**
 * "Recently proposed & approved" — and the one assertion the `ProposalCard`
 * unit tests cannot make.
 *
 * Those four tests construct a decided proposal and hand it straight to the
 * card. That proves the card RENDERS the provenance line; it cannot prove
 * anything reaches the card with `decided_by` set, and for the whole life of
 * this page nothing did: `ProposalCard`'s only caller was fed by
 * `?status=pending`, and coord filters the list by status, so every row the
 * card ever saw had `decided_by: null`. The self-decided line — the
 * compensating audit control for ownership no longer gating a decision — was
 * unreachable code wearing a passing test.
 *
 * So this drives the REAL hook and the REAL feed: coord's answer goes in as a
 * routed HTTP response, and the assertion is made on what the operator would
 * see after clicking.
 */
describe("ReviewFeed — a self-approved proposal reaches the card", () => {
  const SELF_APPROVED: PromptDocumentProposal = {
    id: "p-approved-1",
    doc_kind: "policy",
    doc_name: "security-and-autonomy",
    clause_id: "implement-tier",
    proposed_content: "Agents may draft security-surface changes.",
    direction: "loosening",
    from_tier: "ask-first",
    to_tier: "proceed",
    rationale: "The tier gate costs a round trip on every security touch.",
    proposed_by: "session:bdaaeba8",
    base_version: 6,
    status: "approved",
    created_at: "2026-09-14T08:00:00Z",
    decided_by: "session:bdaaeba8",
    decided_at: "2026-09-14T09:00:00Z",
    decision_note: "second opinion from a fresh-context subagent",
    self_decided: true,
  };

  it("surfaces the self-decided provenance line through the real hook and feed", async () => {
    routes(NO_RETIREMENTS, {
      approved: () => Promise.resolve({ proposals: [SELF_APPROVED], total: 1 }),
    });
    const user = userEvent.setup();
    render(<ReviewFeed />);

    // The count is in the header, visible while the panel is still shut.
    const header = await screen.findByTestId("decided-summary");
    await waitFor(() =>
      expect(header.textContent ?? "").toMatch(/1 proposal\b/)
    );

    await user.click(
      screen.getByRole("button", { name: /recently proposed & approved/i })
    );
    // The row is a real `<ProposalCard>` — expand it for the provenance block.
    const row = await screen.findByTestId(`proposal-${SELF_APPROVED.id}`);
    await user.click(row.querySelector("button")!);

    const line = await screen.findByTestId("proposal-decided-by");
    expect(line.getAttribute("data-self-decided")).toBe("true");
    expect(
      screen.getByTestId("proposal-self-decided").textContent ?? ""
    ).toMatch(/decided by its author/i);
    // coord's decision note is the other half of the control — it travels.
    expect(line.textContent ?? "").toMatch(/fresh-context subagent/);
    // INFORMATION, not an alarm: no red/amber chrome and no icon on the line.
    expect(line.innerHTML).not.toMatch(/\b(bg|text|border)-(red|amber)-/);
    expect(line.querySelector("svg")).toBeNull();
  });

  it("does not paint the approved row as a red act-now `stale` alarm", async () => {
    /*
     * The regression, at the layer it shipped on — and the reason it hid.
     *
     * `routes()`'s fallback used to answer the document read with
     * `{ documents: [] }`, so `liveVersionFor` returned `null` for every row
     * and the staleness comparison never ran in this file at all. It now serves
     * `policy/security-and-autonomy` at v9, past this fixture's
     * `base_version: 6` — which is what APPROVING did: the approval applied the
     * edit as a new version. Every approved row therefore satisfies
     * `liveVersion > base_version` by construction, and before the fix every
     * one of them rendered `AUTHOR_RED` with a `✕` and a red panel telling the
     * reader to "read the current wording before approving" the thing they had
     * just approved.
     */
    routes(NO_RETIREMENTS, {
      approved: () => Promise.resolve({ proposals: [SELF_APPROVED], total: 1 }),
    });
    const user = userEvent.setup();
    render(<ReviewFeed />);

    await user.click(
      await screen.findByRole("button", {
        name: /recently proposed & approved/i,
      })
    );
    const row = await screen.findByTestId(`proposal-${SELF_APPROVED.id}`);

    const badge = row.querySelector<HTMLElement>(
      '[data-testid="proposal-direction"]'
    )!;
    expect(badge.textContent ?? "").toMatch(/approved/i);
    expect(badge.innerHTML).not.toMatch(/\bbg-red-/);
    expect(badge.textContent ?? "").not.toContain("✕");

    await user.click(row.querySelector("button")!);
    // Expanded, so the absence below is a real absence and not a collapse.
    expect(await screen.findByTestId("proposal-content")).toBeTruthy();
    expect(screen.queryByTestId("proposal-stale")).toBeNull();
  });

  it("still goes red on a PENDING row the live version has moved past", async () => {
    // The guard on the fixture itself: with the SAME document map in play, a
    // pending proposal against v6 of a v9 document must still raise the alarm.
    // Without this, the assertion above could be satisfied by a document read
    // that silently went back to serving nothing.
    routes(NO_RETIREMENTS, {
      pending: () =>
        Promise.resolve({
          proposals: [
            { ...SELF_APPROVED, id: "p-pending-1", status: "pending" },
          ],
          total: 1,
        }),
    });
    const user = userEvent.setup();
    render(<ReviewFeed />);

    const row = await screen.findByTestId("proposal-p-pending-1");
    const badge = row.querySelector<HTMLElement>(
      '[data-testid="proposal-direction"]'
    )!;
    await waitFor(() => expect(badge.textContent ?? "").toMatch(/stale/i));
    expect(badge.innerHTML).toMatch(/\bbg-red-/);

    await user.click(row.querySelector("button")!);
    expect(await screen.findByTestId("proposal-stale")).toBeTruthy();
  });

  it("offers no decision composer on a row coord already closed", async () => {
    routes(NO_RETIREMENTS, {
      approved: () => Promise.resolve({ proposals: [SELF_APPROVED], total: 1 }),
    });
    const user = userEvent.setup();
    render(<ReviewFeed />);

    await user.click(
      await screen.findByRole("button", { name: /recently proposed & approved/i })
    );
    const row = await screen.findByTestId(`proposal-${SELF_APPROVED.id}`);
    await user.click(row.querySelector("button")!);

    // Asserted with the row OPEN, so a null means "gated", never "collapsed".
    expect(await screen.findByTestId("proposal-closed")).toBeTruthy();
    expect(screen.queryByTestId("proposal-approve")).toBeNull();
    expect(screen.queryByTestId("proposal-reject")).toBeNull();
    expect(screen.queryByTestId("proposal-decision-note")).toBeNull();
  });

  it("reads UNKNOWN, never empty, when the decided read fails", async () => {
    routes(NO_RETIREMENTS, {
      approved: () => Promise.reject(new Error("503: coord unavailable")),
    });
    const user = userEvent.setup();
    render(<ReviewFeed />);

    const header = await screen.findByTestId("decided-summary");
    await waitFor(() =>
      expect(header.textContent ?? "").toMatch(/could not be read/i)
    );
    expect(header.textContent ?? "").not.toMatch(/none approved yet/i);

    await user.click(
      screen.getByRole("button", { name: /recently proposed & approved/i })
    );
    expect(await screen.findByTestId("decided-unknown")).toBeTruthy();
    expect(screen.queryByTestId("decided-empty")).toBeNull();
    // A 503 is not a vocabulary refusal, so no deploy-window claim.
    expect(
      screen.getByTestId("decided-unknown-cause").getAttribute("data-cause")
    ).toBe("undiagnosed");
    // And, as with the retired section, it never reaches the pending queue.
    expect(screen.queryByTestId("proposals-error")).toBeNull();
  });

  it("says 'none approved recently' only after a read that succeeded", async () => {
    routes(NO_RETIREMENTS);
    const user = userEvent.setup();
    render(<ReviewFeed />);

    const header = await screen.findByTestId("decided-summary");
    await waitFor(() =>
      expect(header.textContent ?? "").toMatch(/none approved yet/i)
    );
    await user.click(
      screen.getByRole("button", { name: /recently proposed & approved/i })
    );
    expect(await screen.findByTestId("decided-empty")).toBeTruthy();
    expect(screen.queryByTestId("decided-unknown")).toBeNull();
  });
});

/**
 * The bound the collapsed sections ask for is only honoured because the web
 * proxy DECLARES `limit`; FastAPI discards an undeclared query parameter, and
 * coord then falls back to its own `unwrap_or(100)`. That is a backend fix, but
 * the client half — actually sending the bound on both section reads — is
 * pinned here so a future refactor cannot drop it silently and leave the page
 * quietly reading five times what its own constants document.
 */
describe("ReviewFeed — the collapsed sections ask for a bounded page", () => {
  it("sends a limit on both the retired and the decided read", async () => {
    routes(NO_RETIREMENTS);
    render(<ReviewFeed />);

    await waitFor(async () =>
      expect(await summary()).toMatch(/none retired recently/i)
    );

    const urls = getMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => /status=stale&limit=\d+/.test(u))).toBe(true);
    expect(urls.some((u) => /status=approved&limit=\d+/.test(u))).toBe(true);
  });
});

/**
 * The window the "Recently proposed & approved" section actually serves, and
 * the header that used to overstate it.
 *
 * coord's route is `WHERE tenant_id = $1 AND status = $2 ORDER BY created_at
 * DESC LIMIT $3` — `created_at` is the PROPOSAL date and there is no
 * `decided_at` ordering to ask for. A panel headed "Recently approved" over
 * that query claims a recency the query cannot deliver: a proposal authored
 * months ago and approved a minute ago ranks by the old date and can fall out
 * of the page entirely. Since this section is the only surface for the
 * compensating audit control that replaced the ownership rule, the decision
 * most worth seeing is exactly the one the ordering can drop — so the page says
 * what it is showing instead.
 */
describe("ReviewFeed — the decided section states its own window", () => {
  it("names the ordering in the heading and in the intro", async () => {
    routes(NO_RETIREMENTS, {
      approved: () => Promise.resolve({ proposals: [], total: 0 }),
    });
    const user = userEvent.setup();
    render(<ReviewFeed />);

    // The heading no longer says "recently approved" on its own.
    const header = await screen.findByRole("button", {
      name: /recently proposed & approved/i,
    });
    expect(header.textContent ?? "").not.toMatch(/^recently approved/i);

    await user.click(header);
    const note = await screen.findByTestId("decided-window-note");
    const text = note.textContent ?? "";
    expect(text).toMatch(/20 most recently/i);
    expect(text).toMatch(/proposal date, not decision date/i);
  });

  it("does not claim 'recently' in the empty state either", async () => {
    // Zero rows back from `?status=approved` is not a window artefact — a
    // LIMIT cannot manufacture an empty page — so the honest claim is the
    // stronger one, and it must not re-import the recency the ordering cannot
    // support.
    routes(NO_RETIREMENTS);
    const user = userEvent.setup();
    render(<ReviewFeed />);

    const header = await screen.findByTestId("decided-summary");
    await waitFor(() =>
      expect(header.textContent ?? "").toMatch(/none approved yet/i)
    );
    expect(header.textContent ?? "").not.toMatch(/none approved recently/i);

    await user.click(
      screen.getByRole("button", { name: /recently proposed & approved/i })
    );
    const empty = await screen.findByTestId("decided-empty");
    expect(empty.textContent ?? "").toMatch(/none approved yet/i);
    expect(empty.textContent ?? "").not.toMatch(/recently/i);
  });
});

/**
 * The UNKNOWN box's pre-deploy sentence, per section.
 *
 * Its closing clause used to be the constant "Nothing above is affected.",
 * which is true of the RETIRED section — reached on `not_deployed` by a `400
 * invalid status` from a coord that serves every other query fine — and false
 * of the decided one. `?status=approved` is original vocabulary, so the only
 * route to `not_deployed` there is the proxy's 404 mapping: the whole proposal
 * surface absent (`operations.py` `_coord_unavailable`), which takes the
 * pending queue down with it. Reassuring the operator that nothing above is
 * affected while the queue is dark is the same confident-wrong-answer defect
 * the `preDeploy` split exists to remove.
 */
describe("ReviewFeed — the pre-deploy sentence is per-section", () => {
  it("tells the decided section's reader that the queue above is out too", async () => {
    routes(NO_RETIREMENTS, {
      approved: () => Promise.reject(new Error("400: not found")),
    });
    const user = userEvent.setup();
    render(<ReviewFeed />);

    await user.click(
      await screen.findByRole("button", {
        name: /recently proposed & approved/i,
      })
    );
    const cause = await screen.findByTestId("decided-unknown-cause");
    expect(cause.getAttribute("data-cause")).toBe("not-deployed");
    expect(cause.textContent ?? "").toMatch(
      /the pending queue above reports the same outage/i
    );
    expect(cause.textContent ?? "").not.toMatch(/nothing above is affected/i);
    // ...and the sentence no longer says "query" twice ("it does not recognise
    // this query yet and refuses the query").
    expect((cause.textContent ?? "").match(/\bquery\b/gi)?.length ?? 0).toBe(1);
  });

  it("keeps 'Nothing above is affected' on the retired section, where it is true", async () => {
    // The other arm. Without it, the fix could be satisfied by deleting the
    // reassurance everywhere — including from the one section whose pre-deploy
    // failure genuinely leaves the queue untouched.
    routes(() => Promise.reject(new Error("400: invalid status")));
    const user = userEvent.setup();
    render(<ReviewFeed />);

    await user.click(
      await screen.findByRole("button", { name: /retired as stale/i })
    );
    const cause = await screen.findByTestId("retired-unknown-cause");
    expect(cause.getAttribute("data-cause")).toBe("not-deployed");
    expect(cause.textContent ?? "").toMatch(/nothing above is affected/i);
    expect(cause.textContent ?? "").toMatch(/the retired status/i);
  });
});
