"use client";

/**
 * The CI half of "Still running": every GitHub registration of the machine's
 * host(s), and coord's own CI-node lane.
 *
 * Plan `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place` §D6.
 * With a window open the rows come from the window's readiness, which is the
 * only source that knows whether an idle reading was taken AFTER the pause —
 * a registration that read idle on a poll before its label came off proves
 * nothing, because a job could have been assigned in between. With no window
 * the rows come from coord's CI-runner mirror, labelled as such: nothing is
 * paused, so every idle row may take a job at any moment.
 *
 * **No job names and no run links, deliberately.** The registrar has only
 * GitHub's `(status, busy)` per registration and no coord source knows the
 * in-flight job (§D6); a "job" column would be invented.
 */

import {
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
  RowTime,
  StatusBadge,
} from "@/components/console";
import type { CiRunnerMirrorRead } from "@/components/operations/ciRunnerMirror";
import {
  CI_REGISTRATION_PALETTE,
  deriveRegistrationStatus,
  seenAfterPauseLabel,
} from "@/components/operations/maintenanceStatus";
import {
  registrationsFromMirror,
  type CiRegistration,
  type MachineEntry,
  type WindowReadinessRead,
} from "@/components/operations/maintenanceWindow";
import { UNKNOWN_LABEL } from "@/components/operations/runnerStatus";

type RegistrationsView =
  | {
      kind: "ok";
      rows: CiRegistration[];
      missingRepos: string[];
      paused: boolean;
      source: "readiness" | "mirror";
      dispatches: number | null;
      dispatchDetail: string | null;
    }
  | { kind: "unknown"; reason: string };

function view(
  entry: MachineEntry,
  readiness: WindowReadinessRead,
  mirror: CiRunnerMirrorRead
): RegistrationsView {
  const hosts = entry.kind === "machine" ? entry.ciHosts : [entry.ciHost];
  if (entry.openWindow !== null) {
    if (readiness.state === "ok") {
      const r = readiness.readiness;
      return {
        kind: "ok",
        rows: r.githubCi.registrations,
        missingRepos: r.githubCi.missingRepos,
        paused: r.leversHeld.ci,
        source: "readiness",
        dispatches: r.ciNode.activeDispatches,
        dispatchDetail: r.ciNode.detail,
      };
    }
    return {
      kind: "unknown",
      reason:
        readiness.state === "unknown"
          ? readiness.reason
          : "reading the window's readiness…",
    };
  }
  if (mirror.state === "ok") {
    return {
      kind: "ok",
      rows: registrationsFromMirror(mirror.byHostname.values(), hosts),
      missingRepos: [],
      paused: false,
      source: "mirror",
      dispatches: null,
      dispatchDetail:
        "coord counts CI-node dispatches per maintenance window; none is open",
    };
  }
  return {
    kind: "unknown",
    reason:
      mirror.state === "loading"
        ? "reading coord's CI-runner mirror…"
        : `coord's CI-runner mirror could not be read — ${mirror.reason}`,
  };
}

function RegistrationRow({
  r,
  paused,
  expanded,
  onToggle,
}: {
  r: CiRegistration;
  paused: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = deriveRegistrationStatus(r, paused);
  return (
    <RecordRow
      data-testid="coord-maintenance-ci-registration"
      identity={r.runnerName}
      label={<span title={r.repo}>{r.repo}</span>}
      status={<StatusBadge status={status} palette={CI_REGISTRATION_PALETTE} />}
      reason={`seen after pause: ${seenAfterPauseLabel(r, paused)}`}
      attention={status.attention}
      time={
        <RowTime
          at={r.lastSeenAt}
          verb="Seen"
          absent={{
            label: "never seen",
            title: "coord's registrar has no sighting of this registration",
          }}
        />
      }
      expanded={expanded}
      onToggle={onToggle}
    >
      <RecordDetail
        data-testid="coord-maintenance-ci-registration-detail"
        why={
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Repo</dt>
            <dd className="font-mono break-all">{r.repo}</dd>
            <dt className="text-muted-foreground">Runner</dt>
            <dd className="font-mono break-all">{r.runnerName}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              {status.label} — {status.reason}
            </dd>
            <dt className="text-muted-foreground">Seen after pause</dt>
            <dd>{seenAfterPauseLabel(r, paused)}</dd>
            <dt className="text-muted-foreground">Last seen</dt>
            <dd className="font-mono break-all">{r.lastSeenAt ?? "never"}</dd>
          </dl>
        }
      />
    </RecordRow>
  );
}

export function StillRunningCi({
  entry,
  readiness,
  mirror,
}: {
  entry: MachineEntry;
  readiness: WindowReadinessRead;
  mirror: CiRunnerMirrorRead;
}) {
  const v = view(entry, readiness, mirror);
  const noHost = entry.kind === "machine" && entry.ciHosts.length === 0;
  return (
    <section className="space-y-2" data-testid="coord-maintenance-ci-running">
      <h3 className="text-sm font-semibold">CI</h3>
      {v.kind === "unknown" ? (
        <HealthStrip
          level="amber"
          headline={`CI registrations ${UNKNOWN_LABEL}`}
          detail={`${v.reason} — this is not "no CI jobs"`}
          data-testid="coord-maintenance-ci-unknown"
        />
      ) : (
        <>
          <p
            className="text-xs text-muted-foreground break-words"
            data-testid="coord-maintenance-ci-node"
          >
            Coord CI-node dispatches (queued / dispatched / running):{" "}
            <span className="font-mono">
              {v.dispatches === null ? UNKNOWN_LABEL : v.dispatches}
            </span>
            {v.dispatchDetail ? ` — ${v.dispatchDetail}` : ""}
          </p>
          {v.source === "mirror" && (
            <p className="text-xs text-muted-foreground">
              From coord&apos;s registrar mirror. CI is not paused, so an idle
              registration may take a job at any moment.
            </p>
          )}
          {v.missingRepos.length > 0 && (
            <p
              role="status"
              className="text-xs text-amber-600 dark:text-amber-400 break-words"
              data-testid="coord-maintenance-ci-missing-repos"
            >
              {UNKNOWN_LABEL}: coord&apos;s registrar has no fresh row for{" "}
              <span className="font-mono break-all">
                {v.missingRepos.join(", ")}
              </span>{" "}
              — a label came off there, and whether a job is running is not
              known.
            </p>
          )}
          {noHost ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="coord-maintenance-ci-no-host"
            >
              No CI host linked — link one to see this machine&apos;s GitHub
              registrations.
            </p>
          ) : (
            <RecordList
              items={v.rows}
              loaded
              itemKey={(r) => `${r.runnerName}@${r.repo}`}
              renderRow={(r, ctx) => (
                <RegistrationRow
                  r={r}
                  paused={v.paused}
                  expanded={ctx.expanded}
                  onToggle={ctx.onToggle}
                />
              )}
              empty={
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="coord-maintenance-ci-empty"
                >
                  Coord&apos;s registrar lists no registration of this host
                  inside its freshness window.
                </p>
              }
            />
          )}
        </>
      )}
    </section>
  );
}
