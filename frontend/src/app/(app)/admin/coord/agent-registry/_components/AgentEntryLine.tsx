"use client";

/**
 * One agent type on `/admin/coord/agent-registry`: one line (R2), detail
 * expanding in place (R5).
 *
 * The line carries two DIFFERENT controls, labelled apart (plan
 * `2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type` D1):
 *
 * - **Default for members** — the registry row's `default_enabled`, what a
 *   member with no recorded preference gets. A member's own preference
 *   overrides it, which is why the override count sits beside it. Only a type
 *   WITH a row has one; a type without one reads "no registry row — default:
 *   on" instead.
 * - **Spawns: On / Off** — the tenant-admin ceiling. Off binds every member.
 *
 * Moved out of `page.tsx` (style guide `modular-code-and-file-size`); the
 * default-toggle markup and its testids are unchanged.
 */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
  absoluteTime,
  relativeTime,
  rowAccentClass as sharedRowAccentClass,
} from "@/components/console";
import type {
  AdminAgentRegistryRow,
  AgentAdminSwitchUpdate,
} from "@/lib/api/agent-registry";
import {
  adminDispositionOf,
  adminReasonOf,
  allowedDispositionsOf,
  alsoVetoesOf,
  enforcementLabel,
  needsDisposition,
  purposeOf,
  sourceBadges,
  spawnPathOf,
  spawnSwitchState,
  type AgentLine,
} from "../_lib/agentCatalog";
import type { SwitchStatus } from "../_hooks/useAdminSpawnSwitch";
import { SpawnSwitchPanel, SpawnSwitchToggle } from "./AdminSpawnSwitch";

// Green is not an R3 attention family, so it has no exported sibling.
const READY_GREEN = "bg-green-500/15 text-green-200 border-green-500/30";

/**
 * Attention model, R3: who has to do something.
 *
 * A default members already contradict is amber — a decision waiting to be
 * revisited, and one whose edit will reach fewer people than it looks like it
 * will. Everything else is inert, a switched-off type included: a standing
 * configuration is never a failure.
 */
export function lineAttention(line: AgentLine): "waiting" | "none" {
  return (line.row?.pref_differs_from_default_count ?? 0) > 0
    ? "waiting"
    : "none";
}

/** R8 — the vocabulary the screen sees, derived in one place. */
function defaultLabel(enabled: boolean): { label: string; className: string } {
  return enabled
    ? { label: "On by default", className: READY_GREEN }
    : { label: "Off by default", className: INERT };
}

function overrideLabel(row: AdminAgentRegistryRow): {
  label: string;
  className: string;
  title: string;
} {
  if (row.pref_count === 0) {
    return {
      label: "no overrides",
      className: INERT,
      title: "No member has recorded a preference for this agent.",
    };
  }
  const differs = row.pref_differs_from_default_count;
  return {
    label: `${row.pref_count} override${row.pref_count === 1 ? "" : "s"}`,
    className: differs > 0 ? WAITING_AMBER : INERT,
    title:
      `${row.pref_count} member${row.pref_count === 1 ? " has" : "s have"} a ` +
      `recorded preference for this agent, so a change to the default does ` +
      `not reach ${row.pref_count === 1 ? "that member" : "them"}. ` +
      (differs > 0
        ? `${differs} currently contradict${differs === 1 ? "s" : ""} it.`
        : `None of them contradicts it.`),
  };
}

const ENFORCEMENT_CLASS = {
  full: INERT,
  partial: INERT,
  none: INERT,
  unknown: UNKNOWN_AMBER,
} as const;

export interface AgentEntryLineProps {
  line: AgentLine;
  isOpen: boolean;
  onToggleOpen: () => void;
  /** `null` for an admin; otherwise why the controls are read-only. */
  readOnlyReason: string | null;
  saving: boolean;
  saveError: string | undefined;
  onSaveDefault: (
    row: AdminAgentRegistryRow,
    update: { default_enabled: boolean; policy_required?: boolean }
  ) => void;
  switchStatus: SwitchStatus | undefined;
  onFlip: (update: AgentAdminSwitchUpdate) => void;
}

