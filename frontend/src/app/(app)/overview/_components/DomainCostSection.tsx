"use client";

/**
 * "What each domain has cost" — the falsification readout for the claim at
 * the centre of the project's direction: the SECOND autonomy domain should
 * cost less than the first, because the twin infrastructure is shared.
 *
 * Plan `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8. It sits beside the Intent sections because it measures one of
 * them: the verdict line says whether the claim held AS MEASURED, and the
 * sentence under it is the readout table's "what the fleet does" — the
 * decision the verdict commits the fleet to. Then one "Domain cost" card per
 * domain: the stage it reached and its cost per dimension, each with how much
 * of the population that number actually observed.
 *
 * Composed from the console primitives (`HealthStrip` for the verdict,
 * `StatusBadge` over the audited verdict palette) so the verdict's red means
 * what red means on every operator surface. **`null` renders "unknown —
 * <reason>", never `0` and never a dash**: a dimension nobody produces and a
 * domain that spent nothing are different facts, and the verdict turns on
 * telling them apart.
 *
 * It renders its OWN read, independent of the intent documents: a failed
 * intent read must not hide the ledger, nor the ledger's failure the intent.
 *
 * Its UI Bridge ids are `data-testid`s under `overview.summary.domain-cost`,
 * not `data-ui-bridge-id`s: the SDK reads `data-testid` as an unregistered
 * element's id and treats `data-ui-bridge-id` as its own output, so these are
 * the ids the `specs/pages/overview-domain-cost-*` specs can target.
 */

import { HealthStrip, StatusBadge } from "@/components/console";
import type { HealthStripLevel } from "@/components/console";
import { relativeTime } from "@/components/console/time";
import {
  COST_DIMENSIONS,
  coverageText,
  dimensionLabel,
  dimensionValueText,
  ratioText,
  resolveVerdict,
  stageText,
  unknownText,
  type DomainCostComparison,
  type DomainCostDomain,
  type DomainCostPayload,
} from "../_lib/domainCost";
import {
  DOMAIN_COST_VERDICT_PALETTE,
  type DomainCostVerdictKind,
} from "@/components/operations/domainCostStatus";
import type { UseDomainCostResult } from "../_hooks/useDomainCost";

const UI = "overview.summary.domain-cost";

const LEVEL_BY_VERDICT: Record<DomainCostVerdictKind, HealthStripLevel> = {
  compounded: "green",
  inconclusive: "green",
  did_not_compound: "red",
  unfalsifiable: "amber",
  unknown: "amber",
};

/** Dimensions in coord's order, then any this build does not know. */
function dimensionKeys(cost: Record<string, unknown>): string[] {
  const known = COST_DIMENSIONS.filter((k) => k in cost);
  const extra = Object.keys(cost)
    .filter((k) => !(COST_DIMENSIONS as readonly string[]).includes(k))
    .sort();
  return [...known, ...extra];
}

