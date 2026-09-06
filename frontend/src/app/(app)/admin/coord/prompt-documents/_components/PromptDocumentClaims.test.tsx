/**
 * PromptDocumentClaims — the per-claim probe render (plan
 * `2026-09-06-domain-spec-divergences-decay-with-no-re-probe`, Phase 2).
 *
 * Four things are pinned, and each one fails silently otherwise:
 *
 * 1. **An ABSENT envelope is "not served", never zero.** A coord predating the
 *    probe grammar serves none of the five `claims*` fields. Rendering that as
 *    "no probe blocks in this document" would be a confident zero where the
 *    honest state is UNKNOWN — and it would make a stopped sweep look like a
 *    corpus with nothing to contradict, the exact detection gap the plan names.
 * 2. **`claims_probed === 0` IS a confident zero**, and says so in words.
 * 3. **The three states are distinguishable, and `unknown` never wears the
 *    `confirmed` styling.** Asserted by text, by `aria-label`, and by the
 *    absence of the green family on the unknown badge — because the badge
 *    reading "Unknown" in green would still be the mistake R3 exists to stop.
 * 4. **A non-`table` source is named.** `table_absent` is the deploy-ordering
 *    window (migration not applied where coord reads); the notice must say
 *    which, so an operator can tell it from "the sweep found nothing".
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { PromptDocumentClaims, compactDetail } from "./PromptDocumentClaims";
import { PromptDocumentEditorDialog } from "./PromptDocumentEditorDialog";
import type { PromptDocument, PromptDocumentClaim } from "../types";

/** A fixed clock so relative times are deterministic. */
const NOW = Date.parse("2026-09-06T08:00:00Z");

function claim(overrides: Partial<PromptDocumentClaim> = {}): PromptDocumentClaim {
  return {
    claim_id: "speculative-chaining-lever",
    state: "confirmed",
    observed_at: "2026-09-06T07:55:00Z",
    verified_at: "2026-09-06T06:30:00Z",
    verified_against: "qontinui-coord@a497830f",
    anchor_type: "flag_state",
    detail: {},
    ...overrides,
  };
}

function doc(overrides: Partial<PromptDocument> = {}): PromptDocument {
  return {
    id: "doc-1",
    tenant_id: "tenant-1",
    kind: "domain_spec",
    name: "coord-merge-train",
    description: "Coord merge train",
    format: "markdown",
    default_source: null,
    current_version: 4,
    updated_by: "editor@example.com",
    updated_at: "2026-09-06T07:00:00Z",
    body: "The merge train.",
    attrs: null,
    ...overrides,
  };
}

describe("PromptDocumentClaims — absent envelope", () => {
  it("renders the not-served notice, never a zero", () => {
    render(<PromptDocumentClaims document={doc()} now={NOW} />);

    const notice = screen.getByTestId("doc-claims-not-served");
    expect(notice).toHaveTextContent(/not served by this coord build/i);
    expect(screen.queryByTestId("doc-claims-none")).toBeNull();
    expect(screen.queryByTestId("doc-claims-header")).toBeNull();
    expect(screen.queryByText(/Claims probed: 0/)).toBeNull();
  });
});

describe("PromptDocumentClaims — no probe blocks", () => {
  it("says the document carries no probe blocks and reports source table", () => {
    render(
      <PromptDocumentClaims
        document={doc({
          claims: [],
          claims_probed: 0,
          claims_malformed: 0,
          claims_observed_at: null,
          claims_state_source: "table",
        })}
        now={NOW}
      />
    );

    expect(screen.getByTestId("doc-claims-none")).toHaveTextContent(
      /no probe blocks in this document/i
    );
    const header = screen.getByTestId("doc-claims-header");
    expect(header).toHaveTextContent("Claims probed: 0");
    expect(header).toHaveTextContent("newest observation never");
    expect(header).toHaveTextContent("source table");
    expect(screen.queryByTestId("doc-claims-not-served")).toBeNull();
    expect(screen.queryByTestId("doc-claims-source-table")).toBeNull();
  });
});

