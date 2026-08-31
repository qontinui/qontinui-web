"use client";

/**
 * /admin/coord/devops — Dev Ops Overview: how the system is functioning.
 *
 * Plan `2026-08-25-coord-console-intent-and-devops-sections` Phase 1. The
 * operator's requirement was "a dedicated Dev Ops page that a developer can
 * use to adjust the amount of CI a machine is allowed and to view how the
 * system is functioning"; this page is the second half, and Phase 2 mounts
 * the first half (`CiNodeConfigPanel`) onto its machine rows.
 *
 * The page is machine-centric and reads top-to-bottom as one question asked
 * three ways:
 *
 *  1. **Machines** — is it alive, and what is on it? ONE list, joining coord's
 *     `DeviceState` with the runner / session / CI facts. Two lists with two
 *     notions of "healthy" on one page is a correctness defect, not a layout
 *     preference, which is why `HealthSummaryCard` is not mounted here.
 *  2. **Resources** — will it take work? One row per `(device, lane,
 *     lane_instance)`, tone from coord's `headroom` verdict.
 *  3. **CI occupancy** — is it taking work right now?
 *  4. **CI capacity** — how much is it ALLOWED to take? Phase 2 mounts the
 *     shared `CiNodeConfigPanel` as a per-row disclosure on the machine list,
 *     collapsed, rather than as a fourth section: the knob and the telemetry
 *     that says what to set it to belong in one viewport.
 *
 * ## The health strip answers TWO questions, not one
 *
 * The badge cluster carries machine liveness AND coord's unresolved-alert
 * severity rollup, because those are different claims and the page used to
 * make only the first. `by_state: {healthy: 8}` is liveness; it says nothing
 * about alerts, and a steward read it as an all-clear while thousands of
 * unresolved criticals stood (plan
 * `2026-08-31-devops-surface-renders-no-alert-signal`). Coord had been
 * publishing the rollup on this page's own poll the whole time — it was
 * discarded by a hook type that declared only `devices`.
 *
 * This costs NO new read: `alerts` rides the `/fleet/health` body the page
 * already polls, which is R1's "derived from data already on the page".
 *
 * ## What this page does NOT do
 *
 * It does not recalculate a verdict. Pressure and `headroom` arrive
 * server-computed from coord, and the strip colours rows from `headroom`
 * alone — if the dashboard says a machine is red, the dispatcher must already
 * have stopped sending it work, and that is only true while both consumers
 * read one definition of the number AND the verdict.
 *
 * It opens THREE POLLS, each of a DIFFERENT route: `/fleet/health` here,
 * `/fleet/resource-samples` inside `FleetResourcesSection` (which passes the
 * same rows to both the strip and the CI panel), and `/fleet/ci-runners` here
 * at coord's own registrar cadence. Two polls of ONE route is the thing
 * forbidden — that is two chances to disagree about what the fleet looks like
 * right now. The third was added by plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 2 and is not a
 * second view of an existing one: the GitHub fleet's rows are structurally
 * invisible to `/fleet`'s device read, so nothing else on this page can see
 * the labels GitHub routes on. It polls at 60 s because coord's registrar
 * rewrites those rows on that cadence; faster reads the same row twice.
 *
 * The third read is `/devenv/machines`, read ONCE (`useDevenvMachines`) and
 * not polled: it carries the CI-capacity JOIN, and the roster it indexes
 * changes on an operator's enrolment, not on a telemetry cadence. It carries
 * no CI-node configuration — each disclosure's own `CiNodeConfigPanel` reads
 * and writes that through `getCiNodeConfig` / `setCiNodeConfig`, the same two
 * functions `/environments/machines` calls, which is what makes the two mount
 * points one implementation instead of a fork.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { HealthStrip } from "@/components/console";
import type { HealthBadge } from "@/components/console";
import { FleetOverview, FleetResourcesSection } from "@/components/operations";
import { summarizeFleetLiveness } from "@/components/operations/fleetLiveness";
import { useCiRunnerMirror } from "@/components/operations/useCiRunnerMirror";
import { useDevenvMachines } from "@/components/operations/useDevenvMachines";
import { useFleetHealth } from "@/components/operations/useFleetHealth";
import type { FleetHealthDevice } from "@/components/operations/useFleetHealth";

// Stable identity: `?? []` would allocate a fresh array every render, which
// defeats every downstream useMemo keyed on it.
const EMPTY_DEVICES: FleetHealthDevice[] = [];

/**
 * Where a severity badge goes — and deliberately with **no query string**.
 *
 * `/admin/coord/alerts` owns severity as local chip state and reads no
 * `useSearchParams`, so `?severity=critical` would land on an UNFILTERED page
 * showing every severity under a control that claimed to filter. Plain link
 * until that page hydrates its filters from the URL, which is a separate,
 * recorded follow-up — not something to smuggle in behind a badge.
 */
