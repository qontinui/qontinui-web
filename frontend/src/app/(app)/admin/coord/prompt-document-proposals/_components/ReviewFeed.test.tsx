/**
 * ReviewFeed — the "Retired as stale" section, and the deploy-order tolerance
 * that lets it ship before coord does.
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
 * Route the four reads the page makes. `stale` is the one under test; the other
 * three answer benignly so a failure here can only be about the retired
 * section.
 */
function routes(staleResult: () => Promise<unknown>) {
  getMock.mockImplementation((url: string) => {
    if (url.includes("status=stale")) return staleResult();
    if (url.includes("prompt-document-proposals"))
      return Promise.resolve({ proposals: [], total: 0 });
    if (url.includes("prompt-document-writes"))
      return Promise.resolve({ writes: [], total: 0 });
    return Promise.resolve({ documents: [] });
  });
}

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
    routes(() => Promise.resolve({ proposals: [RETIRED], total: 1 }));
    const user = userEvent.setup();
    render(<ReviewFeed />);

    await waitFor(async () => expect(await summary()).toMatch(/1 proposal\b/));

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
    expect(screen.getByTestId("retired-decision-note")).toBeTruthy();
    expect(text).toMatch(/Retired /);
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
