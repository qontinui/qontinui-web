"use client";

/**
 * Project Overview — Summary. What the project is, what it is working
 * towards, how success is measured, who it is for, and how its work is
 * progressing (plan `2026-09-19-project-overview-for-business-leaders`,
 * Phase 1).
 *
 * The prose comes from the project's intent documents; the progress column
 * from its work units. Both are read from doors that already exist, so this
 * page needs no backend of its own.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";
import { IntentSection } from "./_components/IntentSection";
import { ProgressPanel } from "./_components/ProgressPanel";
import { useSummaryData } from "./_hooks/useSummaryData";
import { SUMMARY_INTENT_KINDS } from "./_lib/intent";

function ProseSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  );
}

export default function OverviewSummaryPage() {
  const { isCoordAdmin } = useAuth();
  const { activeTenantId, loading: tenantsLoading } = useTenant();
  const { intent, progress } = useSummaryData(activeTenantId, tenantsLoading);

  return (
    <div
      className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,42rem)_18rem]"
      data-ui-bridge-id="overview.summary"
    >
      <div
        className="min-w-0 space-y-12"
        aria-busy={intent.state === "loading"}
      >
        {intent.state === "loading" && (
          <>
            <ProseSkeleton />
            <ProseSkeleton />
          </>
        )}
        {intent.state === "error" && (
          <LoadFailure
            what="the project's description"
            message={intent.message}
            uiBridgeId="overview.summary.intent.error"
          />
        )}
        {intent.state === "ready" && (
          <>
            {intent.degraded ? (
              // Coord answered but cannot see its document store: an empty
              // list here means "cannot see", so no section may claim that
              // nothing has been written.
              <div
                role="status"
                className="border-l-2 border-border pl-4"
                data-ui-bridge-id="overview.summary.degraded"
              >
                <p className="text-[15px] leading-relaxed text-foreground">
                  The project&rsquo;s description can&rsquo;t be read right now.
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  It may well exist; the service that stores it isn&rsquo;t
                  ready yet. Try again later.
                </p>
              </div>
            ) : (
              SUMMARY_INTENT_KINDS.map((kind) => (
                <IntentSection
                  key={kind}
                  kind={kind}
                  entries={intent.entries.filter((e) => e.kind === kind)}
                  canEdit={isCoordAdmin}
                />
              ))
            )}
          </>
        )}
      </div>

      <aside
        aria-labelledby="overview-progress-heading"
        className="lg:border-l lg:border-border lg:pl-10"
        aria-busy={progress.state === "loading"}
      >
        <h2
          id="overview-progress-heading"
          className="mb-5 font-[family-name:var(--font-overview-serif)] text-[1.625rem] leading-snug text-foreground"
        >
          Progress
        </h2>
        {progress.state === "loading" && (
          <div className="space-y-3" aria-hidden>
            <Skeleton className="h-12 w-28" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {progress.state === "error" && (
          <LoadFailure
            what="the project's progress"
            message={progress.message}
            uiBridgeId="overview.summary.progress.error"
          />
        )}
        {progress.state === "ready" && (
          <ProgressPanel progress={progress.progress} />
        )}
      </aside>
    </div>
  );
}
