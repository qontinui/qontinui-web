"use client";

import { Loader2 } from "lucide-react";
import {
  type AutoFixPrChoice,
  choiceFromTenant,
  effectiveSummary,
} from "../_hooks/auto-fix-pr";
import { useAutoFixPrSetting } from "../_hooks/useAutoFixPrSetting";

const CHOICES: { value: AutoFixPrChoice; label: string }[] = [
  { value: "default", label: "Default (on)" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

interface FixerSpawnToggleProps {
  canEdit: boolean;
}

/**
 * The tenant off-switch for PR fixer sessions, rendered beside the `pr_fix`
 * autonomy row (plan
 * `2026-09-12-pr-fixer-spawns-default-on-bounded-and-coordinated-with-the-author`
 * Phase 4b; served policy `agent-spawn-authorization` v11 requires the switch
 * to be reachable in the product, not only through an env var).
 *
 * Three positions because the column has three values: NULL follows the
 * default, true and false are explicit. The effective line is coord's
 * resolution and names the layer that decided it, so an operator who picks
 * "On" and still reads "Off — from a repo's .qontinui/config.yml" is told
 * why rather than left to guess.
 */
export function FixerSpawnToggle({ canEdit }: FixerSpawnToggleProps) {
  const { loading, saving, error, state, setChoice } = useAutoFixPrSetting();

  const unsupported = !loading && !error && state === null;
  const current = state ? choiceFromTenant(state.tenant) : null;
  const summary = state
    ? effectiveSummary(state)
    : {
        value: "Unknown (treated as off)",
        tone: "unknown" as const,
        from: error
          ? "the merge settings could not be loaded"
          : "this coord build does not serve the setting yet",
      };
  const controlsDisabled = !canEdit || saving || loading || state === null;

  return (
    <div
      className="px-4 py-3 space-y-2 bg-muted/20"
      data-ui-bridge-id="coordination-fixer-spawn-toggle"
      data-testid="fixer-spawn-toggle"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-0.5">
          <span className="text-sm font-medium" id="fixer-spawn-label">
            Spawn fixer sessions for stuck PRs
          </span>
          <p className="text-xs text-muted-foreground">
            Coord may start fixer sessions for your stuck PRs (red CI,
            conflicts). Bounded by the fleet in-flight cap. Individual repos can
            also opt out with{" "}
            <span className="font-mono">merge.auto_fix_pr: false</span>.
          </p>
        </div>

        <div
          role="group"
          aria-labelledby="fixer-spawn-label"
          className="inline-flex shrink-0 rounded-md border border-border overflow-hidden"
        >
          {CHOICES.map((opt, idx) => {
            const active = current === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                disabled={controlsDisabled}
                onClick={() => {
                  if (!active) void setChoice(opt.value);
                }}
                data-ui-bridge-id={`coordination-fixer-spawn-${opt.value}`}
                data-testid={`fixer-spawn-${opt.value}`}
                className={[
                  "px-3 py-1 text-xs font-medium transition-colors focus:outline-none",
                  "disabled:pointer-events-none disabled:opacity-50",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  idx > 0 ? "border-l border-border" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <p
        className="text-xs text-muted-foreground"
        data-testid="fixer-spawn-effective"
      >
        {loading ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading…
          </span>
        ) : (
          <>
            Effective:{" "}
            <span
              className={
                summary.tone === "on"
                  ? "text-green-500"
                  : summary.tone === "off"
                    ? "text-foreground"
                    : "text-yellow-500/80"
              }
            >
              {summary.value}
            </span>{" "}
            — from {summary.from}.{saving && " Saving…"}
          </>
        )}
      </p>

      <p className="text-xs text-muted-foreground">
        Applies immediately. An explicit Off at any scope wins: a repo that
        commits <span className="font-mono">merge.auto_fix_pr: false</span>{" "}
        stays off when this is On, and a repo&apos;s{" "}
        <span className="font-mono">true</span> does not override Off here.
      </p>

      {unsupported && (
        <p
          className="text-xs text-yellow-500/80"
          data-testid="fixer-spawn-unsupported"
        >
          Not settable on this coord build: the column exists
          (qontinui-web#1326), but coord&apos;s settings API does not serve{" "}
          <span className="font-mono">auto_fix_pr</span> yet. Shown so the
          switch is discoverable; it goes live by itself once coord serves it.
        </p>
      )}
      {error && (
        <p className="text-xs text-red-300" data-testid="fixer-spawn-error">
          {error}
        </p>
      )}
    </div>
  );
}