export function AgentEntryLine({
  line,
  isOpen,
  onToggleOpen,
  readOnlyReason,
  saving,
  saveError,
  onSaveDefault,
  switchStatus,
  onFlip,
}: AgentEntryLineProps) {
  const [confirmRequested, setConfirming] = useState(false);
  // A line that turns read-only mid-confirmation drops the confirmation, so
  // the toggle is never left disabled behind a panel that is not shown, and
  // the confirmation never reappears unbidden once the line is writable.
  useEffect(() => {
    if (readOnlyReason !== null) setConfirming(false);
  }, [readOnlyReason]);
  const confirming = confirmRequested && readOnlyReason === null;
  const name = line.agent_name;
  const row = line.row;
  const spawnPath = spawnPathOf(line);
  const purpose = purposeOf(line);
  const badges = sourceBadges(line);
  const enforcement = enforcementLabel(line);
  const state = spawnSwitchState(line);
  // A member reads the default from the catalog (rows are admin-only); a type
  // with no row says so through its source badge instead.
  const defaultEnabled =
    row?.default_enabled ??
    (line.catalog?.has_row === true ? line.catalog.default_enabled : null);
  const def = defaultEnabled === null ? null : defaultLabel(defaultEnabled);
  const ovr = row ? overrideLabel(row) : null;
  const disposition = adminDispositionOf(line);
  const reason = adminReasonOf(line);
  const alsoVetoes = alsoVetoesOf(line);

  return (
    <div>
      {/* R2 — one record, one line. R4 — accent on the edge only. */}
      <div
        // `@container/agent-row`: the line is its own NAMED query container,
        // so its optional badges answer to the ROW's width, not the viewport's.
        className={`@container/agent-row flex items-center gap-2 px-3 py-2 text-sm rounded-md border bg-card/30 ${sharedRowAccentClass(
          { attention: lineAttention(line) }
        )} ${isOpen ? "rounded-b-none" : ""}`}
        data-testid={`agent-registry-row-${name}`}
        data-attention={lineAttention(line)}
        data-has-row={
          line.catalog
            ? line.catalog.has_row === null
              ? "unknown"
              : String(line.catalog.has_row)
            : String(row !== null)
        }
        // Hand-rolled rather than `<RecordRow>` (the expand control is a
        // nested button, which a whole-line `<button>` cannot host), so it
        // declares the console-row marker itself.
        data-console-row=""
      >
        <button
          type="button"
          className="shrink-0 text-muted-foreground"
          onClick={onToggleOpen}
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${name}`}
          aria-expanded={isOpen}
        >
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <span
          className="font-mono text-[11px] text-muted-foreground shrink-0 truncate max-w-[10rem]"
          title={spawnPath}
        >
          {spawnPath}
        </span>
        <span className="font-medium flex-1 truncate" title={purpose || name}>
          {name}
        </span>
        {badges.map((b) => (
          <Badge
            key={b.key}
            variant="outline"
            className={`text-[11px] whitespace-nowrap ${INERT} ${
              b.key === "no-row"
                ? ""
                : "hidden @min-[52rem]/agent-row:inline-flex"
            }`}
            title={b.title}
            data-testid={`agent-registry-source-${name}-${b.key}`}
          >
            {b.label}
          </Badge>
        ))}
        <Badge
          variant="outline"
          className={`text-[11px] whitespace-nowrap ${ENFORCEMENT_CLASS[enforcement.reach]}`}
          title={enforcement.detail}
          data-testid={`agent-registry-enforcement-${name}`}
          data-reach={enforcement.reach}
        >
          {enforcement.label}
        </Badge>
        {alsoVetoes.length > 0 && (
          <Badge
            variant="outline"
            className="text-[11px] whitespace-nowrap"
            title={`Switching it off also stops: ${alsoVetoes.join(", ")}`}
            data-testid={`agent-registry-also-vetoes-badge-${name}`}
          >
            also stops {alsoVetoes.length}
          </Badge>
        )}
        {def && (
          <Badge
            variant="outline"
            className={`text-[11px] font-semibold whitespace-nowrap ${def.className}`}
            data-default-enabled={defaultEnabled}
          >
            {def.label}
          </Badge>
        )}
        {/* From a 45rem ROW, never by the viewport; at every width the
            expanded panel's policy toggle implies the state. */}
        {row?.policy_required && (
          <Badge
            variant="outline"
            className={`text-[11px] whitespace-nowrap hidden @min-[45rem]/agent-row:inline-flex ${WAITING_AMBER}`}
            title="Disabling this agent forces the member to choose a disposition."
          >
            policy required
          </Badge>
        )}
        {ovr && (
          <Badge
            variant="outline"
            className={`text-[11px] whitespace-nowrap ${ovr.className}`}
            title={ovr.title}
            data-testid={`agent-registry-overrides-${name}`}
          >
            {ovr.label}
          </Badge>
        )}
        {row && readOnlyReason === null && (
          <label
            className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none text-xs"
            title="What a member with no recorded preference gets. A member's own preference overrides it."
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span className="whitespace-nowrap text-muted-foreground">
              Default for members
            </span>
            <input
              type="checkbox"
              className="checkbox"
              checked={row.default_enabled}
              disabled={saving}
              onChange={() =>
                onSaveDefault(row, { default_enabled: !row.default_enabled })
              }
              aria-label={`Default-enable ${name}`}
            />
          </label>
        )}
        <SpawnSwitchToggle
          agentName={name}
          state={state}
          readOnlyReason={readOnlyReason}
          status={switchStatus}
          confirming={confirming}
          onSwitchOn={() => onFlip({ disabled: false })}
          onRequestOff={() => setConfirming(true)}
        />
      </div>

      <SpawnSwitchPanel
        key={confirming ? "confirming" : "idle"}
        agentName={name}
        readOnlyReason={readOnlyReason}
        needsDisposition={needsDisposition(line)}
        allowedDispositions={allowedDispositionsOf(line)}
        status={switchStatus}
        confirming={confirming}
        onCancel={() => setConfirming(false)}
        onConfirmOff={(update) => {
          setConfirming(false);
          onFlip(update);
        }}
      />

      {/* R5 — detail expands in place, sharing the row's border. */}
      {isOpen && (
        <div
          className="rounded-md rounded-t-none border border-t-0 bg-card/20 px-3 py-2 space-y-2"
          data-testid={`agent-registry-detail-${name}`}
        >
          <p className="text-xs text-muted-foreground">
            {purpose || "No purpose recorded for this agent."}
          </p>
          <p
            className="text-xs"
            data-testid={`agent-registry-enforcement-detail-${name}`}
          >
            What switching spawns off stops: {enforcement.detail}
          </p>
          {alsoVetoes.length > 0 && (
            <p
              className="text-xs"
              data-testid={`agent-registry-also-vetoes-${name}`}
            >
              Switching it off also stops:{" "}
              <span className="font-mono">{alsoVetoes.join(", ")}</span>
            </p>
          )}
          {state === "off" && (
            <p
              className="text-xs"
              data-testid={`agent-registry-admin-detail-${name}`}
            >
              Spawns switched off
              {row?.admin_disabled_by ? ` by ${row.admin_disabled_by}` : ""}
              {row?.admin_disabled_at ? (
                <span title={absoluteTime(row.admin_disabled_at)}>
                  {" "}
                  {relativeTime(row.admin_disabled_at)}
                </span>
              ) : (
                ""
              )}
              {disposition
                ? ` · disposition: ${disposition}`
                : disposition === null
                  ? " · disposition: degrade (none picked)"
                  : " · disposition: not reported"}
              {reason ? ` · reason: ${reason}` : ""}
            </p>
          )}
          {row ? (
            <>
              <p className="text-xs">
                {row.pref_count === 0
                  ? "Every member of this tenant sees the default above — nobody has recorded a preference."
                  : `${row.pref_count} member${
                      row.pref_count === 1 ? "" : "s"
                    } already recorded a preference, so changing the default does not reach ${
                      row.pref_count === 1 ? "that member" : "them"
                    }. ${row.pref_differs_from_default_count} of ${
                      row.pref_count
                    } currently contradict the default.`}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {readOnlyReason === null && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={() =>
                      onSaveDefault(row, {
                        default_enabled: row.default_enabled,
                        policy_required: !row.policy_required,
                      })
                    }
                    data-testid={`agent-registry-toggle-policy-${name}`}
                  >
                    {row.policy_required
                      ? "Stop requiring a disposition"
                      : "Require a disposition to disable"}
                  </Button>
                )}
                {row.trigger_condition && (
                  <span className="text-xs text-muted-foreground">
                    Triggers: {row.trigger_condition}
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {line.catalog?.has_row === null
                ? "Coord could not read the registry rows, so whether this type has a recorded decision is unknown."
                : line.catalog?.has_row
                  ? "This type has a registry row; its tenant default and member overrides are shown to administrators."
                  : "No registry row: nothing has been decided for this type, so it is on for everyone. A row is written when an administrator switches its spawns."}
            </p>
          )}
          {saveError && (
            <p
              className="text-xs text-red-200"
              data-testid={`agent-registry-save-error-${name}`}
            >
              {saveError}
            </p>
          )}
          {/* R5 — raw ids last, and only here. */}
          <p className="font-mono text-[10px] text-muted-foreground/60">
            {name} · spawn_path={spawnPath || "—"}
            {row && row.agent_name !== name
              ? ` · row_name=${row.agent_name}`
              : ""}
            {row
              ? ` · model=${row.model ?? "—"} · effort=${row.effort ?? "—"} · fanout_bound=${row.fanout_bound ?? "—"} · allowed=${row.allowed_dispositions.join(",") || "—"}`
              : ""}
            {line.catalog
              ? ` · enforcement=${line.catalog.enforcement} · sources=${line.catalog.sources.map((s) => s.source).join(",") || "—"}`
              : " · catalog=unread"}
          </p>
        </div>
      )}

      {/* A save that failed while the row is COLLAPSED still has to be
          visible: the switch snapped back to the server's value. */}
      {saveError && !isOpen && (
        <p
          className="px-3 py-1 text-xs text-red-200"
          data-testid={`agent-registry-save-error-${name}`}
        >
          {saveError}
        </p>
      )}
    </div>
  );
}
