"use client";

/**
 * /admin/coord/computers/[computerId] — one computer's whole answer to "how is
 * this machine": capacity vs usage per lane with a pressure sparkline over the
 * sample history, watched services with their state and restart/OOM policy,
 * the event timeline, the workloads on it, and where its own report disagrees
 * with the CI registrar.
 *
 * Plan `2026-09-30-the-fleet-machine-is-not-a-first-class-coord-entity-and-coord-
 * has-no-resource-model` Phase 5, over coord's `GET /coord/computers/:id` (plan
 * §3.5.4: one read answers "how is this machine"). One poll (`useComputer`),
 * and the strip derives from it.
 *
 * A detail ROUTE rather than only an expanded row (style guide R5) because it
 * is a workspace: five independent lists, each with its own per-record detail.
 *
 * Every rule from the list page holds here, and one more: **a stale computer's
 * service states render as `last known: …` under the ignorance floor**, so a
 * five-hour-old `active` is not a green service and a five-hour-old `failed`
 * is not a failure happening now.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  RowTime,
  StatusBadge,
  absoluteTime,
  relativeTime,
  rowAccentClass,
} from "@/components/console";
import { formatBytes } from "@/components/operations/fleetResources";
import {
  DIVERGENCE_KIND_LABEL,
  SERVICE_KIND_LABEL,
  ciRunnerStatusText,
  SERVICE_PALETTE,
  computerFreshness,
  computerHref,
  computerStatus,
  deriveComputerDetailHealth,
  eventLabel,
  eventSubject,
  historyByLane,
  listOrNull,
  normalizeComputer,
  orderEvents,
  serviceStatus,
  type CiRunnerWire,
  type ComputerDeviceWire,
  type ComputerEventWire,
  type ComputerServiceWire,
  type DivergenceWire,
} from "../_lib/computerStatus";
import { COMPUTERS_POLL_MS, useComputer } from "../_lib/useComputers";
import {
  CapacityStats,
  FreshnessBadge,
  LaneTable,
  ReadIssueBanner,
} from "../_components/ComputerParts";

/** A byte count or a word; `null` is `unknown`, never `0 B`. */
function bytesOrUnknown(v: number | null | undefined): string {
  return v == null ? "unknown" : formatBytes(v);
}

function Section({
  title,
  testId,
  note,
  children,
}: {
  title: string;
  testId: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="space-y-2"
      data-testid={testId}
      data-ui-bridge-id={testId}
    >
      <h2 className="text-sm font-medium">{title}</h2>
      {note && <p className="text-xs text-muted-foreground m-0">{note}</p>}
      {children}
    </section>
  );
}

/** The sentence for a list the read did not carry. */
function Unstated({ what, testId }: { what: string; testId: string }) {
  return (
    <p className="text-sm text-muted-foreground italic" data-testid={testId}>
      Coord sent no {what} for this computer — unknown, not none.
    </p>
  );
}

function ServiceRow({
  service,
  computerFresh,
  expanded,
  onToggle,
}: {
  service: ComputerServiceWire;
  computerFresh: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = serviceStatus(service, computerFresh);
  const kindWord = service.kind
    ? (SERVICE_KIND_LABEL[service.kind] ?? service.kind)
    : "unknown kind";
  return (
    <RecordRow
      data-testid="coord-computer-service-row"
      rowKey={service.unit}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={
        <span
          className="font-mono text-[11px]"
          title={service.kind ?? "kind not reported"}
        >
          {kindWord}
        </span>
      }
      label={
        <span className="font-mono text-xs" title={service.unit}>
          {service.unit}
        </span>
      }
      status={
        <span
          data-testid="coord-computer-service-status"
          data-status={status.kind}
        >
          <StatusBadge status={status} palette={SERVICE_PALETTE} />
        </span>
      }
      reason={status.reason}
      reasonTestId="coord-computer-service-reason"
      time={
        <RowTime
          at={service.state_changed_at}
          verb="State changed"
          absent={{
            label: "change time unknown",
            title: "The unit's state-change time was not reported.",
          }}
        />
      }
    >
      <RecordDetail
        data-testid="coord-computer-service-detail"
        why={
          <p className="text-[13px] text-foreground/85 m-0">{status.reason}</p>
        }
        problems={
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs m-0">
            <dt className="text-muted-foreground">result</dt>
            <dd className="m-0" data-testid="coord-computer-service-result">
              {service.result ?? "unknown"}
            </dd>
            <dt className="text-muted-foreground">restart policy</dt>
            <dd className="m-0" data-testid="coord-computer-service-restart">
              {service.restart_policy ?? "unknown"}
            </dd>
            <dt className="text-muted-foreground">OOM policy</dt>
            <dd className="m-0" data-testid="coord-computer-service-oom">
              {service.oom_policy ?? "unknown"}
            </dd>
            <dt className="text-muted-foreground">memory peak / max</dt>
            <dd className="m-0" data-testid="coord-computer-service-memory">
              {bytesOrUnknown(service.memory_peak)} /{" "}
              {service.memory_max == null
                ? "unknown"
                : formatBytes(service.memory_max)}
            </dd>
            <dt className="text-muted-foreground">restarts</dt>
            <dd className="m-0">{service.n_restarts ?? "unknown"}</dd>
            <dt className="text-muted-foreground">CI runner</dt>
            <dd className="m-0">
              {service.runner_name
                ? `${service.runner_name}${service.repo ? ` (${service.repo})` : ""}`
                : "none"}
            </dd>
          </dl>
        }
        history={
          <p className="text-xs text-muted-foreground m-0">
            Observed{" "}
            {relativeTime(service.observed_at ?? null, {
              absent: "at an unknown time",
            })}
          </p>
        }
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            unit: {service.unit} · kind: {service.kind ?? "null"} ·
            active_state: {service.active_state ?? "null"} · sub_state:{" "}
            {service.sub_state ?? "null"}
          </p>
        }
      />
    </RecordRow>
  );
}

