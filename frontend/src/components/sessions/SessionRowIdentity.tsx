"use client";

/**
 * SessionRowIdentity — the four identity values a `/sessions` row shows as
 * COLUMNS and its expansion shows as a LIST: the machine, the Claude account,
 * the session kind and the last heartbeat.
 *
 * Plan `2026-11-08-sessions-console-hides-its-columns-and-paints-a-green-empty-fleet-before-the-first-read`
 * Phase 1. A console narrower than the row's budget hides those columns
 * (`SessionsConsole.tsx`, where the container thresholds are), and
 * `ux-priorities` `no-widget-may-hide-identifying-text` allows that only
 * because the expansion still names every one of them. Both render through the
 * renderers here, so D2's dash and the sentence in its `title` are written
 * ONCE — a cell and its expansion line that dashed for two different reasons
 * would be two claims about one fact.
 *
 * Each export renders a VALUE, never its box: the row owns its cell's width,
 * truncation and reveal, the expansion owns its list, and each puts the
 * matching title (`machineTitle`, `AccountCell.title`) on its own wrapper.
 */

import { relativeTime } from "@/components/console";
import type { AccountCell } from "./sessionAccount";
import {
  hasLifecycleHalf,
  lastHeartbeatAt,
  lifecycleState,
  type ConsolidatedSessionRow,
} from "./sessionConsoleStatus";

/** device_id → the console's machine label (hostname, else a short id). */
export type MachineLabel = (
  deviceId: string | null | undefined
) => string | null;

/** The dash D2 requires, with the sentence that says WHICH unknown it is. */
export function Dash({ title }: { title: string }) {
  return (
    <span
      className="text-muted-foreground/70 tabular-nums"
      title={title}
      data-testid="sessions-console-unknown"
    >
      –
    </span>
  );
}

/** The machine's title: the raw device id, so a short label hides nothing. */
export function machineTitle(row: ConsolidatedSessionRow): string {
  return row.device_id ? String(row.device_id) : "no device recorded";
}

export function MachineValue({
  row,
  machineLabel,
}: {
  row: ConsolidatedSessionRow;
  machineLabel: MachineLabel;
}) {
  return (
    <>
      {machineLabel(row.device_id) ?? (
        <Dash title="coord recorded no device for this row" />
      )}
    </>
  );
}

/** The account's `data-account-state`: what is known, or not applicable. */
export function accountState(
  account: AccountCell
): "known" | "unknown" | "not-applicable" {
  return account.kind === "not-applicable" ? "not-applicable" : account.state;
}

/**
 * The Claude account (plan 2026-10-19 Phase 3). Never blank: a label, an
 * UNKNOWN that names its reason, or — for a session with no Claude session id
 * at all — D2's not-applicable dash. The full sentence is `account.title`.
 */
export function AccountValue({ account }: { account: AccountCell }) {
  if (account.kind === "not-applicable") return <Dash title={account.title} />;
  if (account.state === "known") {
    return (
      <span className="font-mono text-muted-foreground">{account.label}</span>
    );
  }
  return <span className="text-amber-300/90">{account.label}</span>;
}

export function KindValue({ row }: { row: ConsolidatedSessionRow }) {
  return (
    <>
      {row.session_kind ?? (
        <Dash
          title={
            hasLifecycleHalf(row) === false
              ? "no coord.sessions row, so no session kind — unknown, not absent"
              : "coord served no session kind for this row"
          }
        />
      )}
    </>
  );
}

export function HeartbeatValue({
  row,
  now,
}: {
  row: ConsolidatedSessionRow;
  now?: number;
}) {
  if (lifecycleState(row) === null) {
    return (
      <Dash
        title={
          hasLifecycleHalf(row) === false
            ? "no coord.sessions row — heartbeat and state are unknown for this row, NOT closed"
            : "the join half for this row is unresolved — unknown, not closed"
        }
      />
    );
  }
  const beat = lastHeartbeatAt(row);
  if (beat === null) {
    return <Dash title="active, but coord has recorded no heartbeat yet" />;
  }
  return <>{relativeTime(beat, { absent: "–", now })}</>;
}
