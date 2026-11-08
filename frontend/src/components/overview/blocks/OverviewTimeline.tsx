"use client";

/**
 * `overview-timeline` — the built Timeline chart, read-only and compact (plan
 * `2026-09-19-project-overview-for-business-leaders` Phase 9: "the built
 * Timeline section"; plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3).
 *
 * The Timeline's own reads (`useTimelineData`) and its own chart
 * (`TimelineChart`), over the whole project: no zoom, no view switch, no gate
 * panel, no export, and each gate drawn as a mark rather than a control.
 * Loading, failure, "no schedule yet" and "nothing to draw" each say so.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { describeFailure } from "@/components/overview/LoadFailure";
import { Provenance } from "@/components/presentation/Provenance";
import { useOverviewProject } from "@/app/(app)/overview/_hooks/useOverviewProject";
import { useTimelineData } from "@/app/(app)/overview/_hooks/useTimelineData";
import { TimelineChart } from "@/app/(app)/overview/timeline/_components/TimelineChart";
import type { DataBlockProps, OverviewTimelineArgs } from "./blockArgs";
import { BlockFrame, BlockNotice } from "./blockChrome";

const ID = "overview.block.timeline";
const SOURCE = "the project's estimate and its recorded progress";

function Loading() {
  return (
    <div className="space-y-2" aria-hidden data-ui-bridge-id={`${ID}.loading`}>
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function Failed({ what, message }: { what: string; message: string }) {
  return (
    <BlockNotice
      tone="problem"
      title={`${what} can't be read right now.`}
      detail={describeFailure(message)}
      uiBridgeId={`${ID}.error`}
    />
  );
}

function Body() {
  const { projectId, hold, tenantsError } = useOverviewProject();
  const t = useTimelineData(projectId, hold);
  if (tenantsError)
    return <Failed what="The Timeline" message={tenantsError} />;
  if (t.estimates.list.state === "loading") return <Loading />;
  if (t.estimates.list.state === "error") {
    return <Failed what="The Timeline" message={t.estimates.list.message} />;
  }
  if (!t.estimate) {
    return (
      <BlockNotice
        title="This project has no schedule yet"
        detail="The Timeline draws the phases of the project's estimate, and no estimate has been entered."
        uiBridgeId={`${ID}.no-estimate`}
      />
    );
  }
  if (t.progress.list.state === "loading") return <Loading />;
  if (t.progress.list.state === "error") {
    return <Failed what="The phases" message={t.progress.list.message} />;
  }
  if (t.phases.length === 0 || t.projectSpan === null) {
    return (
      <BlockNotice
        title="There is nothing to draw yet"
        detail={
          t.phases.length === 0
            ? "The estimate has no phases yet."
            : "None of the phases has a date yet."
        }
        uiBridgeId={`${ID}.empty`}
      />
    );
  }
  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        The schedule of{" "}
        <span className="text-foreground">{t.estimate.name}</span>, against what
        has actually happened.
      </p>
      <div className="overflow-x-auto">
        <div className="min-w-[40rem]">
          <TimelineChart
            phases={t.phases}
            milestones={t.milestoneItems}
            breaks={t.breaks}
            window={t.projectSpan}
            today={t.today}
            uiBridgeId={`${ID}.chart`}
          />
        </div>
      </div>
      {t.forecast.state === "error" && (
        <p className="mt-2 text-xs text-muted-foreground">
          The forecast can&rsquo;t be read right now, so what is still to come
          is not drawn.
        </p>
      )}
      <div className="mt-2">
        <Provenance
          persistent
          source={SOURCE}
          asOf={t.forecast.state === "ready" ? t.forecast.forecast.today : null}
        />
      </div>
    </>
  );
}

export function OverviewTimeline(_props: DataBlockProps<OverviewTimelineArgs>) {
  return (
    <BlockFrame name="overview-timeline" uiBridgeId={ID} label="Timeline">
      <Body />
    </BlockFrame>
  );
}
