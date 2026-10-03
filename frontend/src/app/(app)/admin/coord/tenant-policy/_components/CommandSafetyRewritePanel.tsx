"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useCommandSafetyRewritePolicy } from "../_hooks/useCommandSafetyRewritePolicy";
import {
  COMMAND_SAFETY_REWRITE_LEVELS,
  type CommandSafetyRewriteLevel,
} from "../types";

const LEVEL_COPY: Record<
  CommandSafetyRewriteLevel,
  { label: string; blurb: string }
> = {
  on: {
    label: "On",
    blurb:
      "When Claude Code would stop to ask about a risky shell command, the agent is told how to rewrite it instead, and carries on without waiting for anyone.",
  },
  off: {
    label: "Off",
    blurb:
      "Claude Code's own safety prompts are back: a risky shell command stops the session until someone answers the prompt.",
  },
};

/**
 * The `command_safety_rewrite` toggle (plan
 * `2026-10-03-runner-sessions-stop-on-builtin-command-safety-prompts` Phase 4).
 *
 * Laid out exactly as `TranscriptSyncPanel` beside it, with the resolved-band
 * reporting of the plan library's `CapturePolicyPanel`, because this is a
 * fleet-policy dial rather than a `tenant_policies` flag.
 *
 * What is shown is the level coord RESOLVES, never the level last written
 * (`useTenantFleetPolicyDial` property 1). The states kept apart:
 *
 * * `resolved_scope: "none"` — no row exists. Runners use coord's per-domain
 *   default; the copy names the level coord actually reports rather than a
 *   literal, so a coord that predates the default cannot be painted as `on`.
 * * a `repo` band winning — a narrower row overrides a tenant write.
 * * a level outside `on`/`off` (a hand-written row) — runners read it as `on`
 *   (plan D6), and the panel says so rather than guessing a button.
 * * a failed read-back after a write — the resolved value is UNKNOWN.
 *
 * Runners decide at spawn (plan D6), so the copy says a change reaches only
 * terminals and agent sessions started after it.
 */
export function CommandSafetyRewritePanel() {
  /** Which level's write is in flight, so only that button spins. */
  const [pending, setPending] = useState<CommandSafetyRewriteLevel | null>(
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
  } = useCommandSafetyRewritePolicy();

  const current = policy?.effective_level ?? null;
  const canEdit = policy?.can_edit === true;
  const noRow = policy?.resolved_scope === "none";
  const overriddenByRepo = policy?.resolved_scope === "repo";
  const recognised =
    current !== null &&
    (COMMAND_SAFETY_REWRITE_LEVELS as readonly string[]).includes(current);

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="command-safety-rewrite-policy"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">
              Rewrite risky shell commands instead of prompting
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              When Claude Code would stop to ask about a risky shell command,
              the agent is told how to rewrite it instead, so an unattended
              session keeps working rather than waiting on a prompt nobody is
              there to answer. Turning this off restores Claude Code&apos;s
              prompts.
            </p>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
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
          data-testid="command-safety-rewrite-refresh"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !policy ? (
        <Skeleton className="mt-4 h-16 w-full" />
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {COMMAND_SAFETY_REWRITE_LEVELS.map((level) => (
              <Button
                key={level}
                size="sm"
                variant={current === level ? "default" : "outline"}
                disabled={saving || !canEdit}
                onClick={() => {
                  setPending(level);
                  setLevel(level).finally(() => setPending(null));
                }}
                data-testid={`command-safety-rewrite-${level}`}
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
              <Badge
                variant={current === "on" ? "default" : "outline"}
                data-testid="command-safety-rewrite-effective"
              >
                {current ?? "unknown"}
              </Badge>
              <span>from the</span>
              <Badge
                variant="outline"
                data-testid="command-safety-rewrite-scope"
              >
                {policy?.resolved_scope ?? "unknown"}
              </Badge>
              <span>scope band.</span>
            </div>
          </div>

          {!canEdit && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="command-safety-rewrite-readonly"
            >
              {policy
                ? "Read-only: you are not an admin of this tenant, so coord would refuse the write (admin_required)."
                : "Read-only: your role could not be read, so whether the write would be accepted is unknown. Refresh once coord answers."}
            </p>
          )}

          {noRow && current !== null && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="command-safety-rewrite-no-row"
            >
              No policy row exists for this tenant yet, so runners use the
              default, which coord reports as <code>{current}</code>. Nobody
              chose it. Pick a level to write an explicit row.
            </p>
          )}

          {overriddenByRepo && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="command-safety-rewrite-overridden-by-repo"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                A <strong>repo</strong>-band row is winning. Coord resolves the
                most specific band first, so writing here changes the tenant row
                but the repo row will keep overriding it.
              </p>
            </div>
          )}

          {readbackError && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="command-safety-rewrite-readback-error"
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
              data-testid="command-safety-rewrite-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Couldn&apos;t read the command-safety rewrite setting: {error}.{" "}
                {policy
                  ? "Showing the last value read, which may be out of date."
                  : "The current value is unknown."}
              </p>
            </div>
          )}

          {/* `current === null` is a failed read, not `off` — say so. */}
          <p
            className="text-xs text-muted-foreground"
            data-testid="command-safety-rewrite-blurb"
          >
            {current === null
              ? "The resolved level could not be read, so whether new sessions rewrite or prompt is unknown."
              : recognised
                ? LEVEL_COPY[current as CommandSafetyRewriteLevel].blurb
                : `The resolved level is "${current}", which is neither on nor off. Runners treat a level they do not recognise as on.`}
          </p>
        </div>
      )}
    </section>
  );
}