function VerdictBlock({ comparison }: { comparison: DomainCostComparison }) {
  const verdict = resolveVerdict(comparison);
  return (
    <div className="space-y-2" data-testid={`${UI}.verdict`}>
      <HealthStrip
        data-testid={`${UI}.verdict-strip`}
        level={LEVEL_BY_VERDICT[verdict.kind]}
        headline={
          <span className="inline-flex items-center gap-2">
            <StatusBadge status={verdict} palette={DOMAIN_COST_VERDICT_PALETTE} />
            <span>
              {comparison.numerator} against {comparison.denominator}
            </span>
          </span>
        }
      />
      <p
        className="text-[15px] leading-relaxed text-foreground"
        data-testid={`${UI}.verdict-sentence`}
        data-verdict={verdict.kind}
      >
        {verdict.sentence}
      </p>
      <p
        className="text-sm text-muted-foreground"
        data-testid={`${UI}.verdict-reason`}
      >
        Why: {verdict.why}
        {comparison.ratios_informational &&
          " The ratios below are context, not a test: no stage has been attained by both domains yet."}
      </p>
      <table
        className="w-full text-sm"
        data-testid={`${UI}.ratios`}
      >
        <caption className="text-left text-xs text-muted-foreground pb-1">
          Cost ratio R = {comparison.numerator} ÷ {comparison.denominator}{" "}
          (computed only where both sides observed at least{" "}
          {Math.round(comparison.coverage_floor * 100)}% of their units)
          {comparison.marginal_basis && (
            <span
              className="block pt-0.5"
              data-testid={`${UI}.marginal-basis`}
            >
              Compared cost is marginal: {comparison.marginal_basis}
            </span>
          )}
        </caption>
        <tbody>
          {dimensionKeys(comparison.dimensions).map((key) => (
            <tr
              key={key}
              className="border-t border-border"
              data-testid={`${UI}.ratio-${key}`}
            >
              <th scope="row" className="py-1 pr-4 text-left font-normal text-muted-foreground">
                {dimensionLabel(key)}
              </th>
              <td className="py-1 font-mono text-xs">
                {ratioText(comparison.dimensions[key])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p
        className="text-xs text-muted-foreground"
        data-testid={`${UI}.agreement`}
      >
        Attribution agreement:{" "}
        {comparison.agreement === null
          ? unknownText(comparison.agreement_reason)
          : comparison.agreement.toFixed(2)}
      </p>
    </div>
  );
}

function DomainCard({ domain }: { domain: DomainCostDomain }) {
  const id = `${UI}.domain-${domain.name}`;
  return (
    <article
      className="rounded-lg border border-border bg-card/30 p-4"
      data-testid={id}
      aria-labelledby={`${id}-title`}
    >
      <h3
        id={`${id}-title`}
        className="font-[family-name:var(--font-overview-serif)] text-xl leading-snug text-foreground"
      >
        Domain cost: {domain.name}
      </h3>
      <p className="mt-1 text-sm" data-testid={`${id}.stage`}>
        <span className="text-muted-foreground">Stage reached: </span>
        {stageText(domain)}
      </p>
      <table className="mt-3 w-full text-sm" data-testid={`${id}.cost`}>
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="text-left font-normal pb-1">
              Dimension
            </th>
            <th scope="col" className="text-left font-normal pb-1">
              Cost
            </th>
            <th scope="col" className="text-left font-normal pb-1">
              Coverage
            </th>
          </tr>
        </thead>
        <tbody>
          {dimensionKeys(domain.cost).map((key) => {
            const dim = domain.cost[key];
            return (
              <tr
                key={key}
                className="border-t border-border"
                data-testid={`${id}.${key}`}
                title={dim?.basis}
              >
                <th
                  scope="row"
                  className="py-1 pr-4 text-left font-normal text-muted-foreground"
                >
                  {dimensionLabel(key)}
                </th>
                <td className="py-1 pr-4">{dimensionValueText(key, dim)}</td>
                <td className="py-1 text-xs text-muted-foreground">
                  {coverageText(dim)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );
}

function Ledger({ data }: { data: DomainCostPayload }) {
  if (data.domains === null) {
    return (
      <p
        className="border-l-2 border-border pl-4 text-[15px] text-muted-foreground"
        data-testid={`${UI}.roster-unknown`}
        title={data.roster_error_detail ?? undefined}
      >
        The domain roster could not be read, so no domain&rsquo;s cost is
        known: {unknownText(data.roster_error)}.
      </p>
    );
  }
  return (
    <>
      {data.comparison ? (
        <VerdictBlock comparison={data.comparison} />
      ) : (
        <p
          className="text-sm text-muted-foreground"
          data-testid={`${UI}.verdict-unknown`}
        >
          Verdict: {unknownText(data.comparison_reason)}.
        </p>
      )}
      <div className="grid gap-4" data-testid={`${UI}.domains`}>
        {data.domains.map((d) => (
          <DomainCard key={d.name} domain={d} />
        ))}
      </div>
      <p
        className="text-xs text-muted-foreground"
        data-testid={`${UI}.attribution`}
      >
        {data.shared
          ? `${data.shared.shared_unassigned_n} shared-infrastructure units are charged to no domain yet (no record of which domain first used them). `
          : ""}
        {data.unattributed_units_n} work units carry no area
        {data.unmapped_areas && data.unmapped_areas.length > 0
          ? `; ${data.unmapped_areas.length} areas are on no domain's list (${data.unmapped_areas
              .slice(0, 5)
              .map((u) => `${u.area} ${u.count}`)
              .join(", ")}${data.unmapped_areas.length > 5 ? ", …" : ""})`
          : ""}
        .
      </p>
    </>
  );
}

export function DomainCostSection({ read }: { read: UseDomainCostResult }) {
  const { data, loading, error } = read;
  return (
    <section
      aria-labelledby="domain-cost-heading"
      className="space-y-4"
      data-testid={UI}
    >
      <h2
        id="domain-cost-heading"
        className="font-[family-name:var(--font-overview-serif)] text-[1.625rem] leading-snug text-foreground"
      >
        What each domain has cost
      </h2>
      {data ? (
        <>
          <Ledger data={data} />
          <p
            className="text-xs text-muted-foreground"
            data-testid={`${UI}.provenance`}
          >
            Computed {relativeTime(data.computed_at)}
            {data.roster_source.sha
              ? ` from roster ${data.roster_source.path} @ ${data.roster_source.sha.slice(0, 8)}`
              : ""}
            {error ? ` — the latest read failed (${error}); these are the last figures read` : ""}
            .
          </p>
        </>
      ) : (
        <p
          className="border-l-2 border-border pl-4 text-[15px] text-muted-foreground"
          role="status"
          data-testid={`${UI}.unread`}
        >
          {unknownText(error ?? (loading ? "not read yet" : "no answer"))}
        </p>
      )}
    </section>
  );
}
