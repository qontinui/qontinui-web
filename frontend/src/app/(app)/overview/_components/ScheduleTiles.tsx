"use client";

/**
 * "Schedule" — the Summary's three schedule tiles: the current phase, the next
 * gate, and the forecast finish against the planned one.
 *
 * Every figure is the server's forecast (`GET /estimates/{id}/forecast`) for
 * the project's estimate (the baseline, else the newest — `pickBaseline`, the
 * rule the Timeline uses), worded by the same helpers as the Timeline header,
 * so the two pages cannot tell one forecast two ways. A slip is WORDED ("3
 * weeks late", "On plan"), never a signed number; a figure the server could
 * not produce reads "Not known" with the reason it served.
 *
 * Loading, failure and "no estimate yet" are kept apart; none renders as a
 * blank tile.
 */

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { UnavailableNotes } from "@/components/overview/UnavailableNotes";
import type { ListState } from "@/components/overview/editing/useResource";
import { pickBaseline, type EstimateRecord } from "../_lib/estimate-api";
import type { TimelineForecast } from "../_lib/timeline-api";
import {
  SLIP_TONE_CLASS,
  describeNextGate,
  describePosition,
  describeSlip,
  formatDay,
} from "../_lib/timeline";
import type { ForecastState } from "../_hooks/useForecast";

const ID = "overview.summary.schedule";

/** The figure the forecast's own `unavailable` entries are filed under. */
const FORECAST_FIGURE = "forecast";

function Tile({
  label,
  value,
  detail,
  uiBridgeId,
  children,
}: {
  label: string;
  /** `null` renders as an explicit "Not known", never as a blank. */
  value: string | null;
  detail?: string | null;
  uiBridgeId: string;
  children?: React.ReactNode;
}) {
  return (
    <div data-ui-bridge-id={uiBridgeId}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[15px] leading-snug text-foreground">
        {value ?? <span className="text-muted-foreground">Not known</span>}
      </dd>
      {children}
      {detail && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {detail}
        </p>
      )}
    </div>
  );
}

function Tiles({ forecast }: { forecast: TimelineForecast }) {
  const now = describePosition(forecast);
  const gate = describeNextGate(forecast);
  const slip = describeSlip(forecast.slip_days);
  const finish = formatDay(forecast.forecast_finish);
  const planned = formatDay(forecast.planned_finish);
  // The reasons the server gave for an unknown finish sit on the tile itself;
  // anything else it could not produce is listed below the tiles.
  const finishReasons = forecast.unavailable.filter(
    (u) => u.figure === FORECAST_FIGURE
  );
  const otherReasons = forecast.unavailable.filter(
    (u) => u.figure !== FORECAST_FIGURE
  );
  const finishDetail =
    finish === null
      ? finishReasons.length > 0
        ? finishReasons.map((u) => u.detail).join(" ")
        : "The forecast gave no reason."
      : planned
        ? `Planned for ${planned}.`
        : null;

  return (
    <>
      <dl className="space-y-5">
        <Tile
          label="Current phase"
          value={now.value}
          detail={now.detail}
          uiBridgeId={`${ID}.current-phase`}
        />
        <Tile
          label="Next gate"
          value={gate.value}
          detail={gate.detail}
          uiBridgeId={`${ID}.next-gate`}
        />
        <Tile
          label="Forecast finish"
          value={finish}
          detail={finishDetail}
          uiBridgeId={`${ID}.forecast`}
        >
          {slip && (
            <span
              className={`mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${SLIP_TONE_CLASS[slip.tone]}`}
              data-ui-bridge-id={`${ID}.slip`}
              data-tone={slip.tone}
            >
              {slip.text}
            </span>
          )}
        </Tile>
      </dl>
      {otherReasons.length > 0 && (
        <div className="mt-5">
          <UnavailableNotes
            items={otherReasons}
            uiBridgeId={`${ID}.unavailable`}
            heading="What the forecast can’t say yet"
          />
        </div>
      )}
    </>
  );
}

export function ScheduleTiles({
  estimates,
  forecast,
}: {
  /** The project's estimates, as listed. */
  estimates: ListState<EstimateRecord>;
  /** The forecast for `pickBaseline(estimates)`. */
  forecast: ForecastState;
}) {
  if (estimates.state === "error") {
    return (
      <LoadFailure
        what="the project's estimate"
        message={estimates.message}
        uiBridgeId={`${ID}.error`}
        announce={false}
      />
    );
  }
  if (estimates.state === "ready" && pickBaseline(estimates.items) === null) {
    return (
      <p
        className="text-sm leading-relaxed text-muted-foreground"
        data-ui-bridge-id={`${ID}.no-estimate`}
      >
        There is no estimate yet, so there is no schedule to report. Once one is
        set up on the{" "}
        <Link
          href="/overview/team"
          className="text-primary underline-offset-4 hover:underline"
        >
          Team page
        </Link>
        , its current phase, next gate and forecast finish show here.
      </p>
    );
  }
  if (estimates.state === "loading" || forecast.state === "loading") {
    return (
      <div
        className="space-y-3"
        aria-hidden
        data-ui-bridge-id={`${ID}.loading`}
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (forecast.state === "error") {
    return (
      <LoadFailure
        what="the forecast"
        message={forecast.message}
        uiBridgeId={`${ID}.error`}
        announce={false}
      />
    );
  }
  return (
    <div data-ui-bridge-id={`${ID}.tiles`}>
      <Tiles forecast={forecast.forecast} />
    </div>
  );
}
