"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UNKNOWN_AMBER } from "@/components/console";
import { cn } from "@/lib/utils";
import { usePermissionPromptCapturePolicy } from "../_hooks/usePermissionPromptCapturePolicy";
import {
  PERMISSION_PROMPT_CAPTURE_LEVELS,
  type PermissionPromptCaptureLevel,
} from "../types";

const LEVEL_COPY: Record<
  PermissionPromptCaptureLevel,
  { label: string; blurb: string }
> = {
  on: {
    label: "On",
    blurb:
      "New sessions record each permission prompt they raise in this tenant's coord findings. The prompt itself still appears exactly as before. Runner builds without capture support ignore this setting.",
  },
  off: {
    label: "Off",
    blurb:
      "New sessions do not record permission prompts. The prompts themselves still appear exactly as before.",
  },
};

/**
 * The `permission_prompt_capture` toggle (plan
 * `2026-10-14-permission-prompts-are-never-recorded-so-guard-rules-grow-on-anecdote`
 * Phase 5).
 *
 * Laid out exactly as `CommandSafetyRewritePanel` beside it — both are
 * tenant-band `on` | `off` fleet-policy dials the runner reads at spawn — but
 * kept a separate consent (plan D7): this one sends command text off the
 * machine, so the copy says what is sent and where (plan D6), not only what
 * changes.
 *
 * What is shown is the level coord RESOLVES, never the level last written
 * (`useTenantFleetPolicyDial` property 1). The states kept apart:
 *
 * * `resolved_scope: "none"` — no row answered. The copy names the level this
 *   read returned without attributing it to coord: the backend floors a level
 *   coord did not report to `off`, which looks identical here.
 * * a `repo` band winning — a narrower row overrides a tenant write; a
 *   `system` band answering — this tenant has no row, so a write takes effect.
 * * a level outside `on`/`off` (a hand-written row) — the plan does not fix
 *   how a runner reads one, so the panel reports it as UNKNOWN rather than
 *   guessing a button or a badge.
 * * a failed read-back after a write — the resolved value is UNKNOWN.
 *
 * Runners decide at spawn (plan D7), so the copy says a change reaches only
 * terminals and agent sessions started after it.
 */
export function PermissionPromptCapturePanel() {
  /** Which level's write is in flight, so only that button spins. */
  const [pending, setPending] = useState<PermissionPromptCaptureLevel | null>(
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
  } = usePermissionPromptCapturePolicy();

  const current = policy?.effective_level ?? null;
  const canEdit = policy?.can_edit === true;
  const noRow = policy?.resolved_scope === "none";
  // Most-specific-wins (repo > tenant > system): a repo row keeps overriding a
  // tenant write; a system row answering means this tenant has none, so a
  // tenant write takes effect immediately.
  const overriddenByRepo = policy?.resolved_scope === "repo";
  const fallingBackToSystem = policy?.resolved_scope === "system";
  const recognised =
    current !== null &&
    (PERMISSION_PROMPT_CAPTURE_LEVELS as readonly string[]).includes(current);

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="permission-prompt-capture-policy"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ScanSearch className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Record permission prompts</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              When a Claude Code session stops on a permission prompt, the
              runner records it, so rules for the command-safety rewrite above
              are written from prompts that actually happened. Recording never
              changes the prompt: it appears, and waits, exactly as before.
            </p>
            <div
              className="mt-2 max-w-2xl text-xs text-muted-foreground"
              data-testid="permission-prompt-capture-what-is-sent"
            >
              <p>What is sent for each prompt:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>
                  the prompt&apos;s reason text, as it appears in the prompt;
                </li>
                <li>the tool it was raised for;</li>
                <li>
                  a redacted excerpt of the command, at most 300 characters:
                  known secret patterns (keys, tokens, bearer values) and the
                  values of <code>VAR=value</code> assignments are redacted, but
                  a secret of an unusual shape can get through;
                </li>
                <li>
                  the working directory, reduced to its last two path
                  components;
                </li>
                <li>
                  how often it happened, when it was first and last seen, and
                  the permission modes it was seen under, per machine.
                </li>
              </ul>
              <p className="mt-1">
                Where it goes: this tenant&apos;s coord findings, where the
                findings steward folds them into one dossier per kind of prompt.
              </p>
            </div>
            <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
              A change applies to terminals and agent sessions started{" "}
              <em>after</em> it. Ones already open keep the setting they started
              with — including a session started later inside a terminal that
              was already open.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={loading}
          data-testid="permission-prompt-capture-refresh"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !policy ? (
        <Skeleton className="mt-4 h-16 w-full" />
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {PERMISSION_PROMPT_CAPTURE_LEVELS.map((level) => (
              <Button
                key={level}
                size="sm"
                variant={current === level ? "default" : "outline"}
                disabled={saving || !canEdit}
                onClick={() => {
                  setPending(level);
                  setLevel(level).finally(() => setPending(null));
                }}
                data-testid={`permission-prompt-capture-${level}`}
              >
                {/* Only the level being written spins. */}
                {saving && pending === level && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                {LEVEL_COPY[level].label}
              </Button>
            ))}
            <div className="ml-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>Runners resolve</span>
              {/* An unread or unrecognised level is UNKNOWN, so it takes R3's
                  ignorance floor, never the calm `off` look. */}
              <Badge
                variant={current === "on" ? "default" : "outline"}
                className={recognised ? undefined : UNKNOWN_AMBER}
                data-testid="permission-prompt-capture-effective"
                data-unknown={recognised ? undefined : "true"}
              >
                {current ?? "unknown"}
              </Badge>
              <span>from the</span>
              <Badge
                variant="outline"
                data-testid="permission-prompt-capture-scope"
              >
                {policy?.resolved_scope ?? "unknown"}
              </Badge>
              <span>scope band.</span>
            </div>
          </div>

          {!canEdit && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="permission-prompt-capture-readonly"
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
              data-testid="permission-prompt-capture-no-row"
            >
              No policy row answered for this tenant, so nobody chose this
              level. This read returned <code>{current}</code>
              {current === "off"
                ? ", which is also what this console shows when coord reports no level at all; coord's own default for this setting, for a tenant with no row, is on"
                : ""}
              . Pick a level to write an explicit row.
            </p>
          )}

          {overriddenByRepo && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="permission-prompt-capture-overridden-by-repo"
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
              data-testid="permission-prompt-capture-system-fallback"
            >
              A fleet-wide <strong>system</strong>-band row is answering because
              this tenant has none of its own. Coord resolves the most specific
              band first, so writing here takes effect immediately.
            </p>
          )}

          {readbackError && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="permission-prompt-capture-readback-error"
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
              data-testid="permission-prompt-capture-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Couldn&apos;t read the permission-prompt capture setting:{" "}
                {error}.{" "}
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
              data-testid="permission-prompt-capture-keys-not-shown"
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
            data-testid="permission-prompt-capture-blurb"
          >
            {current === null
              ? "The resolved level could not be read, so whether new sessions record their permission prompts is unknown."
              : recognised
                ? LEVEL_COPY[current as PermissionPromptCaptureLevel].blurb
                : `The resolved level is "${current}", which is neither on nor off, so whether new sessions record their permission prompts is unknown. Pick a level to write an explicit row.`}
          </p>
        </div>
      )}
    </section>
  );
}