const ALERTS_HREF = "/admin/coord/alerts";

export default function CoordDevOpsPage() {
  const fleet = useFleetHealth();
  const router = useRouter();
  // The CI-capacity join (Phase 2). One read, owned here, passed down —
  // never a fetch per machine row. It carries no CI-node configuration of its
  // own: that is `CiNodeConfigPanel`'s, inside the disclosure.
  const ciMachines = useDevenvMachines();
  // Coord's mirror of the GitHub-side CI runners and the labels GitHub routes
  // on. Owned here, one poll, passed down — the machine rows resolve their own
  // row from it rather than fetching per card.
  const ciRunnerMirror = useCiRunnerMirror();
  const devices = fleet.data?.devices ?? EMPTY_DEVICES;

  // R1: derived from data already on the page, never a second fetch. The
  // derivation itself is pure and unit-tested (`fleetLiveness.ts`).
  const liveness = useMemo(
    () =>
      summarizeFleetLiveness({
        devices,
        loading: fleet.loading,
        error: fleet.error,
      }),
    [devices, fleet.loading, fleet.error]
  );

  // Coord's alert rollup, from the SAME poll — never a second fetch (R1).
  const alertCounts = fleet.data?.alerts;
  const alertsScrapeUp = fleet.data?.alerts_scrape_up;

  /**
   * The severity cluster, and the three-way distinction it exists to make.
   * `by_state` above is device liveness; these are alerts, and until this
   * change the page rendered `machines 8` beside nothing at all while
   * thousands of unresolved criticals stood.
   *
   * 1. `alerts` present, `alerts_scrape_up` anything but `false` → the numbers.
   *    `undefined` is the PRE-DEPLOY coord that serves the rollup and not yet
   *    the flag; that rollup was measured, and dashing it would blank a real
   *    count on every day this page is ahead of coord — which the plan's
   *    deploy order requires it to be.
   * 2. `alerts_scrape_up === false` → coord told us its rollup query did not
   *    run. Its `{0,0,0}` is not a count.
   * 3. `alerts` absent → coord did not serve it, or the read failed here.
   *
   * Cases 2 and 3 render UNKNOWN. **Never `?? 0`** — a zero here is the one
   * sentence this page must not say falsely, and it is the same reasoning as
   * the `unknown` liveness badge below: a signal that has gone dark and a
   * genuine all-clear must not look alike (`[policy: silent-empty-is-unknown]`).
   *
   * One badge for the unknown case, not three dashed ones: the rollup is a
   * single measurement, so all three severities fail together and saying it
   * three times is clutter, not honesty.
   */
  const alertBadges = useMemo<HealthBadge[]>(() => {
    const openAlerts = () => router.push(ALERTS_HREF);
    if (!alertCounts || alertsScrapeUp === false) {
      return [
        {
          key: "alerts-unknown",
          label: "alerts unknown",
          tone: "muted",
          title:
            alertsScrapeUp === false
              ? "Coord could not read the alert rollup on this poll. This is not zero alerts — it is no measurement."
              : "This coord served no alert rollup. This is not zero alerts — it is no measurement.",
          onClick: openAlerts,
          "data-testid": "coord-devops-alerts-unknown-badge",
        },
      ];
    }
    // Tone is R3: colour says who must act. `attention` is the only tone that
    // borrows red, and a count of zero needs nobody — so a measured `critical
    // 0` stays muted rather than painting an all-clear red.
    const toneFor = (count: number, tone: HealthBadge["tone"]) =>
      count > 0 ? tone : ("muted" as const);
    return [
      {
        key: "alerts-critical",
        label: `critical ${alertCounts.critical}`,
        tone: toneFor(alertCounts.critical, "attention"),
        title: "Unresolved critical alerts. Opens the alerts list.",
        onClick: openAlerts,
        "data-testid": "coord-devops-critical-badge",
      },
      {
        key: "alerts-warning",
        label: `warning ${alertCounts.warning}`,
        tone: toneFor(alertCounts.warning, "default"),
        title: "Unresolved warning alerts. Opens the alerts list.",
        onClick: openAlerts,
        "data-testid": "coord-devops-warning-badge",
      },
      {
        key: "alerts-info",
        label: `info ${alertCounts.info}`,
        tone: "muted",
        title: "Unresolved info alerts. Opens the alerts list.",
        onClick: openAlerts,
        "data-testid": "coord-devops-info-badge",
      },
    ];
  }, [alertCounts, alertsScrapeUp, router]);

  return (
    // `overflow-x-auto`: the resource strip is wide, and it must scroll rather
    // than strand its right-hand columns off-screen. Vertical scroll comes
    // from the coord layout's <main overflow-y-auto>.
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-devops-page"
    >
      <HealthStrip
        data-testid="coord-devops-health-strip"
        level={liveness.level}
        headline={liveness.headline}
        detail={liveness.detail}
        badges={[
          {
            key: "machines",
            label: `machines ${liveness.total}`,
            tone: "muted",
            "data-testid": "coord-devops-machines-badge",
          },
          ...(liveness.unreachable > 0
            ? [
                {
                  key: "unreachable",
                  label: `unreachable ${liveness.unreachable}`,
                  tone: "attention" as const,
                  "data-testid": "coord-devops-unreachable-badge",
                },
              ]
            : []),
          ...(liveness.degraded > 0
            ? [
                {
                  key: "degraded",
                  label: `degraded ${liveness.degraded}`,
                  tone: "default" as const,
                  "data-testid": "coord-devops-degraded-badge",
                },
              ]
            : []),
          // Coord's fifth DeviceState, and its own badge rather than a share
          // of `degraded` or `unknown`. `stale` is a machine coord still
          // reaches whose resource SAMPLER has gone quiet — the 2026-08-27
          // shape, where `/fleet/health` said `{healthy: 4}` beside a sample
          // 22 minutes old. Deliberately not `attention`: the axis it names is
          // a publisher, not an unreachable machine, and borrowing red would
          // make it indistinguishable from `partitioned` at a glance.
          ...(liveness.stale > 0
            ? [
                {
                  key: "stale",
                  label: `stale ${liveness.stale}`,
                  tone: "default" as const,
                  "data-testid": "coord-devops-stale-badge",
                },
              ]
            : []),
          // Rendered even though it is not red, for the same reason the
          // pipeline page's collapsed header carries it: a fleet whose
          // telemetry has gone dark would otherwise render as "machines N"
          // and nothing else, which is indistinguishable from an all-clear.
          ...(liveness.unknown > 0
            ? [
                {
                  key: "unknown",
                  label: `unknown ${liveness.unknown}`,
                  tone: "muted" as const,
                  "data-testid": "coord-devops-unknown-badge",
                },
              ]
            : []),
          // Alerts last, after the liveness cluster: the four above answer
          // "are the machines there?", these answer "is anything wrong?", and
          // the second question is the one this page could not previously ask.
          ...alertBadges,
        ]}
      />

      {/* The pageout sink, when coord says it is not configured. ONE muted
          line, deliberately: this is a recorded operator decision (confirmed
          2026-08-05 — in-app is the delivery surface, no Slack/email sink is
          wanted), not an incident. A warning banner on an intended state is
          how a strip earns the operator's habit of not reading it. It exists
          only so the next steward does not re-file "alerts reach nobody" as a
          defect, which is exactly what happened. Absent field renders
          nothing — we do not know the posture, so we claim nothing. */}
      {fleet.data?.pageout?.sink_configured === false && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-devops-pageout-note"
        >
          Alert pages are in-app only — no external sink is configured (by
          decision). Everything above is delivered under{" "}
          <Link
            href={ALERTS_HREF}
            className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
            data-testid="coord-devops-pageout-alerts-link"
          >
            Alerts
          </Link>
          .
        </p>
      )}

      {/* The join this page is keyed on, stated once, before the list it
          shapes. Rows here come from coord's device registry, and the bridge
          to a machine record is `Machine.coord_device_id` — a soft, nullable
          pointer. So a machine with no such link is not on this page at all,
          and saying so is the difference between a reader knowing where it is
          and a reader concluding it does not exist. */}
      <p
        className="text-xs text-muted-foreground"
        data-testid="coord-devops-join-note"
      >
        Every row below is a machine coord has a device record for. A machine
        enrolled under Environments that carries no coord device link does not
        appear here at all — it is reachable, and its CI configurable, only
        under{" "}
        <Link
          href="/environments/machines"
          className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2 hover:no-underline"
          data-testid="coord-devops-machines-link"
        >
          Environments → Machines
          <ExternalLink className="h-3 w-3" />
        </Link>
        . This list is not a count of your machines.
      </p>

      {/* 1. Machines — coord's device liveness merged INTO the machine list,
          not beside it. `health` is what makes this the one list on the page:
          a coord device with no runner inventory gets a row whose runner-side
          facts read `unknown`, rather than vanishing or rendering as zero.
          4. CI capacity rides on each row as a collapsed disclosure, resolved
          from `ciMachines` — one read, no per-row fetch. */}
      <FleetOverview
        health={fleet}
        ciMachines={ciMachines}
        ciRunnerMirror={ciRunnerMirror}
      />

      {/* 2. Resources and 3. CI occupancy, over the section's own single
          poll of /fleet/resource-samples. `devices` is the spine: a machine
          that publishes no sample still gets a row, as `unknown`. */}
      <FleetResourcesSection devices={devices} />
    </div>
  );
}
