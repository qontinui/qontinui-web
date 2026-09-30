/**
 * The "What each domain has cost" readout — plan
 * `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8.
 *
 * Three fixture payloads, one per verdict the plan's acceptance names
 * (compounded / did-not-compound / unfalsifiable), each asserting the card
 * text an operator reads — the verdict, the readout table's "what the fleet
 * does" sentence, the stage, the per-dimension cost with its coverage. Then
 * the null cases, because the one rule this surface holds is that a `null`
 * renders "unknown — <reason>" and never `0` or a dash.
 *
 * The fixtures live in `test-fixtures/domain-cost/` and are the SAME bodies
 * the UI Bridge specs under `specs/pages/overview-domain-cost-*` stub the
 * route with; the last block pins that, so the on-page spec and this test
 * cannot drift onto different payloads.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DomainCostSection } from "./DomainCostSection";
import type { DomainCostPayload } from "../_lib/domainCost";
import type { UseDomainCostResult } from "../_hooks/useDomainCost";
import compoundedJson from "../../../../../test-fixtures/domain-cost/compounded.json";
import didNotCompoundJson from "../../../../../test-fixtures/domain-cost/did-not-compound.json";
import unfalsifiableJson from "../../../../../test-fixtures/domain-cost/unfalsifiable.json";

const compounded = compoundedJson as unknown as DomainCostPayload;
const didNotCompound = didNotCompoundJson as unknown as DomainCostPayload;
const unfalsifiable = unfalsifiableJson as unknown as DomainCostPayload;

function read(
  data: DomainCostPayload | null,
  over: Partial<UseDomainCostResult> = {}
): UseDomainCostResult {
  return {
    data,
    loading: false,
    error: null,
    refresh: async () => undefined,
    ...over,
  };
}

/**
 * The element carrying a UI Bridge id. The ids are `data-testid`s because
 * that is the attribute the UI Bridge SDK READS as an element's id on an
 * unregistered element (`data-ui-bridge-id` is an attribute it WRITES), so
 * these are exactly the ids the on-page specs target.
 */
const byUi = (id: string): HTMLElement => screen.getByTestId(id);

const UI = "overview.summary.domain-cost";

