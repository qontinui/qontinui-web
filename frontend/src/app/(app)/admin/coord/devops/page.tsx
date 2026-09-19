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
 * ## The page answers THREE questions, not one
 *
 * The health strip carries machine liveness AND whether the machines can
 * still reach coord; the Conditions panel under it carries whether anything is
 * degraded that no agent is handling. Those are different claims and the page
 * used to make only the first. `by_state: {healthy: 8}` is liveness; it says
 * nothing about faults, and a steward read it as an all-clear while thousands
 * of unresolved criticals stood (plan
 * `2026-08-31-devops-surface-renders-no-alert-signal`).
 *
 * That plan answered with critical/warning/info alert-severity badges linking
 * to the raw alerts page. Plan
 * `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
 * Phase 8 replaced both: the raw alert list is agents' work, and 27,604 open
 * rows sorted by severity told the operator nothing about whether anyone was
 * on them. The Conditions panel (`FleetConditionsPanel`, derived by
 * `fleetConditions.ts`) reads coord's `conditions` block instead — unclaimed
 * conditions, the oldest one's age, the per-owner breakdown, the questions
 * waiting on the operator, and the deliberate settings in effect.
 *
 * The credential question is the same shape as the fault question, and was
 * found the same way (plan
 * `2026-09-12-runner-loads-with-an-expired-coord-credential-and-tells-nobody`
 * Phase 5). Liveness is coord reaching the machine; a runner that boots with
 * an expired coord device JWT answers every probe and reads `healthy` here
 * while every session it spawns silently has no coord access. Coord joins that
 * fact onto each device row as `credential_dark` and raises a critical alert
 * per dark device — and this page discarded the field and rendered the alert
 * only as a count with no machine attached.
 *
 * This costs NO new read: `conditions` and `credential_dark` both ride the
 * `/fleet/health` body the page already polls, which is R1's "derived from
 * data already on the page".
 *
 * ## What this page does NOT do
 *
 * It does not recalculate a verdict. Pressure and `headroom` arrive
 * server-computed from coord, and the strip colours rows from `headroom`
 * alone — if the dashboard says a machine is red, the dispatcher must already
 * have stopped sending it work, and that is only true while both consumers
 * read one definition of the number AND the verdict.
 *
 * It opens THREE POLLS: `/fleet/health` here at 10 s,
 * `/fleet/resource-samples` inside `FleetResourcesSection`, which passes the
 * same rows to both the strip and the CI panel, and `/fleet/drain` here at
 * 30 s. Two polls of ONE route would be two chances to disagree about what the
 * fleet looks like right now; three polls of three routes is one read per
 * fact, which is the shape this page is built on.
 *
 * The drain poll is the newest (plan
 * `2026-09-01-device-drain-does-not-reach-agent-session-spawning` Phase 4b)
 * and is the one read here that is NOT a telemetry cadence — a drain changes
 * on an operator action. It polls anyway, and slowly, because a drain also
 * **expires by itself**: coord evaluates `until` on read and runs no sweeper,
 * so a machine re-enters the fleet with nothing writing anything anywhere. A
 * once-only read would leave "Drained until 14:03" on screen at 15:00, which
 * is a false claim rather than a stale one.
 *
 * The fourth read is `/devenv/machines`, read ONCE (`useDevenvMachines`) and
 * not polled: it carries the CI-capacity JOIN, and the roster it indexes
 * changes on an operator's enrolment, not on a telemetry cadence. It carries
 * no CI-node configuration — each disclosure's own `CiNodeConfigPanel` reads
 * and writes that through `getCiNodeConfig` / `setCiNodeConfig`, the same two
 * functions `/environments/machines` calls, which is what makes the two mount
 * points one implementation instead of a fork.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { HealthStrip } from "@/components/console";
import type { HealthBadge } from "@/components/console";
import {
  FleetConditionsPanel,
  FleetOverview,
  FleetResourcesSection,
} from "@/components/operations";
import { QUESTION_QUEUE_HREF } from "@/components/operations/fleetConditions";
import { summarizeCoordCredentials } from "@/components/operations/coordCredentialStatus";
import { summarizeFleetLiveness } from "@/components/operations/fleetLiveness";
import { useDeviceStatusStream } from "@/components/operations/useDeviceStatusStream";
import { useDevenvMachines } from "@/components/operations/useDevenvMachines";
import { useFleetDrain } from "@/components/operations/useFleetDrain";
import { useFleetHealth } from "@/components/operations/useFleetHealth";
import type { FleetHealthDevice } from "@/components/operations/useFleetHealth";

// Stable identity: `?? []` would allocate a fresh array every render, which
// defeats every downstream useMemo keyed on it.
const EMPTY_DEVICES: FleetHealthDevice[] = [];

export default function CoordDevOpsPage() {
  const fleet = useFleetHealth();
  const router = useRouter();
  const navigate = useCallback((href: string) => router.push(href), [router]);
  // The CI-capacity join (Phase 2). One read, owned here, passed down —
  // never a fetch per machine row. It carries no CI-node configuration of its
  // own: that is `CiNodeConfigPanel`'s, inside the disclosure.
  const ciMachines = useDevenvMachines();
  // Which machines coord is holding out of the fleet. Owned here for the same
  // reason the two reads above are: one read for the whole list, so no two
  // rows can disagree about what is drained. Its `refresh` is handed down so a
  // drain or undrain is visible immediately rather than on the next tick.
  const drain = useFleetDrain();
  // The live device-status stream. The hook opens a REST seed and a WebSocket
  // PER CALL, so it is subscribed exactly once, here, and shared: the machine
  // list and its tile read it through `FleetOverview`, and the strip's
  // credential rollup below reads the same `details` bag the rows do.
  const deviceStatus = useDeviceStatusStream();
  const devices = fleet.data?.devices ?? EMPTY_DEVICES;
  // The page's clock, advanced independently of every read. A runner's
  // `coord_credential` report goes stale by TIME alone
  // (`resolveCoordCredential`), and the runner that stopped reporting is
  // exactly the one that sends no frame to re-render anything — so without
  // this tick a quiet stream, or a fleet-health outage that pins `devices`,
  // would keep counting that machine `ok` on the strip and `live` on its row.
  // 15 s is well under the 900 s staleness bound, so the transition can't be
  // missed. Same tick `FleetResourceStrip` keeps for its row ages.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

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

  /**
   * **The second question the strip answers: can the machines still reach
   * COORD?** Plan
   * `2026-09-12-runner-loads-with-an-expired-coord-credential-and-tells-nobody`
   * Phase 5.
   *
   * `by_state` is coord reaching the machine, `conditions` is anything wrong
   * anywhere; neither can see a runner that booted with an expired device JWT
   * and kept working. That machine answers every probe, so it reads `healthy`
   * here while every session it spawns has no coord access and does not know
   * it. The only thing that made it visible was a critical alert whose COUNT
   * was on this page and whose MACHINE was not.
   *
   * Derived from data already on the page (R1, never a second fetch or
   * subscription). Both badges are conditional, and the two are deliberately
   * separate counts:
   *
   * * `credential dark N` — measured, and someone must go and fix those
   *   machines. The only badge here that borrows red besides `unreachable`.
   * * `credential unknown N` — nothing measured them. **Never folded into the
   *   healthy side and never rendered as `0`**, which is the same rule the
   *   Conditions panel's unknown states follow and the rule this whole plan is
   *   about (`[policy: silent-empty-is-unknown]`).
   *
   * **The strip and the machine rows resolve each device from the same two
   * sources, so they agree for every device they both key the same way.**
   * A device reads a stream report only when the row's `device_id` is its
   * own, so two coord devices sharing a hostname never borrow each other's
   * report; the one gap left is that they are counted twice here but share
   * one machine row. Coord's fleet-health join alone can conclude
   * `dark` and nothing else: its `dark: false` is a roster stamp for "the
   * scan did not name this device", which pools the healthy with the
   * never-reported. The affirmative half comes from the runner's own
   * `coord_credential` bag on the device-status stream — the one subscription
   * above, which `FleetOverview` also receives — joined per device exactly as
   * each row joins it (`coordDeviceHostKey` + `reportedCoordCredentialFor`,
   * which is what a row matched to a coord device uses). So a
   * machine whose runner reported `ok: true` is counted measured here and
   * reads `live` on its row, and `credential unknown N` counts only the
   * machines nothing measured. Counting those as healthy is what an earlier
   * cut of `coordCredentialStatus` did, and it put a calm `credential live`
   * badge on precisely the machines the plan was written about.
   */
  const credentials = useMemo(
    () =>
      summarizeCoordCredentials(
        devices,
        deviceStatus.byHostname,
        fleet.data?.credential_dark_scrape_up,
        nowMs
      ),
    [
      devices,
      deviceStatus.byHostname,
      fleet.data?.credential_dark_scrape_up,
      nowMs,
    ]
  );

  const credentialBadges = useMemo<HealthBadge[]>(() => {
    const badges: HealthBadge[] = [];
    if (credentials.needsAction > 0) {
      badges.push({
        key: "credential-dark",
        label: `credential dark ${credentials.needsAction}`,
        tone: "attention",
        title:
          "Machines whose coord credential needs a person: coord's dark scan named them, or their own runner reported a dark posture (dark, expired, absent, unrefreshable). Sessions spawned on them work without coord and do not know it. Opens the question queue. Coord raises a question there for each machine its scan names once it has processed the alert — if none is there yet, the machine still needs you; the question has not been raised.",
        // A dark credential is a `Responder::Operator` condition: coord turns
        // it into a question waiting on the operator (plan
        // `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
        // Phase 5), so the badge leads to the queue that question will be in.
        // The title does not PROMISE the question: a runner-reported dark
        // posture coord's scan has not named raises no alert, and the Phase 5
        // hook may not have run (or be deployed) yet.
        onClick: () => navigate(QUESTION_QUEUE_HREF),
        "data-testid": "coord-devops-credential-dark-badge",
      });
    }
    if (credentials.unknown > 0) {
      // WHY nothing measured them, worded per cause. A failed read on either
      // side is not the machines' silence, and the tooltip must not blame the
      // runners for a read this page could not make. The count stands in every
      // case: those machines really are unmeasured on this read.
      //
      // The stream has two failure shapes and they are different claims:
      // no FULL fleet read has succeeded yet (rows may still have arrived one
      // device at a time by frame, so they may be incomplete), and a full read
      // succeeded earlier but the latest one failed (rows are being served,
      // possibly stale). A single failed re-seed behind a working socket must
      // read as "may be stale", never as "nothing was read".
      const causes: string[] = [];
      if (credentials.scrapeUp === false) {
        causes.push(
          "Coord could not read the per-device credential join on this poll. This is not 'their credentials are fine' — it is no measurement."
        );
      }
      if (!deviceStatus.everSeeded) {
        causes.push(
          `No full device-status read has succeeded yet (${deviceStatus.error ?? "not loaded yet"}); runner reports that arrived since may be incomplete, so machines coord did not name dark are UNKNOWN — not healthy.`
        );
      } else if (deviceStatus.error !== null) {
        causes.push(
          `The last device-status read failed (${deviceStatus.error}); runner reports may be stale, so a machine counted here may have reported since.`
        );
      }
      badges.push({
        key: "credential-unknown",
        label: `credential unknown ${credentials.unknown}`,
        tone: "muted",
        title:
          causes.length > 0
            ? causes.join(" ")
            : "Neither coord's dark scan nor the machine's own runner reported a credential verdict for these machines. UNKNOWN, not healthy — go look at the machine.",
        "data-testid": "coord-devops-credential-unknown-badge",
      });
    }
    return badges;
  }, [credentials, deviceStatus.error, deviceStatus.everSeeded, navigate]);

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
          // Credentials last: "are the machines there?" is answered above,
          // and this answers "can the ones that ARE there still reach coord?"
          // — an independent axis, because the incident it exists for is a
          // machine that answered every probe with a dead coord credential.
          ...credentialBadges,
        ]}
      />

      {/* "Is anything wrong that no agent is handling, and is anything
          waiting on me?" — the operator's rollup of the conditions agents
          own. It replaced the alert-severity badges, both links into the
          deleted alerts page, and the pageout-sink note (plan
          `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
          Phase 8). Fed by the same fleet-health read as the strip above. */}
      <FleetConditionsPanel
        health={fleet}
        nowMs={nowMs}
        onNavigate={navigate}
      />

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
          from `ciMachines` — one read, no per-row fetch. Each row also carries
          its drain state and the Drain/Undrain lever, resolved from `drain` —
          the one read, again, never one per card. `deviceStatus` is the page's
          one device-status subscription, shared with the strip above. */}
      <FleetOverview
        health={fleet}
        ciMachines={ciMachines}
        drain={drain}
        deviceStatus={deviceStatus}
        nowMs={nowMs}
      />

      {/* 2. Resources and 3. CI occupancy, over the section's own single
          poll of /fleet/resource-samples. `devices` is the spine: a machine
          that publishes no sample still gets a row, as `unknown`. */}
      <FleetResourcesSection devices={devices} />
    </div>
  );
}