function EventRow({
  event,
  expanded,
  onToggle,
}: {
  event: ComputerEventWire;
  expanded: boolean;
  onToggle: () => void;
}) {
  const subject = eventSubject(event);
  return (
    <RecordRow
      data-testid="coord-computer-event-row"
      rowKey={event.event_id ?? `${event.kind}:${event.observed_at}`}
      expanded={expanded}
      onToggle={onToggle}
      identity={
        <span
          className="font-mono text-[11px]"
          data-event-kind={event.kind}
          title={event.kind}
        >
          {eventLabel(event.kind)}
        </span>
      }
      label={
        <span title={subject ?? undefined}>
          {subject ?? "no subject reported"}
        </span>
      }
      time={<RowTime at={event.observed_at} verb="Observed" />}
    >
      <RecordDetail
        data-testid="coord-computer-event-detail"
        why={
          <p className="text-[13px] text-foreground/85 m-0">
            {eventLabel(event.kind)} observed {absoluteTime(event.observed_at)}.
          </p>
        }
        raw={
          <pre className="m-0 font-mono text-[10px] text-muted-foreground/60 whitespace-pre-wrap break-all">
            {JSON.stringify(event.detail ?? {}, null, 1)}
          </pre>
        }
      />
    </RecordRow>
  );
}

