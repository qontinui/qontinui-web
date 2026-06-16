"use client";

/**
 * CoPilotHome — the AI co-pilot "Home" command surface.
 *
 * This is the browser-side analog of the runner's prompt-home: the user types
 * a natural-language prompt, the paired runner plans it (Phase 1), and each
 * step is dispatched over the relay to drive THIS browser tab (Phase 3). The
 * orchestration lives entirely in {@link usePromptExecution}; this component is
 * the UI shell around it.
 *
 * It renders at the Home route `/prompt-home` (the web Home nav item IS the
 * co-pilot — there is no separate co-pilot page). `/co-pilot` redirects here.
 *
 * Consent gating (Phase 4 — §4.5 of the production-safe plan):
 *   - preference OFF                 → opt-in CTA card → /settings/co-pilot.
 *   - preference ON, consent !granted → "grant consent" affordance that
 *     re-arms the GLOBAL <CoPilotConsentModal> (mounted in the UI Bridge
 *     provider) by resetting the per-session decision to null.
 *   - preference ON, consent granted → the prompt surface.
 *
 * Error affordances: each {@link ExecutionErrorKind} maps to a distinct,
 * actionable card — never a generic toast.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Circle,
  Loader2,
  LogIn,
  RotateCcw,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useCoPilotPreference } from "@/hooks/useCoPilotPreference";
import { useCoPilotSessionConsent } from "@/hooks/useCoPilotSessionConsent";
import { CoPilotReadyStatus } from "@/components/co-pilot/CoPilotReadyStatus";
import { useActiveRunner } from "@/contexts/active-runner-context";
import {
  usePromptExecution,
  type ExecutionErrorKind,
  type StepStatus,
} from "@/lib/co-pilot/usePromptExecution";
import type { PlanStep } from "@/lib/co-pilot/planClient";

// ============================================================================
// Prompt history (localStorage)
// ============================================================================

const HISTORY_KEY = "qontinui_copilot_prompt_history";
const HISTORY_LIMIT = 8;

function readHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function writeHistory(history: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* best-effort */
  }
}

/**
 * MRU prompt history persisted in localStorage. Clicking a chip fills the
 * box (via `onSelect`). No repo-wide `PromptSuggestions` component exists, so
 * this small local one is the canonical implementation for the co-pilot.
 */