describe("DomainCostSection — the three verdicts", () => {
  it("COMPOUNDED: says proceed, and shows each domain's cost with coverage", () => {
    render(<DomainCostSection read={read(compounded)} />);

    expect(byUi(`${UI}.verdict-sentence`)).toHaveTextContent(
      "Proceed to domain 3, and record the reuse floor as the explanation."
    );
    expect(byUi(`${UI}.verdict-sentence`).dataset.verdict).toBe("compounded");
    expect(byUi(`${UI}.verdict`)).toHaveTextContent("Compounded");
    expect(byUi(`${UI}.verdict-reason`)).toHaveTextContent(
      "work-unit R 0.400 <= 0.5 and wall-clock R 0.500 < 1"
    );
    // Not informational: both domains attained a stage.
    expect(byUi(`${UI}.verdict-reason`)).not.toHaveTextContent("context, not a test");
    expect(byUi(`${UI}.ratio-work_units`)).toHaveTextContent("0.40");
    expect(byUi(`${UI}.ratio-wall_clock_secs`)).toHaveTextContent("0.50");

    // One card per domain, titled, with its stage.
    expect(screen.getByRole("heading", { name: "Domain cost: ux" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Domain cost: operations" })
    ).toBeInTheDocument();
    expect(byUi(`${UI}.domain-operations.stage`)).toHaveTextContent(
      "Stage reached: perceive"
    );
    const ops = byUi(`${UI}.domain-operations.work_units`);
    expect(ops).toHaveTextContent("Work units");
    expect(ops).toHaveTextContent("16");
    expect(ops).toHaveTextContent("108 of 120 observed");
    // 72 000 s of wall-clock renders as a duration, not a raw second count.
    expect(byUi(`${UI}.domain-operations.wall_clock_secs`)).toHaveTextContent(
      "20h"
    );
  });

  it("DID_NOT_COMPOUND: says stop opening domains, on the red verdict", () => {
    render(<DomainCostSection read={read(didNotCompound)} />);

    const sentence = byUi(`${UI}.verdict-sentence`);
    expect(sentence).toHaveTextContent(
      "Each new domain costs about the same. Stop opening new domains, and run the twin audit before any domain-3 work is ranked."
    );
    expect(sentence.dataset.verdict).toBe("did_not_compound");
    expect(byUi(`${UI}.verdict`)).toHaveTextContent("Did not compound");
    // Red means someone must act: the strip reads red and the badge carries ✕.
    expect(
      byUi(`${UI}.verdict`).querySelector('[data-health-level="red"]')
    ).not.toBeNull();
    expect(byUi(`${UI}.verdict`)).toHaveTextContent("✕");
    expect(byUi(`${UI}.agreement`)).toHaveTextContent(
      "Attribution agreement: 0.90"
    );
    expect(byUi(`${UI}.ratio-work_units`)).toHaveTextContent("0.95");
  });

  it("UNFALSIFIABLE_AS_MEASURED: names the only ranked work and every unknown", () => {
    render(<DomainCostSection read={read(unfalsifiable)} />);

    expect(byUi(`${UI}.verdict-sentence`)).toHaveTextContent(
      "The only ranked work is attribution coverage. No claim in either direction is reported."
    );
    expect(byUi(`${UI}.verdict`)).toHaveTextContent("Unfalsifiable as measured");
    expect(byUi(`${UI}.verdict-reason`)).toHaveTextContent(
      "no_common_attained_stage"
    );
    expect(byUi(`${UI}.verdict-reason`)).toHaveTextContent(
      "context, not a test"
    );
    // Stage and ratios are unknown WITH their reason — never blank.
    expect(byUi(`${UI}.domain-ux.stage`)).toHaveTextContent(
      "Stage reached: unknown — no_attainment_claims"
    );
    expect(byUi(`${UI}.ratio-work_units`)).toHaveTextContent(
      "unknown — coverage"
    );
    expect(byUi(`${UI}.agreement`)).toHaveTextContent(
      "unknown — no_attribution_agreement_record"
    );
  });
});

describe("DomainCostSection — null renders unknown, never 0 or a dash", () => {
  it("a dimension with no producer reads unknown with its reason", () => {
    render(<DomainCostSection read={read(compounded)} />);
    const tokens = byUi(`${UI}.domain-ux.tokens`);
    expect(tokens).toHaveTextContent("unknown — no_producer");
    expect(tokens).not.toHaveTextContent(/\b0\b.*observed.*—/);
    const touches = byUi(`${UI}.domain-ux.operator_touches`);
    expect(touches).toHaveTextContent("unknown — store_empty");
    // The only dash on the card is the one inside "unknown — …".
    for (const cell of within(byUi(`${UI}.domain-ux.cost`)).getAllByRole(
      "cell"
    )) {
      expect(cell.textContent?.trim()).not.toBe("—");
      expect(cell.textContent?.trim()).not.toBe("–");
    }
  });

  it("an unreadable roster says so, and renders no domain cards", () => {
    const body: DomainCostPayload = {
      ...unfalsifiable,
      roster: null,
      roster_error: "path_absent_at_sha",
      roster_error_detail: null,
      domains: null,
      shared: null,
      unmapped_areas: null,
      comparison: null,
      comparison_reason: "roster_unavailable",
    };
    render(<DomainCostSection read={read(body)} />);
    expect(byUi(`${UI}.roster-unknown`)).toHaveTextContent(
      "unknown — path_absent_at_sha"
    );
    expect(screen.queryByTestId(`${UI}.domains`)).toBeNull();
    expect(screen.queryByRole("heading", { name: /Domain cost:/ })).toBeNull();
  });

  it("a missing comparison names its reason", () => {
    render(
      <DomainCostSection
        read={read({
          ...compounded,
          comparison: null,
          comparison_reason: "fewer_than_two_domains",
        })}
      />
    );
    expect(byUi(`${UI}.verdict-unknown`)).toHaveTextContent(
      "Verdict: unknown — fewer_than_two_domains"
    );
  });

  it("a read that never answered is unknown with the failure, not an empty ledger", () => {
    render(
      <DomainCostSection
        read={read(null, { error: "coord read deadline (20000 ms) exceeded — unknown" })}
      />
    );
    expect(byUi(`${UI}.unread`)).toHaveTextContent(
      "unknown — coord read deadline (20000 ms) exceeded"
    );
  });

  it("a read still in flight is unknown — not read yet", () => {
    render(<DomainCostSection read={read(null, { loading: true })} />);
    expect(byUi(`${UI}.unread`)).toHaveTextContent("unknown — not read yet");
  });

  it("a failed LATEST read keeps the figures and says they are the last read", () => {
    render(
      <DomainCostSection read={read(compounded, { error: "HTTP 502" })} />
    );
    expect(byUi(`${UI}.verdict-sentence`)).toHaveTextContent("Proceed to domain 3");
    expect(byUi(`${UI}.provenance`)).toHaveTextContent(
      "the latest read failed (HTTP 502); these are the last figures read"
    );
  });

  it("an unrecognised verdict string is unknown, never guessed into a row", () => {
    render(
      <DomainCostSection
        read={read({
          ...compounded,
          comparison: { ...compounded.comparison!, verdict: "SORT_OF" },
        })}
      />
    );
    expect(byUi(`${UI}.verdict-sentence`)).toHaveTextContent(
      'unknown — coord returned verdict "SORT_OF"'
    );
    expect(byUi(`${UI}.verdict-sentence`).dataset.verdict).toBe("unknown");
  });
});

describe("the UI Bridge specs stub the same payloads this test renders", () => {
  const specsDir = join(__dirname, "../../../../../specs/pages");
  it.each([
    ["overview-domain-cost-compounded", compoundedJson],
    ["overview-domain-cost-did-not-compound", didNotCompoundJson],
    ["overview-domain-cost-unfalsifiable", unfalsifiableJson],
  ])("%s", (specId, fixture) => {
    const spec = JSON.parse(
      readFileSync(join(specsDir, specId, "state-machine.derived.json"), "utf8")
    ) as {
      id: string;
      metadata: { routeStubs: Array<{ urlPattern: string; body: unknown }> };
    };
    expect(spec.id).toBe(specId);
    const stub = spec.metadata.routeStubs.find((s) =>
      s.urlPattern.includes("/api/v1/operations/domain-cost")
    );
    expect(stub?.body).toEqual(fixture);
  });
});
