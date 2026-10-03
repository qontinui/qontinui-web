"use client";

/**
 * Project Overview — Costs: what the project has actually cost (plan
 * `2026-10-03-provider-reported-spend-collection-alerts-and-mobile`,
 * Phase 4; the "Actual costs" view of
 * `2026-09-19-project-overview-for-business-leaders`).
 *
 * Every amount is the provider's own statement, or an invoice amount the
 * operator entered as a recurring cost, and each is labelled with which. A
 * provider that could not be read is shown as not available — with the date
 * and the reason — never as $0, and a total over it is a floor ("at least
 * $X"). The page computes no figure of its own beyond adding what providers
 * reported.
 */

import { useState } from "react";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { Skeleton } from "@/components/ui/skeleton";
import { useOverviewProject } from "../_hooks/useOverviewProject";
import { AlertsList, RenewalsList } from "./_components/AlertsAndRenewals";
import { BreakdownTable } from "./_components/BreakdownTable";
import { DailySpendChart } from "./_components/DailySpendChart";
import { SourcesStrip } from "./_components/SourcesStrip";
import { SpendFigures } from "./_components/SpendFigures";
import { ViewSwitch } from "./_components/ViewSwitch";
import { formatDay, formatFetched } from "./_lib/spend";
import type { SpendView } from "./_lib/spend-api";
import { useSpend, type BreakdownBy } from "./_lib/useSpend";

function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} data-ui-bridge-id={id}>
      <h2
        id={`${id}-heading`}
        className="font-[family-name:var(--font-overview-serif)] text-[1.625rem] leading-snug text-foreground"
      >
        {title}
      </h2>
      {lede && (
        <p className="mb-5 mt-1.5 max-w-[46rem] text-[15px] leading-relaxed text-muted-foreground">
          {lede}
        </p>
      )}
      <div className={lede ? "" : "mt-5"}>{children}</div>
    </section>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="grid gap-8 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export default function CostsPage() {
  const { projectId, hold, tenantsError } = useOverviewProject();
  const [view, setView] = useState<SpendView>("amortized");
  const [breakdownBy, setBreakdownBy] = useState<BreakdownBy>("scope");
  const [breakdownVendor, setBreakdownVendor] = useState<string | null>(null);
  const { summary, breakdown, renewals, reloadAll } = useSpend({
    projectId,
    hold,
    view,
    breakdownBy,
    breakdownVendor,
  });

  if (tenantsError) {
    return (
      <div className="max-w-[42rem]" data-ui-bridge-id="overview.costs">
        <LoadFailure
          what="the list of projects"
          message={tenantsError}
          uiBridgeId="overview.costs.tenants.error"
        />
      </div>
    );
  }

  return (
    <div
      className="max-w-[64rem]"
      data-ui-bridge-id="overview.costs"
      aria-busy={summary.state === "loading"}
    >
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-[40rem] text-[15px] leading-relaxed text-muted-foreground">
          What this project has actually been charged, as each provider reports
          it. Nothing here is estimated.
        </p>
        <ViewSwitch view={view} onChange={setView} />
      </div>

      {summary.state === "loading" && <PageSkeleton />}

      {summary.state === "error" && (
        <LoadFailure
          what="this project's costs"
          message={summary.message}
          uiBridgeId="overview.costs.error"
        />
      )}

      {summary.state === "ready" && (
        <div className="space-y-14">
          <section data-ui-bridge-id="overview.costs.header">
            <SpendFigures summary={summary.data} />
            <p className="mt-4 text-xs text-muted-foreground">
              {formatDay(summary.data.from)} to {formatDay(summary.data.to)} ·
              read {formatFetched(summary.data.generated_at)}
            </p>
          </section>

          <Section
            id="overview.costs.section.daily"
            title="Day by day"
            lede="Each provider's daily charges over the last 60 days. A day a provider has not reported is left empty — it is not a $0 day."
          >
            <DailySpendChart summary={summary.data} />
          </Section>

          <Section
            id="overview.costs.section.breakdown"
            title="Where it went"
            lede="By repository or service, or by the provider's own SKU, with any discount shown apart from what was billed."
          >
            <BreakdownTable
              breakdown={breakdown}
              vendors={summary.data.vendors}
              by={breakdownBy}
              onBy={setBreakdownBy}
              vendor={breakdownVendor}
              onVendor={setBreakdownVendor}
            />
          </Section>

          <Section
            id="overview.costs.section.sources"
            title="Sources"
            lede="Where each provider's figures come from, and whether they are up to date."
          >
            <SourcesStrip summary={summary.data} onChanged={reloadAll} />
          </Section>

          <Section
            id="overview.costs.section.alerts"
            title="Alerts"
            lede="Spend alerts sent to the project's administrators, and whether each one reached a phone."
          >
            <AlertsList summary={summary.data} />
          </Section>

          <Section
            id="overview.costs.section.renewals"
            title="Coming up"
            lede="Yearly charges due in the next 60 days, at the amount entered from the last invoice."
          >
            <RenewalsList renewals={renewals} />
          </Section>
        </div>
      )}
    </div>
  );
}
