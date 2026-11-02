"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  MousePointerClick,
  RefreshCw,
} from "lucide-react";
import { useUIComponent } from "@qontinui/ui-bridge/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UNKNOWN_AMBER } from "@/components/console";
import { cn } from "@/lib/utils";
import { usePermissionAutoAcceptPolicy } from "../_hooks/usePermissionAutoAcceptPolicy";
import {
  PERMISSION_AUTO_ACCEPT_DOMAIN,
  PERMISSION_AUTO_ACCEPT_LEVELS,
  parsePermissionAutoAcceptLevel,
  type PermissionAutoAcceptLevel,
} from "../types";

const LEVEL_LABEL: Record<PermissionAutoAcceptLevel, string> = {
  on: "On",
  off: "Off",
};

/** An action parameter, matched exactly: the bridge schema says `on` | `off`. */
function isAutoAcceptLevel(v: string): v is PermissionAutoAcceptLevel {
  return (PERMISSION_AUTO_ACCEPT_LEVELS as readonly string[]).includes(v);
}

/**
 * What the resolved level means for runner sessions. `level` is the level as
 * the runner classifies it (`parsePermissionAutoAcceptLevel`); `raw` is what
 * coord served. `noRow` matters for `off`: the runner denies headless
 * (stream-json) requests only on an `off` from an explicit row (plan D5), and
 * a coord that does not know this domain yet answers a no-row `off`. Whether
 * a runner build supports the switch at all is said once, level-independent,
 * in the timing paragraph.
 */
function levelBlurb(
  raw: string | null,
  level: PermissionAutoAcceptLevel | null,
  noRow: boolean
): string {
  if (raw === null) {
    return "The resolved level could not be read, so whether runners accept permission prompts is unknown.";
  }
  if (level === null) {
    return `The resolved level is "${raw}", which is neither on nor off: runners accept no prompts at this level and do not deny the permission requests of headless sessions. Pick a level to write an explicit row.`;
  }
  if (level === "on") {
    return "Runners accept these prompts in sessions already running and in new ones. A runner leaves prompts on screen until it has read this setting from coord, and a terminal a restarted runner adopted may have no auto-accept hook and keep its prompts.";
  }
  if (noRow) {
    return "Runners read off, so they accept no prompts in interactive sessions. Because no row was written, the permission requests of headless (stream-json) sessions are still allowed; the runner starts to deny them only once this tenant's row, or a fleet-wide system row, says off.";
  }
  return "Runners accept no prompts: in interactive sessions the prompts are left on screen, and runners that support this switch deny the permission requests of headless (stream-json) sessions.";
}

/**
 * The `permission_auto_accept` switch (plan
 * `2026-10-23-runner-sessions-stop-at-permission-dialogs-so-accept-them-by-default-with-a-tenant-switch`
 * Phase 3).
 *
 * Laid out as `PermissionPromptCapturePanel` beside it — both are tenant-band
 * `on` | `off` fleet-policy dials — but this one DECIDES rather than observes:
 * the runner answers each session's `PermissionRequest` hook live (plan D2),
 * so the copy says what is accepted, what never is (D3), and that a change
 * reaches running sessions within one poll.
 *
 * What is shown is the level coord RESOLVES, never the level last written
 * (`useTenantFleetPolicyDial` property 1). The states kept apart are the
 * capture panel's: no row answered, a repo or system band winning, a level
 * outside `on`/`off` after the runner's own trim-and-lowercase (UNKNOWN — the
 * runner treats anything but an answered `on` as not-on, D1, so the panel
 * must not paint it as on), and a failed read-back after a write. The raw
 * served value is what is displayed; the classified one decides the rest.
 *
 * In the no-row state neither button is shown as chosen: the level is coord's
 * default, not the operator's choice, so the matching button reads
 * "(default)" instead.
 *
 * Registered with the UI Bridge (`coord-tenant-permission-auto-accept`) so
 * the switch and its read-back are addressable without positional ids. The
 * registration keeps the state getter it was handed (`@qontinui/ui-bridge`
 * 0.31.1 does not refresh it), so the getter is a stable function reading a
 * ref that every commit updates.
 */
