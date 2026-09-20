"use client";

/**
 * Project Overview — Team. Which roles the project needs, how much of each
 * per phase, and at what rate (plan
 * `2026-09-19-project-overview-for-business-leaders`, Phase 2).
 *
 * Every figure comes rolled up from `…/estimates/{id}/rollup`; this page adds
 * nothing up itself. Every label that depends on what the estimate IS comes
 * from `estimateVocabulary`, so a comparison estimate never speaks of a
 * budget.
 *
 * Three empty-ish states are kept apart, because they mean different things:
 * the read failed, the project has no estimate yet, and the estimate has no
 * roles yet. None of them is rendered as a zero.
 */

import Link from "next/link";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { UnavailableNotes } from "@/components/overview/UnavailableNotes";
import {
  estimateVocabulary,
  labourBillingDescription,
} from "@/components/overview/vocabulary";
import { formatDecimal, formatMicros } from "@/components/overview/money";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";
import { useEstimate } from "../_hooks/useEstimate";
import type { EstimateRollup } from "../_lib/estimate-api";
import { EffortByRole } from "./_components/EffortByRole";
import { FteMatrix } from "./_components/FteMatrix";
import { RolesTable } from "./_components/RolesTable";

const EDITOR_ROUTE = "/overview/team/edit";

function TableSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-7 w-52" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-10/12" />
    </div>
  );
}

function Figure({
  label,
  value,
  detail,
  uiBridgeId,
}: {
  label: string;
  /** `null` renders as an explicit "not known", never as 0. */
  value: string | null;
  detail?: string;
  uiBridgeId: string;
}) {
  return (
    <div data-ui-bridge-id={uiBridgeId}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-[family-name:var(--font-overview-serif)] text-2xl leading-tight text-foreground">
        {value ?? (
          <span className="text-lg text-muted-foreground">Not known</span>
        )}
      </dd>
      {detail && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {detail}
        </p>
      )}
    </div>
  );
}

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

function TeamBody({
  rollup,
  labourBilling,
}: {
  rollup: EstimateRollup;
  labourBilling: string;
}) {
  const vocabulary = estimateVocabulary(rollup.purpose);
  const billing = labourBillingDescription(labourBilling);
  const currency = rollup.money.currency;
  const primaryTier =
    rollup.money.tiers.find((t) => t.is_primary) ?? rollup.money.tiers[0] ?? null;

  return (
    <div className="space-y-14">
      <section data-ui-bridge-id="overview.team.header">
        <p className="text-sm text-muted-foreground">
          {rollup.name} &middot; {vocabulary.noun}
        </p>
        <p className="mt-2 max-w-[46rem] text-[15px] leading-relaxed text-foreground">
          {vocabulary.meaning}
        </p>
        <p
          className="mt-2 max-w-[46rem] text-[15px] leading-relaxed text-muted-foreground"
          data-ui-bridge-id="overview.team.labour-billing"
        >
          <span className="text-foreground">Labour: {billing.label}.</span>{" "}
          {billing.detail}
        </p>

        <dl className="mt-8 grid gap-8 sm:grid-cols-3">
          <Figure
            label="Days of work"
            value={formatDecimal(rollup.effort.total_person_days)}
            detail="Added up from the split of each task across roles."
            uiBridgeId="overview.team.figure.person-days"
          />
          <Figure
            label="People at the peak"
            value={formatDecimal(rollup.team.peak_fte, 3)}
            detail={
              rollup.team.peak_phase_code
                ? `Busiest in phase ${rollup.team.peak_phase_code}.`
                : undefined
            }
            uiBridgeId="overview.team.figure.peak-fte"
          />
          <Figure
            label="People on average"
            value={formatDecimal(rollup.team.average_fte, 3)}
            detail="Weighted by how long each phase runs."
            uiBridgeId="overview.team.figure.average-fte"
          />
        </dl>

        {primaryTier && (
          <dl className="mt-8 grid gap-8 sm:grid-cols-2">
            <Figure
              label={vocabulary.totalLabel}
              value={formatMicros(primaryTier.labour_micros, currency)}
              detail={
                rollup.money.tiers.length > 1
                  ? `At the ${primaryTier.name.toLowerCase()} price. Other prices are shown on the Costs page.`
                  : "Days of work priced at each role's day rate."
              }
              uiBridgeId="overview.team.figure.fee"
            />
            <Figure
              label="Days the client has to give"
              value={formatDecimal(rollup.effort.client_side_person_days)}
              detail="Their own people's time, which this estimate does not price."
              uiBridgeId="overview.team.figure.client-days"
            />
          </dl>
        )}
      </section>

      <Section
        id="overview.team.section.roles"
        title="The roles this project needs"
        lede="What each role is here to do, and what a day of it costs."
      >
        <RolesTable roles={rollup.roles} />
      </Section>

      <Section
        id="overview.team.section.allocation"
        title="How much of each role, phase by phase"
        lede="Measured in people: 0.5 is somebody half of their week. The busiest phase is marked, because that is when the project needs the most people at once."
      >
        <FteMatrix
          phases={rollup.phases}
          roles={rollup.roles}
          allocations={rollup.allocations}
          peakPhaseCode={rollup.team.peak_phase_code}
        />
      </Section>

      <Section
        id="overview.team.section.effort"
        title="How the work divides"
        lede="Days of work per role, and what each role's share of the whole comes to."
      >
        <EffortByRole
          roles={rollup.roles}
          currency={currency}
          vocabulary={vocabulary}
          totalPersonDays={rollup.effort.delivery_person_days}
        />
      </Section>

      <UnavailableNotes
        items={rollup.unavailable}
        uiBridgeId="overview.team.unavailable"
      />
    </div>
  );
}

