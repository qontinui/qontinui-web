/**
 * LandedWriteFeed — the operator's answer to *what have agents changed in my
 * governance layer* (plan
 * `2026-08-27-tenant-level-agent-authorable-stores.md`, Phase 4).
 *
 * Four properties are pinned here because each fails SILENTLY — the page still
 * renders, it just tells the operator something untrue:
 *
 * 1. **A flagged write sorts to the top and is marked.** A loosening buried on
 *    row 30 of a newest-first feed is a loosening the operator does not read,
 *    and this feed is the entire safety story for letting one land at all.
 * 2. **An ABSENT `loosening` renders as absent.** The coord half ships
 *    separately, so every row lacks the field on day one. Rendering that as
 *    "not a loosening" would state a verdict coord never gave — and the
 *    "nothing here widens authority" line is exactly the claim that must not
 *    be printed from a server that never classified anything.
 * 3. **The author filter hides nothing silently.** The web proxy returns
 *    writes unfiltered on purpose; a client filter is only allowed if what it
 *    hides is counted on screen.
 * 4. **The completeness caveat is always on screen.** Coord's announce path is
 *    post-commit and best-effort, so a quiet feed is not evidence of a quiet
 *    fleet, and no per-response caveat would ever say so.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

import { LandedWriteFeed } from "./LandedWriteFeed";
import type { PromptDocumentWrite } from "../types";

function write(over: Partial<PromptDocumentWrite> = {}): PromptDocumentWrite {
  return {
    kind: "policy",
    name: "operating-rules",
    label: "Operating Rules",
    version_number: 6,
    change_note: "appended a clause",
    edited_by: "device:c79a07d5-7e40-49b4-87fa-554c749f9644",
    created_at: "2026-08-27T11:51:41Z",
    current_version: 6,
    ...over,
  };
}

function renderFeed(props: Partial<Parameters<typeof LandedWriteFeed>[0]> = {}) {
  return render(
    <LandedWriteFeed
      writes={[]}
      notices={[]}
      severe={false}
      nothingRead={false}
      loading={false}
      acting={false}
      onRevert={vi.fn().mockResolvedValue(true)}
      onLoadDiff={vi.fn().mockResolvedValue(undefined)}
      diffFor={() => null}
      {...props}
    />
  );
}

/** The row `<li>` for one write, addressed by its frozen testid. */
function rowFor(w: PromptDocumentWrite) {
  return screen.getByTestId(
    `write-${w.kind}-${w.name}-${w.version_number}`
  );
}

describe("LandedWriteFeed — the loosening mark", () => {
  it("sorts a flagged write above newer unflagged ones and marks it", () => {
    const flagged = write({
      name: "operating-rules",
      version_number: 6,
      current_version: 6,
      loosening: true,
    });
    const ordinary = write({
      name: "coordination",
      label: "Coordination",
      version_number: 14,
      current_version: 14,
      loosening: false,
    });
    // Arrives NEWEST first from the backend, with the loosening second.
    renderFeed({ writes: [ordinary, flagged] });

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toBe(rowFor(flagged));
    expect(rows[1]).toBe(rowFor(ordinary));

    expect(
      within(rowFor(flagged)).getByTestId(
        "write-loosening-policy-operating-rules-6"
      )
    ).toHaveTextContent("Widens authority");
    // The unflagged row asserts nothing — no inverse badge.
    expect(
      within(rowFor(ordinary)).queryByText(/widens authority/i)
    ).toBeNull();
  });

  it("renders an ABSENT loosening flag as an ordinary row, not an error", () => {
    // Every row looks like this until the coord half deploys.
    const a = write({ name: "coordination", version_number: 14, current_version: 14 });
    const b = write({ name: "git-operations", version_number: 8, current_version: 8 });
    renderFeed({ writes: [a, b] });

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    // Server order preserved; no mark anywhere.
    expect(rows[0]).toBe(rowFor(a));
    expect(screen.queryByText(/widens authority/i)).toBeNull();
    expect(rows[0]).not.toHaveAttribute("data-loosening");
  });

  it("does NOT claim 'nothing widens authority' when coord never classified", () => {
    // The load-bearing distinction. Absent field ⇒ the page has no verdict to
    // report, so it must stay silent rather than reassure.
    renderFeed({ writes: [write({ version_number: 3, current_version: 3 })] });
    expect(screen.queryByTestId("landed-writes-none-flagged")).toBeNull();
  });

  it("DOES say so once coord served an explicit verdict", () => {
    renderFeed({
      writes: [write({ version_number: 3, current_version: 3, loosening: false })],
    });
    expect(
      screen.getByTestId("landed-writes-none-flagged")
    ).toHaveTextContent(/none of the writes on this page/i);
  });
});

