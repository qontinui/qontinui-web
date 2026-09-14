"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DevenvApiError,
  getAutoEnrollPolicy,
  setAutoEnrollPolicy,
  type AutoEnrollPolicy,
  type Environment,
} from "@/services/devenv-api";

/**
 * Owner control for connect-time auto-enrollment (plan
 * `2026-08-05-devenv-auto-enrollment-on-connection`, Phase 5).
 *
 * ## Why this panel exists at all
 *
 * Phase 4 shipped an engine that runs inside the device WebSocket handshake
 * and decides, silently, whether a freshly-connected box should become a
 * devenv machine. Every one of its refusals is a debug-level log line on a
 * server the owner cannot read. That is the SAME shape as the hole the plan
 * set out to close — a box that is visibly online and quietly absent from
 * devenv, with nothing anywhere raising its hand — which is why the plan says
 * do not ship Phase 4 without Phase 5.
 *
 * ## The state this panel is really for
 *
 * `enabled` on its own is a comforting half-truth. The engine also has to
 * resolve WHERE a new box lands, and its precedence is: the target stated
 * here, else the owner's single environment, else nothing. So an owner with
 * two environments and no stated target has auto-enrollment "on" and yet every
 * new machine is skipped, forever, with a log line for company.
 *
 * That is why the panel keys its status off `effective_environment_id` — what
 * the engine would ACTUALLY do — rather than off `enabled`, and why
 * {@link autoEnrollStatus} has a distinct `unresolved` state that names the
 * cause and the fix. Rendering that case as a healthy green "on" is the one
 * failure this component must not have.
 *
 * ## And the state that is the DEFAULT on day one
 *
 * The same failure has a second, larger source: `DEVENV_AUTO_ENROLL_ENABLED`
 * ships **false** and is turned on tenant by tenant. So for the entire rollout
 * window the engine returns `disabled_globally` before it reads a single row,
 * while the owner's own `enabled` is true by default — which, keyed off the
 * owner's half alone, renders as green "on" for every owner, everywhere, from
 * the first deploy. `globally_off` is therefore checked FIRST and dominates
 * every other state: nothing below it can be true while the engine is off.
 */

/** Sentinel Select value for "no stated target" (shadcn forbids empty values). */
const NO_TARGET = "__none__";

export type AutoEnrollStatusKind =
  | "globally_off"
  | "off"
  | "active"
  | "unresolved"
  | "no_environments";

export interface AutoEnrollStatus {
  kind: AutoEnrollStatusKind;
  badge: string;
  tone: "success" | "warning" | "secondary";
  /** What is happening, in the owner's terms. */
  message: string;
  /** What to do about it — null when nothing needs doing. */
  action: string | null;
}

/**
 * Turn a policy into the one honest sentence about it.
 *
 * Ordered by what dominates: the site-wide switch makes every owner-level
 * setting moot, a disabled policy makes the target irrelevant, an owner with no
 * environments has nowhere to put a machine regardless of the target, and only
 * then does the resolved/unresolved distinction matter.
 */
export function autoEnrollStatus(policy: AutoEnrollPolicy): AutoEnrollStatus {
  if (!policy.globally_enabled) {
    return {
      kind: "globally_off",
      badge: "not switched on yet",
      tone: "secondary",
      message:
        "Automatic enrollment is not switched on for this site yet, so no machine is being enrolled on its own — whatever the settings below say. They are saved and take effect when it is switched on.",
      // Nothing for the owner to do: this is an operator-side rollout switch
      // with no route that would let them change it. Inventing an action here
      // would be worse than none.
      action: null,
    };
  }
  if (!policy.enabled) {
    return {
      kind: "off",
      badge: "off",
      tone: "secondary",
      message:
        "New machines are never enrolled on their own. Every machine here got here because someone added it.",
      action: null,
    };
  }
  if (policy.environment_count === 0) {
    return {
      kind: "no_environments",
      badge: "nothing to join",
      tone: "warning",
      message:
        "Auto-enrollment is on, but you have no environments yet — so a machine that connects has nowhere to be enrolled into, and is skipped.",
      action: "Create an environment to give new machines somewhere to land.",
    };
  }
  if (policy.effective_environment_id === null) {
    return {
      kind: "unresolved",
      badge: "no target set",
      tone: "warning",
      message: `Auto-enrollment is on, but you have ${policy.environment_count} environments and have not said which one new machines join. Rather than guess, the server skips them — so machines are being missed for exactly this reason, and will keep being missed until a target is chosen.`,
      action: "Choose the environment new machines should join, below.",
    };
  }
  return {
    kind: "active",
    badge: "on",
    tone: "success",
    message:
      "A paired machine that connects and has no devenv record is enrolled automatically, into the environment below.",
    action: null,
  };
}