describe("PromptDocumentClaims — one claim in each state", () => {
  const mixed = doc({
    claims: [
      claim({ claim_id: "lever-armed", state: "confirmed" }),
      claim({
        claim_id: "taskdef-value",
        state: "contradicted",
        anchor_type: "content",
        detail: { reason: "moved", resolved: { matches: false } },
      }),
      claim({
        claim_id: "never-seen",
        state: "unknown",
        observed_at: null,
        anchor_type: null,
        detail: { reason: "never_observed" },
      }),
    ],
    claims_probed: 3,
    claims_malformed: 1,
    claims_observed_at: "2026-09-06T07:55:00Z",
    claims_state_source: "table",
  });

  it("renders the header with the count, a relative newest observation and the source", () => {
    render(<PromptDocumentClaims document={mixed} now={NOW} />);
    const header = screen.getByTestId("doc-claims-header");
    expect(header).toHaveTextContent("Claims probed: 3");
    expect(header).toHaveTextContent("newest observation 5m ago");
    expect(header).toHaveTextContent("source table");
    expect(header).toHaveTextContent("1 malformed block skipped");
  });

  it("renders one row per claim with a badge distinguishable by text and aria-label", () => {
    render(<PromptDocumentClaims document={mixed} now={NOW} />);

    const confirmed = within(
      screen.getByTestId("doc-claim-state-lever-armed")
    ).getByLabelText("claim state: confirmed");
    const contradicted = within(
      screen.getByTestId("doc-claim-state-taskdef-value")
    ).getByLabelText("claim state: contradicted");
    const unknown = within(
      screen.getByTestId("doc-claim-state-never-seen")
    ).getByLabelText("claim state: unknown");

    expect(confirmed).toHaveTextContent("Confirmed");
    expect(contradicted).toHaveTextContent("Contradicted");
    expect(unknown).toHaveTextContent("Unknown");

    // Three distinct styles: no two badges share a class string.
    const classes = [confirmed, contradicted, unknown].map(
      (el) => el.className
    );
    expect(new Set(classes).size).toBe(3);
  });

  it("never paints unknown in the confirmed (green) family", () => {
    render(<PromptDocumentClaims document={mixed} now={NOW} />);

    const confirmed = screen.getByLabelText("claim state: confirmed");
    const unknown = screen.getByLabelText("claim state: unknown");
    const contradicted = screen.getByLabelText("claim state: contradicted");

    expect(confirmed.className).toMatch(/green/);
    expect(unknown.className).not.toMatch(/green/);
    expect(unknown.className).toMatch(/amber/);
    expect(contradicted.className).not.toMatch(/green/);
    expect(contradicted.className).toMatch(/red/);
    expect(unknown.getAttribute("data-state")).toBe("unknown");
  });

  it("renders the stamps, the anchor type and a compact detail per row", () => {
    render(<PromptDocumentClaims document={mixed} now={NOW} />);

    const row = screen.getByTestId("doc-claim-taskdef-value");
    expect(row).toHaveTextContent("observed 5m ago");
    expect(row).toHaveTextContent("verified 1h ago");
    expect(row).toHaveTextContent("against qontinui-coord@a497830f");
    expect(row).toHaveTextContent("content");
    expect(screen.getByTestId("doc-claim-detail-taskdef-value")).toHaveTextContent(
      'reason=moved · resolved={"matches":false}'
    );

    const unknownRow = screen.getByTestId("doc-claim-never-seen");
    expect(unknownRow).toHaveTextContent("observed never");
    expect(unknownRow).toHaveTextContent("no anchor");
    expect(screen.getByTestId("doc-claim-detail-never-seen")).toHaveTextContent(
      "reason=never_observed"
    );
  });

  it("treats a state this build does not know as unknown, and says which spelling was served", () => {
    render(
      <PromptDocumentClaims
        document={doc({
          claims: [
            claim({
              claim_id: "future-state",
              // A vocabulary this build has never seen — cast, because the
              // wire is JSON and the type is a promise coord may outgrow.
              state: "refuted" as PromptDocumentClaim["state"],
            }),
          ],
          claims_probed: 1,
          claims_malformed: 0,
          claims_observed_at: "2026-09-06T07:55:00Z",
          claims_state_source: "table",
        })}
        now={NOW}
      />
    );
    const badge = screen.getByLabelText("claim state: unknown (served as refuted)");
    expect(badge.className).not.toMatch(/green/);
    expect(badge.getAttribute("data-state")).toBe("unknown");
    expect(badge).toHaveTextContent("Unknown (refuted)");
  });
});