describe("LandedWriteFeed — the agent-authored filter", () => {
  const agentWrite = write({
    name: "operating-rules",
    edited_by: "session:f1b444bd-6aff-4e9f-b000-c20d31f3216d",
  });
  const operatorWrite = write({
    name: "engineering-priorities",
    label: "Engineering Priorities",
    version_number: 4,
    current_version: 4,
    edited_by: "operator:fb7bf946-cb46-4c38-9a1d-c7081c493b04:jspinak@gmail.com",
  });
  const legacyWrite = write({
    name: "escalation-bar",
    label: "Escalation Bar",
    version_number: 4,
    current_version: 4,
    // A REAL value from this tenant: an operator edit predating actor prefixes.
    edited_by: "josh@qontinui.io",
  });

  it("is off by default — every write is on screen", () => {
    renderFeed({ writes: [agentWrite, operatorWrite, legacyWrite] });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByTestId("landed-writes-filter-hidden")).toBeNull();
  });

  it("keeps only agent-authored rows, and COUNTS what it hid", () => {
    renderFeed({ writes: [agentWrite, operatorWrite, legacyWrite] });
    fireEvent.click(screen.getByTestId("landed-writes-author-agent"));

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(rowFor(agentWrite));

    // The legacy bare email must be reported as UNRECOGNISED, not as an
    // operator and above all not left in the agent list.
    const note = screen.getByTestId("landed-writes-filter-hidden");
    expect(note).toHaveTextContent("Hiding 2 writes");
    expect(note).toHaveTextContent("1 by you");
    expect(note).toHaveTextContent("1 whose author label is not one this page recognises");
  });

  it("says the FILTER is empty rather than the corpus", () => {
    renderFeed({ writes: [operatorWrite] });
    fireEvent.click(screen.getByTestId("landed-writes-author-agent"));
    expect(
      screen.getByText(/no agent-authored writes among the ones on this page/i)
    ).toBeInTheDocument();
  });

  it("shows counts as '–' when nothing could be read, never as 0", () => {
    // R6. A zero here would read as "no agent has touched anything", which is
    // the false reassurance this whole surface exists to avoid.
    renderFeed({
      writes: [],
      nothingRead: true,
      notices: ["coord did not answer the document list (HTTP 502)."],
      severe: true,
    });
    const all = screen.getByTestId("landed-writes-author-all");
    const agent = screen.getByTestId("landed-writes-author-agent");
    expect(all).toHaveTextContent("–");
    expect(agent).toHaveTextContent("–");
    expect(all).not.toHaveTextContent("0");
  });
});

describe("LandedWriteFeed — honesty about completeness", () => {
  it("states the best-effort caveat even when nothing went wrong", () => {
    renderFeed({ writes: [write()] });
    expect(
      screen.getByTestId("landed-writes-completeness")
    ).toHaveTextContent(/best-effort/i);
  });

  it("keeps every per-response caveat alongside it", () => {
    renderFeed({
      writes: [],
      notices: ["2 of the 5 documents read did not return their history", "Showing the 40 most recent writes of 90."],
    });
    const box = screen.getByTestId("landed-writes-notice");
    expect(box).toHaveTextContent("did not return their history");
    expect(box).toHaveTextContent("40 most recent");
    expect(box).toHaveTextContent(/best-effort/i);
  });
});

describe("LandedWriteFeed — the linked reasoning", () => {
  it("links a row that carries a notification_ref into the notifications feed", () => {
    renderFeed({
      writes: [write({ notification_ref: "fec41291-67ed-4cf8-b331-888ad1126b45" })],
    });
    const link = screen.getByTestId("write-reasoning-policy-operating-rules-6");
    expect(link).toHaveAttribute(
      "href",
      "/admin/coord/notifications?ref=fec41291-67ed-4cf8-b331-888ad1126b45"
    );
  });

  it("renders NO link when the ref is absent — not a dead one", () => {
    renderFeed({ writes: [write()] });
    expect(
      screen.queryByTestId("write-reasoning-policy-operating-rules-6")
    ).toBeNull();
  });
});

