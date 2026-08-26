"use client";

/**
 * Relaunch and account transfer — plan §3.5, with the honest tiers.
 *
 * **These are two different operations and this panel never lets them look
 * alike.** Claude Code cannot resume another account's session id: the
 * transcript is account-scoped. A transfer is therefore replay-as-context
 * into a NEW session, not a resume — and if it renders like a resume, the
 * operator silently loses state. So the operation is an explicit choice, and
 * the label, the tier chip, the explanation, the confirm-button, the POST
 * `mode` and the result card all change together. There is no code path where
 * a transfer says "resume", and the server agrees: it answers a transfer with
 * `dispatched: false` and `restore_tier: "replay_as_context"`.
 *
 * It preserves the `restore_tier` honesty pattern shipped in
 * `components/sessions/ResumePanel`: the tier is stated as a capability BADGE
 * before any action is offered, an unestablished tier renders as unknown
 * rather than as the optimistic case, and the runner's own observed
 * `restore_tier` is a ceiling the UI cannot raise — a `terminal_only` session
 * is terminal-only wherever it lands.
 *
 * The target machine list comes from the SAME source `ResumePanel` uses
 * (`listMachines()` → machines bridged to a coord device), because the server
 * dispatches a resume through the SAME shipped handoff subject.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CircleHelp,
  FileWarning,
  Loader2,
  MonitorUp,
  Terminal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import { listMachines, type Machine } from "@/services/devenv-api";
import { cn } from "@/lib/utils";
import { relaunchSession, SessionRepositoryApiError } from "./api";
import {
  RELAUNCH_TIER_COPY,
  parseNoCoordSession,
  resolveRelaunchTier,
  type NoCoordSessionDetail,
  type RelaunchOperation,
  type RelaunchResponse,
  type RelaunchTier,
  type SessionArtifactSummary,
} from "./types";

/** The `resume-foreign` default, and inside the server's 1–200 bound. */
const DEFAULT_CONTEXT_TURNS = 20;

const TIER_CHROME: Record<RelaunchTier, string> = {
  full: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  full_after_restore:
    "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  terminal_only:
    "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  // A transfer is chromatically distinct from every resume tier on purpose:
  // it is a different operation, not a weaker one.
  replay_as_context:
    "border-dashed border-violet-500/70 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  unknown: "border-dashed border-border bg-muted/30 text-muted-foreground",
};

const TIER_ICON: Record<RelaunchTier, typeof MonitorUp> = {
  full: MonitorUp,
  full_after_restore: MonitorUp,
  terminal_only: Terminal,
  replay_as_context: ArrowRightLeft,
  unknown: CircleHelp,
};