interface AutoEnrollPolicyPanelProps {
  /** The owner's environments, for the target picker. */
  environments: Environment[];
  /** Called after a successful save (a new machine may now be enrollable). */
  onSaved?: (policy: AutoEnrollPolicy) => void;
}

export function AutoEnrollPolicyPanel({
  environments,
  onSaved,
}: AutoEnrollPolicyPanelProps) {
  const [policy, setPolicy] = useState<AutoEnrollPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftTarget, setDraftTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAutoEnrollPolicy();
      setPolicy(data);
      setDraftEnabled(data.enabled);
      setDraftTarget(data.target_environment_id);
      setLoadError(null);
    } catch (err) {
      // A failed read must NOT render as "auto-enrollment is off" — that is a
      // claim about the server we have no evidence for, and the wrong one is
      // reassuring. Say we could not ask.
      setLoadError(
        err instanceof DevenvApiError || err instanceof Error
          ? err.message
          : "Failed to load the auto-enrollment policy"
      );
      setPolicy(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await setAutoEnrollPolicy({
        enabled: draftEnabled,
        target_environment_id: draftTarget,
      });
      setPolicy(saved);
      setDraftEnabled(saved.enabled);
      setDraftTarget(saved.target_environment_id);
      toast.success(
        saved.enabled
          ? "Auto-enrollment settings saved"
          : "Auto-enrollment turned off"
      );
      onSaved?.(saved);
    } catch (err) {
      toast.error(
        err instanceof DevenvApiError || err instanceof Error
          ? err.message
          : "Failed to save the auto-enrollment policy"
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground"
        data-testid="auto-enroll-loading"
      >
        <Loader2 className="size-4 animate-spin" />
        Loading auto-enrollment settings…
      </div>
    );
  }

  if (loadError || policy === null) {
    return (
      <div
        className="rounded-lg border border-border px-4 py-3"
        data-testid="auto-enroll-load-error"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm">
              Couldn&apos;t read your auto-enrollment settings, so this page
              can&apos;t say whether machines are being enrolled on their own.
              Nothing has been changed.
            </p>
            <p className="text-xs text-muted-foreground mt-1">{loadError}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto shrink-0"
            onClick={load}
          >
            <RefreshCw className="size-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const status = autoEnrollStatus(policy);
  const dirty =
    draftEnabled !== policy.enabled ||
    draftTarget !== policy.target_environment_id;

  return (
    <div
      className="rounded-lg border border-border"
      data-testid="auto-enroll-panel"
      data-status={status.kind}
    >
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Automatic enrollment</h3>
          <Badge variant={status.tone} data-testid="auto-enroll-status-badge">
            {status.badge}
          </Badge>
        </div>
        <p
          className="text-xs text-muted-foreground mt-1"
          data-testid="auto-enroll-status-message"
        >
          {status.message}
        </p>
        {status.action && (
          <p
            className="text-xs font-medium mt-1"
            data-testid="auto-enroll-status-action"
          >
            {status.action}
          </p>
        )}
      </div>
      <div className="p-4 space-y-3">
        <label
          className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
          htmlFor="auto-enroll-enabled"
        >
          <Switch
            id="auto-enroll-enabled"
            data-testid="auto-enroll-enabled"
            checked={draftEnabled}
            onCheckedChange={setDraftEnabled}
          />
          <span className="text-sm">
            Enroll a paired machine when it connects
            {!draftEnabled && (
              <span className="text-muted-foreground"> — currently off</span>
            )}
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">New machines join</span>
          <Select
            value={draftTarget ?? NO_TARGET}
            onValueChange={(value) =>
              setDraftTarget(value === NO_TARGET ? null : value)
            }
            disabled={saving}
          >
            <SelectTrigger
              className="w-64"
              aria-label="Environment new machines join"
            >
              <SelectValue placeholder="No environment chosen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TARGET}>No environment chosen</SelectItem>
              {environments.map((env) => (
                <SelectItem key={env.id} value={env.id}>
                  {env.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* The fallback is stated rather than left to be discovered: with one
              environment, no choice is needed and the picker looks
              alarmingly empty otherwise. */}
          {draftTarget === null && policy.environment_count === 1 && (
            <span className="text-xs text-muted-foreground">
              With one environment, new machines join it without a choice here.
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="brand-primary"
            size="sm"
            disabled={!dirty || saving}
            onClick={handleSave}
            data-testid="auto-enroll-save"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
          {!policy.configured && (
            <span className="text-xs text-muted-foreground">
              You have never changed these — they are the defaults.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