export function PermissionAutoAcceptPanel() {
  /** Which level's write is in flight, so only that button spins. */
  const [pending, setPending] = useState<PermissionAutoAcceptLevel | null>(
    null
  );
  const {
    policy,
    loading,
    saving,
    error,
    readbackError,
    lastWrite,
    reload,
    setLevel,
  } = usePermissionAutoAcceptPolicy();

  const current = policy?.effective_level ?? null;
  const canEdit = policy?.can_edit === true;
  const noRow = policy?.resolved_scope === "none";
  // Most-specific-wins (repo > tenant > system): a repo row keeps overriding a
  // tenant write; a system row answering means this tenant has none, so a
  // tenant write takes effect immediately.
  const overriddenByRepo = policy?.resolved_scope === "repo";
  const fallingBackToSystem = policy?.resolved_scope === "system";
  // Classified as the runner classifies it, so "ON" is on for both.
  const level = parsePermissionAutoAcceptLevel(current);
  const recognised = level !== null;

  /** Set for the whole of a write, so a bridge call cannot start a second. */
  const writing = useRef(false);
  const write = (level: PermissionAutoAcceptLevel): Promise<boolean> => {
    writing.current = true;
    setPending(level);
    return setLevel(level).finally(() => {
      writing.current = false;
      setPending(null);
    });
  };

  const bridgeState = {
    domain: PERMISSION_AUTO_ACCEPT_DOMAIN,
    resolvedLevel: current,
    resolvedScope: policy?.resolved_scope ?? null,
    canEdit,
    readbackError,
    error,
  };
  const bridgeStateRef = useRef(bridgeState);
  useLayoutEffect(() => {
    bridgeStateRef.current = bridgeState;
  });
  const getBridgeState = useCallback(() => bridgeStateRef.current, []);

  useUIComponent({
    id: "coord-tenant-permission-auto-accept",
    name: "Permission auto-accept",
    description:
      "Per-tenant switch deciding whether runners accept the tool permission prompts Claude Code asks in runner sessions. State carries the last level read from coord (resolvedLevel is null only until a read has landed); a non-null error or readbackError means that level may be stale.",
    state: getBridgeState,
    actions: [
      {
        id: "set-permission-auto-accept",
        label: "Set permission auto-accept",
        description: `Write the tenant-band ${PERMISSION_AUTO_ACCEPT_DOMAIN} level. Params: {"level": "on" | "off"}. Refused for a non-admin and while a write is in flight; rejects when coord did not accept the write. Resolves true when it did; the panel then shows, and the state reports, the level read back, unless that read-back failed (readbackError), which leaves the last level read in place.`,
        // A switch flip is a reversible write — declared, not re-derived.
        effect: "write",
        paramSchema: {
          level: { type: "string", enum: [...PERMISSION_AUTO_ACCEPT_LEVELS] },
        },
        handler: async (params?: unknown) => {
          const wanted = (params as { level?: unknown } | undefined)?.level;
          if (typeof wanted !== "string" || !isAutoAcceptLevel(wanted)) {
            throw new Error(`level must be "on" or "off"`);
          }
          // The same gate as the buttons: a write they would not offer is
          // refused here too, rather than sent and toasted.
          if (!canEdit) {
            throw new Error(
              policy
                ? "read-only: coord would refuse this write (admin_required)"
                : "read-only: your role could not be read, so the write is not offered"
            );
          }
          if (saving || writing.current) {
            throw new Error(
              "a permission auto-accept write is already in flight"
            );
          }
          if (!(await write(wanted))) {
            throw new Error(
              "the permission auto-accept write failed: coord did not accept it"
            );
          }
          return true;
        },
      },
    ],
  });

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="permission-auto-accept-policy"
      data-ui-bridge-id="permission-auto-accept-policy"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <MousePointerClick className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">
              Accept permission prompts automatically
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Nobody is watching a runner session, so one that stops on a
              permission prompt does no work until the prompt is answered. When
              this is on, the runner answers those prompts itself.
            </p>
            <div
              className="mt-2 max-w-2xl text-xs text-muted-foreground"
              data-testid="permission-auto-accept-scope-copy"
            >
              <p>
                Accepted: the tool permission prompts Claude Code asks in runner
                sessions, including its built-in safety checks (for example
                &ldquo;Dangerous rmdir operation on possibly-empty variable
                path&rdquo;). Deny rules and blocking hooks still run first and
                still refuse.
              </p>
              <p className="mt-1">Never accepted:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>
                  questions Claude asks you (<code>AskUserQuestion</code>);
                </li>
                <li>plan approval;</li>
                <li>
                  any prompt in plan mode, or in an allow-list (don&apos;t-ask)
                  session;
                </li>
                <li>
                  dialogs that are not tool permissions, such as the usage-limit
                  menu.
                </li>
              </ul>
            </div>
            <p
              className="mt-2 max-w-2xl text-xs text-muted-foreground"
              data-testid="permission-auto-accept-timing"
            >
              A change reaches runner sessions that are already running within
              about a minute (one poll); no restart is needed. When this tenant
              turns it off, runners that support it deny the permission requests
              of headless (stream-json) sessions, which have no screen to show a
              prompt on, rather than leave them waiting; the session keeps
              running. Runner builds older than this switch neither accept
              prompts nor deny the permission requests of headless sessions; the
              setting takes effect as runners update.
            </p>
            <p
              className="mt-1 max-w-2xl text-xs text-muted-foreground"
              data-testid="permission-auto-accept-auto-deny"
            >
              A permission prompt that is not accepted stays on screen until
              someone answers it, or, on recent Claude Code versions, until
              Claude Code denies it after about two minutes; the session then
              carries on without that permission.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={loading}
          aria-label="Refresh permission auto-accept"
          data-testid="permission-auto-accept-refresh"
          data-ui-bridge-id="permission-auto-accept-refresh"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !policy ? (
        <Skeleton className="mt-4 h-16 w-full" />
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {PERMISSION_AUTO_ACCEPT_LEVELS.map((option) => {
              // A no-row level is coord's default, not a choice: never paint
              // it as the selected one.
              const chosen = !noRow && level === option;
              return (
                <Button
                  key={option}
                  size="sm"
                  variant={chosen ? "default" : "outline"}
                  aria-pressed={chosen}
                  disabled={saving || !canEdit}
                  onClick={() => {
                    void write(option);
                  }}
                  data-testid={`permission-auto-accept-${option}`}
                  data-ui-bridge-id={`permission-auto-accept-${option}`}
                >
                  {/* Only the level being written spins. */}
                  {saving && pending === option && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  {LEVEL_LABEL[option]}
                  {noRow && level === option ? " (default)" : ""}
                </Button>
              );
            })}
            <div className="ml-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>Runners resolve</span>
              {/* An unread or unrecognised level is UNKNOWN, so it takes R3's
                  ignorance floor, never the calm `off` look. */}
              <Badge
                variant={level === "on" ? "default" : "outline"}
                className={recognised ? undefined : UNKNOWN_AMBER}
                data-testid="permission-auto-accept-effective"
                data-ui-bridge-id="permission-auto-accept-effective"
                data-unknown={recognised ? undefined : "true"}
              >
                {current ?? "unknown"}
              </Badge>
              <span>from the</span>
              <Badge
                variant="outline"
                data-testid="permission-auto-accept-scope"
                data-ui-bridge-id="permission-auto-accept-scope"
              >
                {policy?.resolved_scope ?? "unknown"}
              </Badge>
              <span>scope band.</span>
            </div>
          </div>

          {!canEdit && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="permission-auto-accept-readonly"
            >
              {policy
                ? "Read-only: you are not an admin of this tenant, so coord would refuse the write (admin_required)."
                : "Read-only: your role could not be read, so whether the write would be accepted is unknown. Refresh once coord answers."}
            </p>
          )}

          {/* The backend floors a level coord did not report to `off` and a
              missing band to `none`, and that is indistinguishable here from
              a real no-row answer — so this copy names the level this read
              returned without attributing it to coord. */}
          {noRow && current !== null && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="permission-auto-accept-no-row"
            >
              No policy row answered for this tenant, so nobody chose this
              level. This read returned <code>{current}</code>
              {level === "off"
                ? ". A coord that does not know this setting yet reports off, and so does this console when coord reports no level at all; once coord is updated, a tenant with no row gets on"
                : ""}
              . Pick a level to write an explicit row.
            </p>
          )}

          {overriddenByRepo && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="permission-auto-accept-overridden-by-repo"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                A <strong>repo</strong>-band row is winning. Coord resolves the
                most specific band first, so writing here changes the tenant row
                but the repo row will keep overriding it.
              </p>
            </div>
          )}

          {fallingBackToSystem && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="permission-auto-accept-system-fallback"
            >
              A fleet-wide <strong>system</strong>-band row is answering because
              this tenant has none of its own. Coord resolves the most specific
              band first, so writing here takes effect immediately.
            </p>
          )}

          {readbackError && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="permission-auto-accept-readback-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                The write to <code>{lastWrite?.written_level}</code> was
                accepted, but reading back what runners resolve failed (
                {readbackError}). The value above is the last one confirmed and
                may be stale. Refresh to re-check.
              </p>
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="permission-auto-accept-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Couldn&apos;t read the permission auto-accept setting: {error}.{" "}
                {policy
                  ? "Showing the last value read, which may be out of date."
                  : "The current value is unknown."}
              </p>
            </div>
          )}

          {/* Coord returns `fleet_resources` blocks with any domain's read; the
              backend strips them and this line says so. */}
          {policy != null && policy.keys_not_shown.length > 0 && (
            <p
              className="text-[11px] text-muted-foreground"
              data-testid="permission-auto-accept-keys-not-shown"
            >
              Coord also returned {policy.keys_not_shown.join(", ")} with this
              read.{" "}
              {policy.keys_not_shown_source === "fleet_resources_row"
                ? "Those belong to the fleet_resources row, not to this setting, and are not shown here."
                : "Those are not shown here."}
            </p>
          )}

          {/* `current === null` is a failed read, not `off` — say so. */}
          <p
            className="text-xs text-muted-foreground"
            data-testid="permission-auto-accept-blurb"
          >
            {levelBlurb(current, level, noRow)}
          </p>
        </div>
      )}
    </section>
  );
}