function formatWhen(iso: string | null): string {
  if (!iso) return "an unrecorded time";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Machines bridged to a coord device — the only ones a handoff can reach. */
function deviceTargets(
  machines: Machine[]
): { deviceId: string; label: string }[] {
  return machines
    .filter((m) => !m.revoked && m.coord_device_id)
    .map((m) => ({
      deviceId: m.coord_device_id as string,
      label: m.hostname ? `${m.name} (${m.hostname})` : m.name,
    }));
}

export function RelaunchPanel({
  artifact,
}: {
  artifact: SessionArtifactSummary;
}) {
  const [mode, setMode] = useState<RelaunchOperation>("resume");
  const [targetDeviceId, setTargetDeviceId] = useState("");
  const [contextTurns, setContextTurns] = useState(DEFAULT_CONTEXT_TURNS);
  const [reason, setReason] = useState("");

  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [machinesError, setMachinesError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [noCoord, setNoCoord] = useState<NoCoordSessionDetail | null>(null);
  const [result, setResult] = useState<RelaunchResponse | null>(null);

  // The device roster is only meaningful for a resume; a transfer dispatches
  // nothing and needs no machine.
  const loadMachines = useCallback(async () => {
    try {
      setMachines(await listMachines());
      setMachinesError(null);
    } catch (err) {
      setMachinesError(
        err instanceof Error ? err.message : "failed to load machines"
      );
    }
  }, []);

  useEffect(() => {
    if (mode !== "resume" || machines !== null || machinesError !== null) return;
    void loadMachines();
  }, [mode, machines, machinesError, loadMachines]);

  const targets = useMemo(
    () => (machines ? deviceTargets(machines) : []),
    [machines]
  );

  const tier = resolveRelaunchTier(artifact, { mode, targetDeviceId });
  const copy = RELAUNCH_TIER_COPY[tier];
  const Icon = TIER_ICON[tier];

  const hasBody =
    artifact.content_sha256 !== null || artifact.body_object_key !== null;
  const bodyIsRedacted = artifact.body_source === "coord_redacted";

  const blocked: string | null =
    mode === "transfer"
      ? hasBody
        ? null
        : "This is a metadata-only row — the transcript bytes were never archived, so there is nothing to replay as context."
      : machinesError !== null
        ? `The machine list could not be read (${machinesError}), so no handoff target can be chosen. That is unknown, not "no machines".`
        : machines === null
          ? "Loading the machines this session can be handed to…"
          : targets.length === 0
            ? "No machine in this tenant is bridged to a coord device, so there is no handoff subject to dispatch to."
            : targetDeviceId === ""
              ? "Choose the machine that will materialize the session."
              : null;

  const submit = async () => {
    setSubmitting(true);
    setActionError(null);
    setNoCoord(null);
    try {
      const response = await relaunchSession(artifact.id, {
        mode,
        ...(mode === "resume" ? { target_device_id: targetDeviceId } : {}),
        ...(mode === "transfer" ? { context_turns: contextTurns } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setResult(response);
      setConfirmOpen(false);
    } catch (err) {
      // A pruned coord session is EXPECTED, not exceptional: the archive
      // outlives the coordination record by design. The server hands back
      // everything needed to relaunch by hand, so show that instead of a
      // bare failure.
      const pruned =
        err instanceof SessionRepositoryApiError && err.status === 409
          ? parseNoCoordSession(err.body)
          : null;
      if (pruned) {
        setNoCoord(pruned);
        setConfirmOpen(false);
      } else {
        setActionError(
          err instanceof Error ? err.message : "the relaunch request failed"
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className="space-y-3"
      data-testid="session-relaunch-panel"
      data-relaunch-tier={tier}
      data-relaunch-mode={mode}
    >
      <h3 className="text-sm font-semibold">Run this session again</h3>

      {/* ── The choice, made explicitly ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={mode === "resume" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("resume")}
          data-testid="relaunch-mode-resume"
        >
          <MonitorUp className="size-3.5" />
          Resume
        </Button>
        <Button
          type="button"
          variant={mode === "transfer" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("transfer")}
          data-testid="relaunch-mode-transfer"
        >
          <ArrowRightLeft className="size-3.5" />
          Transfer as context
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Two different operations, not two words for one.
        </span>
      </div>

      {/* ── What the archive recorded ───────────────────────────────── */}
      <dl className="grid grid-cols-1 gap-x-8 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">Account home</dt>
          <dd className="min-w-0 break-all font-mono">
            {artifact.account_label ?? "(not recorded)"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">Owning device</dt>
          <dd className="min-w-0 break-all font-mono">
            {artifact.device_id ?? "(not recorded)"}
            {artifact.machine_hostname ? ` · ${artifact.machine_hostname}` : ""}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">Config dir</dt>
          <dd className="min-w-0 break-all font-mono">
            {artifact.config_dir ?? "(not recorded)"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">Working dir</dt>
          <dd className="min-w-0 break-all font-mono">
            {artifact.working_dir ?? "(not recorded)"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">Restore tier</dt>
          <dd className="min-w-0 font-mono">
            {artifact.restore_tier ?? "(none recorded)"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">Launch</dt>
          <dd className="min-w-0 break-all font-mono">
            {artifact.launch_command ?? "(not recorded)"}
          </dd>
        </div>
      </dl>

      {/* ── Resume: pick the machine ────────────────────────────────── */}
      {mode === "resume" && (
        <div className="flex flex-wrap items-center gap-2">
          <Label
            htmlFor="relaunch-target"
            className="text-xs font-normal text-muted-foreground"
          >
            Hand off to
          </Label>
          <Select
            value={targetDeviceId}
            onValueChange={setTargetDeviceId}
            disabled={targets.length === 0}
          >
            <SelectTrigger
              id="relaunch-target"
              className="w-[320px]"
              data-testid="relaunch-target-device"
            >
              <SelectValue
                placeholder={
                  machines === null && machinesError === null
                    ? "Loading machines…"
                    : "Choose a machine"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {targets.map((t) => (
                <SelectItem key={t.deviceId} value={t.deviceId}>
                  {t.label}
                  {artifact.device_id && t.deviceId === artifact.device_id
                    ? " — the session's own machine"
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ── Transfer: how much context ──────────────────────────────── */}
      {mode === "transfer" && (
        <div className="flex flex-wrap items-center gap-2">
          <Label
            htmlFor="relaunch-context-turns"
            className="text-xs font-normal text-muted-foreground"
          >
            Trailing turns to render as context
          </Label>
          <Input
            id="relaunch-context-turns"
            className="w-[90px]"
            type="number"
            min={1}
            max={200}
            value={contextTurns}
            onChange={(e) => {
              const next = Number.parseInt(e.target.value, 10);
              setContextTurns(
                Number.isFinite(next)
                  ? Math.min(200, Math.max(1, next))
                  : DEFAULT_CONTEXT_TURNS
              );
            }}
            data-testid="relaunch-context-turns"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Label
          htmlFor="relaunch-reason"
          className="text-xs font-normal text-muted-foreground"
        >
          Reason (recorded on coord&apos;s durable event)
        </Label>
        <Input
          id="relaunch-reason"
          className="w-[320px]"
          placeholder="Optional"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="relaunch-reason"
        />
      </div>

      {/* ── The tier, stated before any action is offered ───────────── */}
      <div
        className={cn(
          "space-y-2 rounded-md border px-3 py-2.5",
          TIER_CHROME[tier]
        )}
        data-testid="relaunch-tier-card"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="text-sm font-semibold" data-testid="relaunch-action">
            {copy.action}
          </span>
          <Badge
            variant="outline"
            className="border-current bg-transparent text-current"
            data-testid="relaunch-tier-badge"
          >
            {copy.badge}
          </Badge>
        </div>
        <p className="text-xs">{copy.detail}</p>

        {/*
          The `resume-foreign` rules become the UI copy for a transfer — this
          is the one operation where an operator's instinct ("it came back, so
          it knows where I was") is wrong.
        */}
        {mode === "transfer" && (
          <ul
            className="list-disc space-y-1 pl-5 text-xs"
            data-testid="relaunch-transfer-rules"
          >
            <li>
              The transcript ended at{" "}
              <strong>{formatWhen(artifact.last_activity_at)}</strong>. State
              after that is unknown — uncommitted edits, in-flight merges and
              unintegrated tool results did not survive and are not recoverable
              from this archive.
            </li>
            <li>
              Nothing is auto-continued, and nothing is dispatched. You get the
              turns; read them, then decide what the new session should do.
            </li>
            <li>
              This does not restore the conversation. It retells it. The new
              session has a new id, and{" "}
              <code className="font-mono">
                claude --resume {artifact.claude_session_id.slice(0, 8)}…
              </code>{" "}
              will not work under another account.
            </li>
          </ul>
        )}

        {tier === "full_after_restore" && (
          <p className="text-xs">
            The archived JSONL has to reach{" "}
            <code className="font-mono">
              {artifact.config_dir ?? "the target account home"}
            </code>{" "}
            on that machine before the conversation is there. Export it below
            if it is not already.
          </p>
        )}

        {/* Where §3.5 meets §5: a restore or a replay reads the ARCHIVED
            bytes, so a redacted archive means a redacted revival. */}
        {hasBody &&
          bodyIsRedacted &&
          (mode === "transfer" || tier === "full_after_restore") && (
            <p
              className="flex items-start gap-1.5 text-xs"
              data-testid="relaunch-redacted-warning"
            >
              <FileWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              The archived body for this session is coord&apos;s{" "}
              <strong>redacted</strong> copy, not the verbatim file. Whatever
              is replayed or restored is that redacted copy — secrets, and
              everything the redactor false-positived on, are already gone from
              it.
            </p>
          )}
      </div>

      {blocked && (
        <p
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
          data-testid="relaunch-blocked"
        >
          <CircleHelp className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {blocked}
        </p>
      )}

      <CoordAdminOnly
        fallback={
          <ReadOnlyNotice label="Relaunch and transfer are administrator-only" />
        }
      >
        <Button
          variant={mode === "transfer" ? "outline" : "default"}
          size="sm"
          disabled={blocked !== null || submitting}
          onClick={() => {
            setActionError(null);
            setConfirmOpen(true);
          }}
          data-testid="relaunch-open-confirm"
        >
          <Icon className="size-4" />
          {copy.action}…
        </Button>
      </CoordAdminOnly>

      {actionError && (
        <p className="text-xs text-destructive" data-testid="relaunch-error">
          {actionError}
        </p>
      )}

      {/* ── 409: coord pruned the session. Expected, and recoverable. ── */}
      {noCoord && (
        <div
          className="space-y-1.5 rounded-md border border-sky-500/50 bg-sky-500/10 px-3 py-2.5 text-xs"
          data-testid="relaunch-no-coord-session"
        >
          <p className="font-medium">No live coord session — relaunch by hand</p>
          <p>{noCoord.message}</p>
          <dl className="grid grid-cols-1 gap-y-1 font-mono">
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 font-sans opacity-70">Session id</dt>
              <dd className="min-w-0 break-all">
                {noCoord.claude_session_id ?? artifact.claude_session_id}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 font-sans opacity-70">Account</dt>
              <dd className="min-w-0 break-all">
                {noCoord.account_label ?? "(not recorded)"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 font-sans opacity-70">Config dir</dt>
              <dd className="min-w-0 break-all">
                {noCoord.config_dir ?? "(not recorded)"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 font-sans opacity-70">Working dir</dt>
              <dd className="min-w-0 break-all">
                {noCoord.working_dir ?? "(not recorded)"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 font-sans opacity-70">Launch</dt>
              <dd className="min-w-0 break-all">
                {noCoord.launch_command ?? "(not recorded)"}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* ── The server's answer, verbatim ────────────────────────────── */}
      {result && (
        <div
          className={cn(
            "space-y-1.5 rounded-md border px-3 py-2.5 text-xs",
            result.mode === "transfer"
              ? "border-dashed border-violet-500/70 bg-violet-500/10"
              : "border-emerald-500/50 bg-emerald-500/10"
          )}
          data-testid="relaunch-result"
          data-result-mode={result.mode}
          data-result-tier={result.restore_tier}
          data-result-dispatched={result.dispatched ? "true" : "false"}
        >
          <p className="font-medium">
            {result.mode === "transfer"
              ? "Transfer — replay context returned. Nothing was dispatched."
              : "Resume dispatched through the handoff subject."}{" "}
            <Badge
              variant="outline"
              className="ml-1 border-current bg-transparent text-current"
            >
              tier: {result.restore_tier}
            </Badge>
          </p>
          {/* The server's own words about the seam — never paraphrased. */}
          {result.notices.map((notice, i) => (
            <p key={i}>{notice}</p>
          ))}
          {result.mode === "transfer" &&
            result.context_turns &&
            result.context_turns.length > 0 && (
              <details className="mt-1" data-testid="relaunch-context-preview">
                <summary className="cursor-pointer select-none">
                  {result.context_turns.length} turns of replay context
                </summary>
                <ol className="mt-1.5 max-h-[280px] space-y-1 overflow-auto rounded border border-border bg-background/60 p-2">
                  {result.context_turns.map((turn) => (
                    <li key={`${turn.index}-${turn.line_number}`}>
                      <span className="mr-2 select-none font-mono text-[10px] opacity-70">
                        #{turn.index} {turn.role ?? turn.type ?? ""}
                      </span>
                      <span className="whitespace-pre-wrap break-words font-mono">
                        {turn.parse_error
                          ? `(line ${turn.line_number} unparseable: ${turn.parse_error})`
                          : (turn.text ?? "(no text content)")}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          {result.mode === "transfer" &&
            (!result.context_turns || result.context_turns.length === 0) && (
              <p className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                No replay context came back, so there is nothing to carry into
                a new session.
              </p>
            )}
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent data-testid="relaunch-confirm-dialog">
          <DialogHeader>
            <DialogTitle>
              {mode === "transfer"
                ? "Transfer as context — this is not a resume"
                : copy.action}
            </DialogTitle>
            <DialogDescription>{copy.detail}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1 text-xs">
            {mode === "resume" ? (
              <p>
                <span className="text-muted-foreground">Target machine: </span>
                <span className="font-mono">
                  {targets.find((t) => t.deviceId === targetDeviceId)?.label ??
                    targetDeviceId}
                </span>
                {artifact.device_id && targetDeviceId !== artifact.device_id ? (
                  <span className="text-muted-foreground">
                    {" "}
                    — not the machine the archive recorded
                  </span>
                ) : null}
              </p>
            ) : (
              <p>
                <span className="text-muted-foreground">Context: </span>
                the last {contextTurns} turns, returned for a NEW session. The
                transcript ended at {formatWhen(artifact.last_activity_at)};
                state after that is unknown, and nothing is auto-continued.
              </p>
            )}
            {reason.trim() && (
              <p>
                <span className="text-muted-foreground">Reason: </span>
                {reason.trim()}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant={mode === "transfer" ? "outline" : "default"}
              size="sm"
              onClick={() => void submit()}
              disabled={submitting}
              data-testid="relaunch-confirm"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Icon className="size-4" />
              )}
              {copy.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
