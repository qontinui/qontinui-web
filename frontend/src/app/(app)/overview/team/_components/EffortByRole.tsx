"use client";

/**
 * "How the work divides" — person-days and fees per role, each with its share
 * of the whole.
 *
 * Every figure here comes from the rollup already summed; this component adds
 * nothing up. The fee column is headed in the estimate's own vocabulary, so a
 * comparison estimate never calls its numbers a budget.
 *
 * Client-side roles are listed separately: their days are real, their fee is
 * not, and mixing them would overstate both.
 */

import { formatDecimal, formatMicros } from "@/components/overview/money";
import { NotAvailable } from "@/components/overview/UnavailableNotes";
import type { EstimateVocabulary } from "@/components/overview/vocabulary";
import type { RollupRole } from "../../_lib/estimate-api";

function Share({ pct }: { pct: string | null }) {
  const text = formatDecimal(pct, 1);
  if (text === null) return null;
  return <span className="ml-2 text-xs text-muted-foreground">{text}%</span>;
}

export function EffortByRole({
  roles,
  currency,
  vocabulary,
  totalPersonDays,
}: {
  roles: RollupRole[];
  currency: string | null;
  vocabulary: EstimateVocabulary;
  totalPersonDays: string;
}) {
  const working = roles.filter(
    (r) => (Number(r.person_days) || 0) > 0 || r.fee_micros !== null
  );
  if (working.length === 0) {
    return (
      <p
        className="text-[15px] leading-relaxed text-muted-foreground"
        data-ui-bridge-id="overview.team.effort.empty"
      >
        No effort has been split across roles yet, so there is nothing to divide
        up here.
      </p>
    );
  }

  const ours = working.filter((r) => !r.client_side);
  const theirs = working.filter((r) => r.client_side);
  const anyFee = ours.some((r) => r.fee_micros !== null);

  return (
    <div className="space-y-8" data-ui-bridge-id="overview.team.effort">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th
                scope="col"
                className="py-2 pr-4 font-medium text-muted-foreground"
              >
                Role
              </th>
              <th
                scope="col"
                className="py-2 pr-4 text-right font-medium text-muted-foreground"
              >
                Days of work
              </th>
              {anyFee && (
                <th
                  scope="col"
                  className="py-2 text-right font-medium text-muted-foreground"
                >
                  {vocabulary.feeLabel}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {ours.map((role) => (
              <tr
                key={role.id}
                className="border-b border-border/60"
                data-ui-bridge-id={`overview.team.effort.${role.code}`}
              >
                <td className="py-2 pr-4 text-foreground">
                  <span className="font-mono text-xs text-muted-foreground">
                    {role.code}
                  </span>{" "}
                  {role.name}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-foreground">
                  {formatDecimal(role.person_days)}
                  <Share pct={role.person_days_share_pct} />
                </td>
                {anyFee && (
                  <td className="py-2 text-right tabular-nums text-foreground">
                    {formatMicros(role.fee_micros, currency) ?? (
                      <NotAvailable label="no day rate set" />
                    )}
                    {role.fee_micros !== null && (
                      <Share pct={role.fee_share_pct} />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <th
                scope="row"
                className="py-2 pr-4 text-left font-medium text-foreground"
              >
                All of our roles
              </th>
              <td
                className="py-2 pr-4 text-right tabular-nums font-medium text-foreground"
                data-ui-bridge-id="overview.team.effort.total-days"
              >
                {formatDecimal(totalPersonDays)}
              </td>
              {anyFee && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {theirs.length > 0 && (
        <div data-ui-bridge-id="overview.team.effort.client-side">
          <h3 className="font-[family-name:var(--font-overview-serif)] text-lg text-foreground">
            Effort asked of the client
          </h3>
          <p className="mb-3 mt-1 text-sm leading-relaxed text-muted-foreground">
            Real time the client&rsquo;s own people have to give. It carries no
            fee here, so it is counted apart from the figures above rather than
            folded into them.
          </p>
          <ul className="space-y-1.5 text-sm">
            {theirs.map((role) => (
              <li
                key={role.id}
                className="flex justify-between gap-6 border-b border-border/60 py-1.5 last:border-b-0"
                data-ui-bridge-id={`overview.team.effort.client-side.${role.code}`}
              >
                <span className="text-foreground">{role.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatDecimal(role.person_days)} days
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