function NoEstimate({ canEdit }: { canEdit: boolean }) {
  return (
    <section className="max-w-[38rem]" data-ui-bridge-id="overview.team.no-estimate">
      <h2 className="font-[family-name:var(--font-overview-serif)] text-2xl text-foreground">
        This project has no estimate yet
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
        The Team page shows the roles a project needs, how much of each it
        needs per phase, and what that comes to. All of it is read from the
        project&rsquo;s estimate, and none has been entered.
      </p>
      {canEdit ? (
        <Link
          href={EDITOR_ROUTE}
          className="mt-5 inline-flex min-h-9 items-center rounded-md bg-primary px-3.5 text-sm text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id="overview.team.no-estimate.create"
        >
          Set up the estimate
        </Link>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">
          An administrator of this project can enter one.
        </p>
      )}
    </section>
  );
}

export default function TeamPage() {
  const { isCoordAdmin } = useAuth();
  const {
    activeTenantId,
    loading: tenantsLoading,
    error: tenantsError,
  } = useTenant();
  const { data } = useEstimate(
    activeTenantId,
    tenantsLoading || tenantsError !== null
  );

  if (tenantsError) {
    return (
      <div className="max-w-[42rem]" data-ui-bridge-id="overview.team">
        <LoadFailure
          what="the list of projects"
          message={tenantsError}
          uiBridgeId="overview.team.tenants.error"
        />
      </div>
    );
  }

  return (
    <div
      className="max-w-[56rem]"
      data-ui-bridge-id="overview.team"
      aria-busy={data.state === "loading"}
    >
      {data.state === "loading" && (
        <div className="space-y-12">
          <TableSkeleton />
          <TableSkeleton />
        </div>
      )}

      {data.state === "error" && (
        <LoadFailure
          what="this project's estimate"
          message={data.message}
          uiBridgeId="overview.team.error"
        />
      )}

      {data.state === "ready" && (
        <>
          {isCoordAdmin && data.estimate && (
            <div className="mb-8 flex justify-end">
              <Link
                href={EDITOR_ROUTE}
                className="inline-flex min-h-9 items-center rounded-md border border-border px-3.5 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-ui-bridge-id="overview.team.edit-link"
              >
                Edit the estimate
              </Link>
            </div>
          )}
          {data.rollup === null ? (
            <NoEstimate canEdit={isCoordAdmin} />
          ) : (
            <TeamBody
              rollup={data.rollup}
              labourBilling={data.settings.labour_billing}
            />
          )}
        </>
      )}
    </div>
  );
}