function PromptSuggestions({
  history,
  onSelect,
  onClear,
  disabled,
}: {
  history: string[];
  onSelect: (prompt: string) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  if (history.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="co-pilot-prompt-suggestions">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Recent prompts
        </span>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          data-testid="co-pilot-prompt-history-clear"
        >
          <Trash2 className="size-3" aria-hidden />
          Clear
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {history.map((prompt, i) => (
          <button
            key={`${i}-${prompt}`}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(prompt)}
            title={prompt}
            className="max-w-xs truncate rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="co-pilot-prompt-suggestion"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Progress timeline
// ============================================================================

function stepLabel(step: PlanStep): string {
  if (step.type === "navigate") {
    return `Go to ${step.target ?? "page"}`;
  }
  return step.instruction ?? "Action";
}

function StepIcon({ status, active }: { status: StepStatus; active: boolean }) {
  if (status === "done") {
    return <CheckCircle2 className="size-4 text-success" aria-hidden />;
  }
  if (status === "failed") {
    return <XCircle className="size-4 text-destructive" aria-hidden />;
  }
  if (status === "running" || active) {
    return <Loader2 className="size-4 animate-spin text-primary" aria-hidden />;
  }
  if (status === "skipped") {
    return <X className="size-4 text-muted-foreground/50" aria-hidden />;
  }
  return <Circle className="size-4 text-muted-foreground/40" aria-hidden />;
}

function statusBadgeVariant(
  status: StepStatus
): "default" | "secondary" | "destructive" | "success" | "outline" {
  switch (status) {
    case "done":
      return "success";
    case "failed":
      return "destructive";
    case "running":
      return "default";
    case "skipped":
      return "outline";
    case "pending":
    default:
      return "secondary";
  }
}

function ProgressTimeline({
  steps,
  statuses,
  currentStepIndex,
}: {
  steps: PlanStep[];
  statuses: StepStatus[];
  currentStepIndex: number;
}) {
  return (
    <ol className="space-y-2" data-testid="co-pilot-progress">
      {steps.map((step, i) => {
        const status = statuses[i] ?? "pending";
        const active = i === currentStepIndex;
        return (
          <li
            key={i}
            className={
              "flex items-start gap-3 rounded-md border p-3 " +
              (active
                ? "border-primary/50 bg-primary/5"
                : "border-border bg-card")
            }
            data-testid="co-pilot-progress-step"
            data-step-status={status}
          >
            <div className="mt-0.5 shrink-0">
              <StepIcon status={status} active={active} />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {i + 1}. {stepLabel(step)}
                </span>
                <Badge
                  variant={statusBadgeVariant(status)}
                  className="shrink-0 capitalize"
                >
                  {status}
                </Badge>
              </div>
              {step.explanation && (
                <p className="text-xs text-muted-foreground">
                  {step.explanation}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ============================================================================
// Error affordances — one per ExecutionErrorKind
// ============================================================================

function ErrorAffordance({
  kind,
  message,
  onRetry,
  onReConsent,
}: {
  kind: ExecutionErrorKind;
  message: string;
  onRetry: () => void;
  onReConsent: () => void;
}) {
  let title: string;
  let body: string;
  let action: React.ReactNode;

  switch (kind) {
    case "auth-required":
      title = "Your session expired";
      body = "Sign in again to keep using the co-pilot.";
      action = (
        <Button asChild size="sm" variant="default">
          <Link href="/login">
            <LogIn className="size-4" aria-hidden />
            Sign in
          </Link>
        </Button>
      );
      break;
    case "not-consented":
      title = "Consent needed for this tab";
      body =
        "The co-pilot isn't authorized to drive this tab. Grant consent for this session, then retry.";
      action = (
        <Button size="sm" variant="default" onClick={onReConsent}>
          <ShieldCheck className="size-4" aria-hidden />
          Grant consent
        </Button>
      );
      break;
    case "relay-not-connected":
      title = "This tab isn't connected to the co-pilot";
      body =
        "Your consent is granted, but this browser tab isn't connected to the co-pilot relay. Reload the page, then try again.";
      action = (
        <Button
          size="sm"
          variant="default"
          onClick={() => window.location.reload()}
        >
          <RotateCcw className="size-4" aria-hidden />
          Reload page
        </Button>
      );
      break;
    case "rate-limited":
      title = "You're going too fast";
      body = "Too many requests in a short window. Wait a moment, then retry.";
      action = (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden />
          Retry
        </Button>
      );
      break;
    case "no-runner-connected":
      title = "No runner connected";
      body =
        "The co-pilot drives your app through a paired runner. Connect one to run prompts.";
      action = (
        <Button asChild size="sm" variant="default">
          <Link href="/connect-runner">
            <Server className="size-4" aria-hidden />
            Connect a runner
          </Link>
        </Button>
      );
      break;
    case "plan-failed":
      title = "Couldn't plan that prompt";
      body = message;
      action = (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden />
          Try again
        </Button>
      );
      break;
    case "step-failed":
    default:
      title = "A step failed";
      body = message;
      action = (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden />
          Reset and retry
        </Button>
      );
      break;
  }

  const icon =
    kind === "rate-limited" ? (
      <Timer className="size-5 text-destructive" aria-hidden />
    ) : (
      <AlertTriangle className="size-5 text-destructive" aria-hidden />
    );

  return (
    <Card
      className="border-destructive/40"
      data-testid="co-pilot-error"
      data-error-kind={kind}
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">{icon}</div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="mt-1 break-words">
              {body}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">{action}</div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Gate cards
// ============================================================================

function OptInCta() {
  return (
    <Card data-testid="co-pilot-optin-cta">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            <Bot className="size-6 text-primary" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle>Turn on the AI co-pilot</CardTitle>
            <CardDescription className="mt-1">
              Describe what you want to do in plain language and let the AI
              co-pilot navigate and act in this app on your behalf — driven
              through your paired runner. It stays off until you opt in.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href="/settings/co-pilot">
            <Sparkles className="size-4" aria-hidden />
            Enable in settings
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ConsentCta({ onGrant }: { onGrant: () => void }) {
  return (
    <Card data-testid="co-pilot-consent-cta">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            <ShieldCheck className="size-6 text-primary" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle>Grant consent for this session</CardTitle>
            <CardDescription className="mt-1">
              The co-pilot is enabled on your account, but it needs a
              per-session OK before it can drive this tab. This applies to the
              current browser session only.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button onClick={onGrant} data-testid="co-pilot-consent-cta-grant">
          <ShieldCheck className="size-4" aria-hidden />
          Grant consent
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Surface
// ============================================================================

export function CoPilotHome() {
  const preference = useCoPilotPreference();
  const consent = useCoPilotSessionConsent();
  const { activeRunner } = useActiveRunner();
  const { state, run, reset } = usePromptExecution();

  // DEBUG-ONLY: ?bridgeDebug=1 re-exposes co-pilot controls to the UI Bridge for automated end-to-end testing. Off by default (preserves the §8.2 self-targeting guard). Self-scoped + still requires session consent; remove or env-guard once co-pilot E2E is otherwise automatable.
  const bridgeDebug = useSearchParams().get("bridgeDebug") === "1";
  // When debug mode is on, drop the data-bridge-invisible marker so the
  // co-pilot's own controls become bridge-drivable/observable. Default keeps
  // every root wrapper invisible (the §8.2 self-targeting guard).
  const bridgeHidden = bridgeDebug
    ? {}
    : { "data-bridge-invisible": "true" as const };

  const [prompt, setPrompt] = useState("");
  const [explain, setExplain] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  // Load persisted history once on mount (avoids SSR/client mismatch).
  useEffect(() => {
    setHistory(readHistory());
  }, []);

  const pushHistory = useCallback((entry: string) => {
    const trimmed = entry.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const next = [trimmed, ...prev.filter((p) => p !== trimmed)].slice(
        0,
        HISTORY_LIMIT
      );
      writeHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    writeHistory([]);
  }, []);

  const busy = state.phase === "planning" || state.phase === "executing";

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    pushHistory(trimmed);
    void run(trimmed, { explain });
  }, [prompt, busy, explain, pushHistory, run]);

  // Re-arm the GLOBAL <CoPilotConsentModal> (mounted in the UI Bridge
  // provider) by clearing the per-session decision back to null.
  const reConsent = useCallback(() => {
    consent.reset();
  }, [consent]);

  // ---- Gate 1: preference loading ----
  if (preference.isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading co-pilot…
        </div>
      </div>
    );
  }

  // ---- Page header (always shown) ----
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Bot className="size-5 text-primary" aria-hidden />
        <div>
          <h1 className="text-lg font-semibold">AI Co-Pilot</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Describe a task and the co-pilot will plan and run it in this app.
          </p>
        </div>
      </div>
      <CoPilotReadyStatus />
    </div>
  );

  // ---- Bridge-debug sentinel (rendered OUTSIDE any invisible wrapper) ----
  // Lets an automated client confirm debug mode is on via a snapshot.
  const bridgeDebugSentinel = bridgeDebug ? (
    <div data-testid="co-pilot-bridge-debug-active" className="sr-only">
      co-pilot bridge debug mode active
    </div>
  ) : null;

  // ---- Gate 2: preference OFF → opt-in CTA ----
  if (!preference.enabled) {
    return (
      // data-bridge-invisible: the co-pilot only ever drives OTHER pages
      // (after it soft-navigates away), so its OWN surface must never be a
      // bridge target — otherwise the planner can ground steps on this page's
      // controls or "navigate to /prompt-home" from /prompt-home. Marking the
      // root wrapper invisible makes AutoRegister's ancestor walk skip the
      // whole co-pilot surface. Mirrors the guard on CoPilotActiveBanner.tsx.
      // Gated on !bridgeDebug so the debug automator can drive this surface.
      <>
        {bridgeDebugSentinel}
        <div {...bridgeHidden} className="max-w-2xl space-y-6 p-6">
          {header}
          <OptInCta />
        </div>
      </>
    );
  }

  // ---- Gate 3: consent not granted → consent affordance ----
  if (consent.state !== "granted") {
    return (
      // data-bridge-invisible — see the opt-in branch above. Keeps the
      // co-pilot's own surface off the bridge so the planner can't target it.
      <>
        {bridgeDebugSentinel}
        <div {...bridgeHidden} className="max-w-2xl space-y-6 p-6">
          {header}
          <ConsentCta onGrant={reConsent} />
          {/* DEBUG-ONLY consent grant: in bridgeDebug mode a fresh automated
              session has no consent, so the global consent modal's relay
              listener never mounts. This button invokes the SAME per-session
              grant the modal would, letting the automator grant via one bridge
              click. Self-scoped to bridgeDebug. */}
          {bridgeDebug && (
            <Button
              onClick={() => consent.grant()}
              data-testid="co-pilot-debug-grant-consent"
              variant="outline"
            >
              <ShieldCheck className="size-4" aria-hidden />
              Debug: grant session consent
            </Button>
          )}
        </div>
      </>
    );
  }

  // ---- Enabled + consented: the command surface ----
  const error = state.error;
  const steps = state.plan?.steps ?? [];

  return (
    // data-bridge-invisible — see the opt-in branch above. The whole prompt
    // surface (form, summary, step timeline, suggestions, Clear/Run) is kept
    // off the bridge so the planner can never ground a step on the co-pilot's
    // own controls. Gated on !bridgeDebug for automated E2E.
    <>
      {bridgeDebugSentinel}
      <div {...bridgeHidden} className="max-w-2xl space-y-6 p-6">
        {header}

        {/* No runner affordance (non-error pre-flight hint) */}
        {!activeRunner && (
          <Card
            className="border-warning/40"
            data-testid="co-pilot-no-runner-hint"
          >
            <CardHeader>
              <div className="flex items-start gap-3">
                <Server className="mt-0.5 size-5 text-warning" aria-hidden />
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base">
                    No runner connected
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Connect a runner so the co-pilot has a place to act.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button asChild size="sm" variant="outline">
                <Link href="/connect-runner">
                  <Server className="size-4" aria-hidden />
                  Connect a runner
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Prompt box */}
        <Card>
          <CardContent className="space-y-4 pt-0">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter submits.
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="e.g. Create a new workflow and open the canvas"
              rows={3}
              disabled={busy}
              data-testid="co-pilot-prompt-input"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="co-pilot-explain"
                  checked={explain}
                  disabled={busy}
                  onCheckedChange={(next: boolean) => setExplain(next)}
                  data-testid="co-pilot-explain-toggle"
                />
                <Label
                  htmlFor="co-pilot-explain"
                  className="text-sm text-muted-foreground"
                >
                  Explain each step
                </Label>
              </div>

              <div className="flex items-center gap-2">
                {(state.phase !== "idle" || prompt.length > 0) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      reset();
                      setPrompt("");
                    }}
                    data-testid="co-pilot-reset"
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    Clear
                  </Button>
                )}
                <Button
                  onClick={handleSubmit}
                  disabled={busy || prompt.trim().length === 0}
                  data-testid="co-pilot-submit"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Send className="size-4" aria-hidden />
                  )}
                  {state.phase === "planning"
                    ? "Planning…"
                    : state.phase === "executing"
                      ? "Running…"
                      : "Run"}
                </Button>
              </div>
            </div>

            <PromptSuggestions
              history={history}
              onSelect={(p) => setPrompt(p)}
              onClear={clearHistory}
              disabled={busy}
            />
          </CardContent>
        </Card>

        {/* Plan summary */}
        {state.summary && (
          <Card data-testid="co-pilot-summary">
            <CardHeader>
              <div className="flex items-start gap-3">
                <ChevronRight
                  className="mt-0.5 size-5 text-primary"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base">Plan</CardTitle>
                  <CardDescription className="mt-1 break-words">
                    {state.summary}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            {steps.length > 0 && (
              <CardContent>
                <ProgressTimeline
                  steps={steps}
                  statuses={state.stepStatuses}
                  currentStepIndex={state.currentStepIndex}
                />
              </CardContent>
            )}
          </Card>
        )}

        {/* Success */}
        {state.phase === "done" && (
          <Card className="border-success/40" data-testid="co-pilot-done">
            <CardContent className="flex items-center gap-2 pt-0 text-sm text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              {steps.length === 0
                ? "Done — nothing to run for that prompt."
                : "All steps completed."}
            </CardContent>
          </Card>
        )}

        {/* Error affordances */}
        {state.phase === "error" && error && (
          <ErrorAffordance
            kind={error.kind}
            message={error.message}
            onRetry={() => {
              reset();
              handleSubmit();
            }}
            onReConsent={reConsent}
          />
        )}
      </div>
    </>
  );
}

export default CoPilotHome;