describe("PromptDocumentClaims — claim-state table unreadable", () => {
  it("names table_absent and still lists every claim as unknown", () => {
    render(
      <PromptDocumentClaims
        document={doc({
          claims: [
            claim({
              claim_id: "lever-armed",
              state: "unknown",
              observed_at: null,
              detail: { reason: "table_absent" },
            }),
          ],
          claims_probed: 1,
          claims_malformed: 0,
          claims_observed_at: null,
          claims_state_source: "table_absent",
        })}
        now={NOW}
      />
    );

    const notice = screen.getByTestId("doc-claims-source-table_absent");
    expect(notice).toHaveTextContent(/could not find its claim-state table/i);
    expect(notice).toHaveTextContent("table_absent");
    expect(screen.getByTestId("doc-claims-header")).toHaveTextContent(
      "source table_absent"
    );
    // The claim is still LISTED — a degraded read never renders as an empty
    // list when the body carries probe blocks.
    expect(screen.getByTestId("doc-claim-lever-armed")).toBeInTheDocument();
    expect(screen.getByLabelText("claim state: unknown")).toBeInTheDocument();
    expect(screen.queryByTestId("doc-claims-none")).toBeNull();
  });

  it("names read_failed", () => {
    render(
      <PromptDocumentClaims
        document={doc({
          claims: [claim({ state: "unknown", observed_at: null })],
          claims_probed: 1,
          claims_malformed: 0,
          claims_observed_at: null,
          claims_state_source: "read_failed",
        })}
        now={NOW}
      />
    );
    expect(screen.getByTestId("doc-claims-source-read_failed")).toHaveTextContent(
      "read_failed"
    );
  });

  it("says the list is unknown when coord counted blocks but served no rows", () => {
    render(
      <PromptDocumentClaims
        document={doc({
          claims: [],
          claims_probed: 2,
          claims_malformed: 0,
          claims_observed_at: null,
          claims_state_source: "read_failed",
        })}
        now={NOW}
      />
    );
    expect(screen.getByTestId("doc-claims-empty-list")).toHaveTextContent(
      /unknown, not empty/i
    );
    expect(screen.queryByTestId("doc-claims-none")).toBeNull();
  });
});

describe("compactDetail", () => {
  it("puts reason and stale first, then the rest sorted", () => {
    expect(
      compactDetail({ zeta: 1, stale: true, alpha: "x", reason: "never_observed" })
    ).toBe("reason=never_observed · stale=true · alpha=x · zeta=1");
  });

  it("renders an empty detail as a dash", () => {
    expect(compactDetail({})).toBe("—");
  });
});

describe("PromptDocumentEditorDialog — claims panel is wired", () => {
  it("shows the panel for a fetched document, in its not-served form when coord served nothing", () => {
    render(
      <PromptDocumentEditorDialog
        open
        onOpenChange={vi.fn()}
        document={doc()}
        loadingBody={false}
        saving={false}
        onUpdate={vi.fn().mockResolvedValue(true)}
        onRestore={vi.fn().mockResolvedValue(true)}
        onShowHistory={vi.fn()}
      />
    );
    expect(screen.getByTestId("doc-claims")).toBeInTheDocument();
    expect(screen.getByTestId("doc-claims-not-served")).toBeInTheDocument();
  });

  it("shows the served rows for a document that carries the envelope", () => {
    render(
      <PromptDocumentEditorDialog
        open
        onOpenChange={vi.fn()}
        document={doc({
          claims: [claim({ claim_id: "lever-armed", state: "contradicted" })],
          claims_probed: 1,
          claims_malformed: 0,
          claims_observed_at: "2026-09-06T07:55:00Z",
          claims_state_source: "table",
        })}
        loadingBody={false}
        saving={false}
        onUpdate={vi.fn().mockResolvedValue(true)}
        onRestore={vi.fn().mockResolvedValue(true)}
        onShowHistory={vi.fn()}
      />
    );
    expect(screen.getByTestId("doc-claim-lever-armed")).toBeInTheDocument();
    expect(screen.getByLabelText("claim state: contradicted")).toBeInTheDocument();
  });
});