function DeviceList({ devices }: { devices: ComputerDeviceWire[] }) {
  if (devices.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="coord-computer-devices-none"
      >
        No coord device is attached to this computer.
      </p>
    );
  }
  return (
    <ul className="space-y-1" data-testid="coord-computer-devices">
      {devices.map((d) => (
        <li
          key={d.device_id}
          className="flex items-center gap-3 px-3 py-2 text-sm rounded-md border border-border bg-card/30"
          data-testid="coord-computer-device-row"
        >
          <span className="font-medium truncate">
            {d.hostname ?? "unnamed device"}
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {[d.role ?? "role unknown", d.state ?? "state unknown"].join(" · ")}
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
            {d.device_id}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CiRunnerList({ runners }: { runners: CiRunnerWire[] }) {
  if (runners.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="coord-computer-ci-runners-none"
      >
        No CI runner is attributed to this computer.
      </p>
    );
  }
  return (
    <ul className="space-y-1" data-testid="coord-computer-ci-runners">
      {runners.map((r, i) => (
        <li
          key={`${r.runner_name ?? "unnamed"}:${r.repo ?? ""}:${i}`}
          className="flex items-center gap-3 px-3 py-2 text-sm rounded-md border border-border bg-card/30"
          data-testid="coord-computer-ci-runner-row"
        >
          <span className="font-mono text-[11px]">
            {r.runner_name ?? "unnamed runner"}
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {r.repo ?? "repo not reported"}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {ciRunnerStatusText(r)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The registrar read failed (or coord did not say it succeeded): UNKNOWN, not none. */
function RegistrarUnknown({ what, testId }: { what: string; testId: string }) {
  return (
    <p className="text-sm text-muted-foreground italic" data-testid={testId}>
      Coord did not confirm a successful CI registrar read for this computer, so{" "}
      {what} is unknown — not none.
    </p>
  );
}

function DivergenceList({ entries }: { entries: DivergenceWire[] }) {
  if (entries.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="coord-computer-divergence-none"
      >
        No disagreement found among fresh registrar rows.
      </p>
    );
  }
  return (
    <ul className="space-y-1" data-testid="coord-computer-divergence">
      {entries.map((entry) => (
        <li
          key={`${entry.unit}:${entry.registrar_device_id}`}
          className={`px-3 py-2 text-xs rounded-md border border-border bg-card/30 ${rowAccentClass({ attention: "waiting" })}`}
          data-testid="coord-computer-divergence-row"
        >
          <span className="font-mono">{entry.runner_name}</span>
          <span className="text-muted-foreground" title={entry.kind}>
            {" — "}
            {DIVERGENCE_KIND_LABEL[entry.kind] ?? entry.kind}
          </span>
          <span className="block text-muted-foreground">
            unit {entry.unit}: reported{" "}
            {entry.reported_active_state ?? "unknown"}, registrar{" "}
            {entry.registrar_status ?? "unknown"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function CoordComputerDetailPage() {
  const params = useParams<{ computerId: string }>();
  const rawId = params?.computerId ?? "";
  // A malformed escape (`%E0%A4%A`) makes decodeURIComponent THROW, which would
  // take the whole page down; the raw segment is then the best id we have, and
  // the backend's UUID validation answers it.
  const computerId = (() => {
    try {
      return decodeURIComponent(rawId);
    } catch {
      return rawId;
    }
  })();
  const read = useComputer(computerId);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const [openService, setOpenService] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<string | null>(null);

  const detail = read.data;
  const computer = useMemo(
    () => (detail ? normalizeComputer(detail) : null),
    [detail]
  );
  const freshness = useMemo(
    () =>
      computer
        ? computerFreshness(computer.freshness, read.fetchedAtMs, nowMs)
        : null,
    [computer, read.fetchedAtMs, nowMs]
  );
  const status = useMemo(
    () =>
      computer && freshness
        ? computerStatus(computer, freshness, {
            fetchedAtMs: read.fetchedAtMs,
            nowMs,
          })
        : null,
    [computer, freshness, read.fetchedAtMs, nowMs]
  );
  const services = listOrNull(detail?.services);
  const events = useMemo(() => {
    const list = listOrNull(detail?.events);
    return list === null ? null : orderEvents(list);
  }, [detail?.events]);
  const divergence = listOrNull(detail?.divergence);
  const history = useMemo(() => historyByLane(detail), [detail]);
  const health = useMemo(
    () =>
      deriveComputerDetailHealth({
        computer,
        freshness,
        status,
        issue: read.issue,
        services,
        events,
        divergence,
      }),
    [computer, freshness, status, read.issue, services, events, divergence]
  );
  const workloadDevices = listOrNull(detail?.workloads?.devices);
  const workloadRunners = listOrNull(detail?.workloads?.ci_runners);
  // `null` is coord's own answer when its session read failed — UNKNOWN.
  const agentSessions = listOrNull(detail?.workloads?.agent_sessions);
  const openSessions =
    agentSessions === null
      ? null
      : agentSessions.reduce((n, a) => n + a.open_sessions, 0);
  const fresh = freshness?.kind === "fresh";
  // Only an explicit `true` makes the CI-runner and divergence lists a
  // measurement; `false` (the read failed) and absent are both UNKNOWN.
  const registrarReadOk = detail?.registrar_read_ok === true;
  const servicesReported = detail?.services_reported === true;
  const devicesWithSessions =
    agentSessions === null
      ? null
      : agentSessions.filter((a) => a.open_sessions > 0).length;

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-computer-page"
      data-ui-bridge-id="coord-computer-page"
    >
      <HealthStrip
        data-testid="coord-computer-health"
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link
          href="/admin/coord/computers"
          className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:no-underline"
          data-testid="coord-computer-back"
        >
          <ArrowLeft className="h-3 w-3" /> All computers
        </Link>
        <RefreshButton
          onRefresh={read.refresh}
          label="Refresh computer"
          title={`Re-reads this computer from coord now; the page also refreshes itself every ${COMPUTERS_POLL_MS / 1000} s`}
          data-testid="coord-computer-refresh"
        />
        {freshness && <FreshnessBadge reading={freshness} />}
        {computer && (
          <span
            className="text-muted-foreground"
            data-testid="coord-computer-identity"
          >
            {[
              computer.kind,
              [computer.os, computer.osVersion].filter(Boolean).join(" ") ||
                "OS unknown",
              computer.kernel ?? "kernel unknown",
              computer.arch ?? "arch unknown",
              computer.bootedAt
                ? `booted ${relativeTime(computer.bootedAt)}`
                : "boot time unknown",
            ].join(" · ")}
          </span>
        )}
        {computer?.parentComputerId && (
          <Link
            href={computerHref(computer.parentComputerId)}
            className="underline underline-offset-2 hover:no-underline"
            data-testid="coord-computer-parent"
          >
            host computer
          </Link>
        )}
      </div>

      {read.issue && (
        <ReadIssueBanner
          issue={read.issue}
          retained={detail !== null}
          testId="coord-computer-unknown-banner"
        />
      )}

      {computer && freshness && read.issue?.kind !== "not_found" && (
        <>
          <Section
            title="Capacity vs usage"
            testId="coord-computer-usage-section"
            note="Capacity is what the computer reported having; usage is its latest sample per lane. A stale lane reads as last known, and an axis the computer cannot measure says not supported."
          >
            <CapacityStats computer={computer} />
            <LaneTable
              computer={computer}
              computerFreshness={freshness}
              history={history}
              fetchedAtMs={read.fetchedAtMs}
              nowMs={nowMs}
              showSparkline
            />
          </Section>

          <Section
            title="Services"
            testId="coord-computer-services-section"
            note={
              fresh
                ? "Watched units: GitHub Actions runners, the Qontinui runner, and anything else the runner watches."
                : "This computer's report is not fresh — every state below is what it last reported, not what it is doing now."
            }
          >
            {services === null || !servicesReported ? (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-computer-services-unknown"
              >
                This computer has never reported its watched services, so
                whether any is down is unknown — not none.
              </p>
            ) : (
              <RecordList
                items={services}
                itemKey={(s) => s.unit}
                expandedKey={openService}
                onExpandedKeyChange={setOpenService}
                empty={
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="coord-computer-services-none"
                  >
                    The computer reported no watched service.
                  </p>
                }
                renderRow={(s, ctx) => (
                  <ServiceRow
                    service={s}
                    computerFresh={fresh}
                    expanded={ctx.expanded}
                    onToggle={ctx.onToggle}
                  />
                )}
              />
            )}
          </Section>

          <Section
            title="Events (last 7 days)"
            testId="coord-computer-events-section"
            note="OOM kills, service failures and recoveries, reboots and telemetry gaps, newest first."
          >
            {events === null ? (
              <Unstated
                what="event history"
                testId="coord-computer-events-unknown"
              />
            ) : (
              <RecordList
                items={events}
                itemKey={(e, i) =>
                  e.event_id ?? `${e.kind}:${e.observed_at}:${i}`
                }
                expandedKey={openEvent}
                onExpandedKeyChange={setOpenEvent}
                empty={
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="coord-computer-events-none"
                  >
                    No event in the last 7 days.
                  </p>
                }
                renderRow={(e, ctx) => (
                  <EventRow
                    event={e}
                    expanded={ctx.expanded}
                    onToggle={ctx.onToggle}
                  />
                )}
              />
            )}
          </Section>

          <Section title="Workloads" testId="coord-computer-workloads-section">
            <h3 className="text-xs font-medium text-muted-foreground m-0">
              Coord devices
            </h3>
            {workloadDevices === null ? (
              <Unstated
                what="device list"
                testId="coord-computer-devices-unknown"
              />
            ) : (
              <DeviceList devices={workloadDevices} />
            )}
            <h3 className="text-xs font-medium text-muted-foreground m-0">
              CI runners
            </h3>
            {workloadRunners === null || !registrarReadOk ? (
              <RegistrarUnknown
                what="which CI runners run here"
                testId="coord-computer-ci-runners-unknown"
              />
            ) : (
              <CiRunnerList runners={workloadRunners} />
            )}
            <h3 className="text-xs font-medium text-muted-foreground m-0">
              Agent sessions
            </h3>
            <p
              className="text-sm text-muted-foreground m-0"
              data-testid="coord-computer-agent-sessions"
            >
              {agentSessions === null
                ? "Coord could not read agent sessions for this computer — unknown, not none."
                : `${openSessions} open agent session${openSessions === 1 ? "" : "s"} across ${devicesWithSessions} device${devicesWithSessions === 1 ? "" : "s"} with sessions, of ${workloadDevices?.length ?? "an unknown number of"} coord device${workloadDevices?.length === 1 ? "" : "s"} on this computer.`}
            </p>
          </Section>

          <Section
            title="Divergence"
            testId="coord-computer-divergence-section"
            note="Where the computer's own report and the CI registrar (or a declared CI host) disagree. The computer's report is the one coord trusts; the disagreement is shown, not resolved."
          >
            {divergence === null || !registrarReadOk ? (
              <RegistrarUnknown
                what="whether the registrar disagrees with this computer"
                testId="coord-computer-divergence-unknown"
              />
            ) : (
              <DivergenceList entries={divergence} />
            )}
          </Section>

          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            computer_id: {computer.computerId}
            {computer.parentComputerId
              ? ` · parent_computer_id: ${computer.parentComputerId}`
              : ""}
          </p>
        </>
      )}
    </div>
  );
}