describe("LandedWriteFeed — the diff", () => {
  it("asks for the bodies only when a row is expanded", () => {
    const onLoadDiff = vi.fn().mockResolvedValue(undefined);
    const w = write();
    renderFeed({ writes: [w], onLoadDiff });

    expect(onLoadDiff).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByTestId("write-toggle-policy-operating-rules-6")
    );
    expect(onLoadDiff).toHaveBeenCalledWith(w);
  });

  it("renders no diff panel at all while the row is collapsed", () => {
    renderFeed({
      writes: [write()],
      diffFor: () => ({ status: "ready", previous: "a\n", current: "a\nb\n" }),
    });
    // Not merely hidden — absent, so a collapsed row polls and renders nothing.
    expect(
      screen.queryByTestId("write-diff-policy-operating-rules-6")
    ).toBeNull();
  });

  it("renders the previous → current line diff", () => {
    const w = write();
    renderFeed({
      writes: [w],
      diffFor: () => ({
        status: "ready",
        previous: "one\ntwo\n",
        current: "one\ntwo\nthree\n",
      }),
    });
    fireEvent.click(
      screen.getByTestId("write-toggle-policy-operating-rules-6")
    );
    const panel = screen.getByTestId("write-diff-policy-operating-rules-6");
    expect(panel).toHaveTextContent("v5 → v6");
    expect(panel).toHaveTextContent("+1");
    expect(panel).toHaveTextContent("three");
  });

  it("says an unreadable version is UNKNOWN, not an empty diff", () => {
    renderFeed({
      writes: [write()],
      diffFor: () => ({ status: "error", error: "HTTP 502" }),
    });
    fireEvent.click(
      screen.getByTestId("write-toggle-policy-operating-rules-6")
    );
    expect(
      screen.getByTestId("write-diff-policy-operating-rules-6")
    ).toHaveTextContent(/unknown, not nothing/i);
  });

  it("diffs v1 against the empty document rather than refusing", () => {
    const first = write({ version_number: 1, current_version: 1 });
    renderFeed({
      writes: [first],
      diffFor: () => ({ status: "ready", previous: "", current: "hello\n" }),
    });
    fireEvent.click(
      screen.getByTestId("write-toggle-policy-operating-rules-1")
    );
    const panel = screen.getByTestId("write-diff-policy-operating-rules-1");
    expect(panel).toHaveTextContent("nothing → v1");
    expect(panel).toHaveTextContent("hello");
  });
});

describe("LandedWriteFeed — preserved behaviour", () => {
  it("offers undo on the head write only", () => {
    const head = write({ version_number: 6, current_version: 6 });
    const older = write({
      name: "git-operations",
      label: "Git Operations",
      version_number: 7,
      current_version: 8,
    });
    renderFeed({ writes: [head, older] });
    expect(
      screen.getByTestId("revert-policy-operating-rules")
    ).toBeInTheDocument();
    // The row must actually BE on screen, or the null below is vacuous.
    expect(rowFor(older)).toBeInTheDocument();
    expect(screen.queryByTestId("revert-policy-git-operations")).toBeNull();
  });

  it("never offers undo on v1 — there is no earlier wording", () => {
    renderFeed({ writes: [write({ version_number: 1, current_version: 1 })] });
    expect(screen.queryByTestId("revert-policy-operating-rules")).toBeNull();
  });

  it("does not claim an empty feed when nothing could be read", () => {
    renderFeed({
      writes: [],
      nothingRead: true,
      notices: ["5 of the 5 documents read did not return their history"],
    });
    expect(
      screen.getByText(/no writes could be read/i)
    ).toBeInTheDocument();
  });
});

describe("LandedWriteFeed — two versions of the same document", () => {
  it("gives every row its own testids, so neither is ambiguous", () => {
    // The feed is per-WRITE, not per-document, so `policy/operating-rules` v5
    // and v6 can both be on screen. Testids that omitted the version made
    // `getByTestId` throw on the ambiguity.
    const v6 = write({ version_number: 6, current_version: 6, loosening: true });
    const v5 = write({
      version_number: 5,
      current_version: 6,
      loosening: true,
      notification_ref: "ref-5",
    });
    renderFeed({ writes: [v6, v5] });

    expect(
      screen.getByTestId("write-loosening-policy-operating-rules-6")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("write-loosening-policy-operating-rules-5")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("write-reasoning-policy-operating-rules-5")
    ).toHaveAttribute("href", "/admin/coord/notifications?ref=ref-5");
  });

  it("points each row's aria-controls at its OWN diff panel", () => {
    renderFeed({
      writes: [write()],
      diffFor: () => ({ status: "ready", previous: "", current: "x\n" }),
    });
    const toggle = screen.getByTestId(
      "write-toggle-policy-operating-rules-6"
    );
    expect(toggle).toHaveAttribute(
      "aria-controls",
      "write-diff-policy-operating-rules-6"
    );
    fireEvent.click(toggle);
    expect(
      screen.getByTestId("write-diff-policy-operating-rules-6")
    ).toHaveAttribute("id", "write-diff-policy-operating-rules-6");
  });
});

describe("LandedWriteFeed — the filter and the flagged claim describe ONE set", () => {
  it("does not say 'none flagged' from a loosening the filter hid", () => {
    // An operator-authored loosening, hidden by the agent filter. If the
    // "classified" precondition were computed over the unfiltered feed, the
    // page would print a sentence about rows the operator cannot see.
    const hiddenLoosening = write({
      name: "engineering-priorities",
      label: "Engineering Priorities",
      version_number: 4,
      current_version: 4,
      edited_by: "operator:fb7bf946-cb46-4c38-9a1d-c7081c493b04:jspinak@gmail.com",
      loosening: true,
    });
    const agentOrdinary = write({
      edited_by: "session:f1b444bd-6aff-4e9f-b000-c20d31f3216d",
    });
    renderFeed({ writes: [hiddenLoosening, agentOrdinary] });
    fireEvent.click(screen.getByTestId("landed-writes-author-agent"));

    // The visible row carries NO classification, so there is no verdict to
    // report about what is on screen.
    expect(screen.queryByTestId("landed-writes-none-flagged")).toBeNull();
  });
});
