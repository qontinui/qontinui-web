"use client";

import { type KeyboardEvent, useId, useRef } from "react";
import { Loader2 } from "lucide-react";
import {
  type AutoFixPrChoice,
  choiceFromTenant,
  tenantSummary,
} from "../_hooks/auto-fix-pr";
import { useAutoFixPrSetting } from "../_hooks/useAutoFixPrSetting";

const CHOICES: { value: AutoFixPrChoice; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

interface FixerSpawnToggleProps {
  canEdit: boolean;
  /**
   * False when the request that carries edit rights (next-step settings) did
   * not load, so the switch is read-only for a reason the operator should see.
   */
  editRightsKnown?: boolean;
  /**
   * coord's `effective_state` for the `pr_fix` autonomy row. Only
   * `not_effective` is a VISIBLE conjunct being off (platform flag off or
   * autonomy not Auto) and earns a note. `unknown` is coord's normal verdict
   * for pr_fix (it carries an unobserved conjunct) and `undefined` means the
   * row did not load — neither may be rendered as "off".
   */
  autonomyState?: "effective" | "not_effective" | "unknown";
}

/**
 * The tenant off-switch for PR fixer sessions (plan
 * `2026-09-12-pr-fixer-spawns-default-on-bounded-and-coordinated-with-the-author`
 * Phase 4b; served policy `agent-spawn-authorization` v11 requires the switch
 * to be reachable in the product, not only through an env var).
 *
 * Three positions because the column has three values: NULL follows the
 * default, true and false are explicit. The "Tenant setting" line is coord's
 * TENANT-level resolution and names the layer that decided it. It is not
 * labelled "Effective": a repo can still opt out, and dispatch also needs the
 * `pr_fix` autonomy row to be effective.
 */
export function FixerSpawnToggle({
  canEdit,
  editRightsKnown = true,
  autonomyState,
}: FixerSpawnToggleProps) {
  const { loading, saving, error, state, setChoice, reload } =
    useAutoFixPrSetting();
  const labelId = useId();
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // ARIA radio pattern with a roving tabindex. Arrow keys MOVE FOCUS only;
  // Space/Enter selects. Selection-follows-focus is deliberately not used:
  // every selection is an immediate write to a fleet spawn switch.
  const onRadioKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const delta =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = (idx + delta + CHOICES.length) % CHOICES.length;
    buttonRefs.current[next]?.focus();
  };

  const unsupported = !loading && !error && state === null;
  const current = state ? choiceFromTenant(state.tenant) : null;
  const summary = state
    ? tenantSummary(state)
    : {
        value: "Unknown (treated as off)",
        tone: "unknown" as const,
        from: error
          ? "the merge settings could not be loaded"
          : "this setting is not available yet",
      };
  // Hard-disabled only when there is nothing to act on. While saving, the
  // buttons stay focusable (aria-disabled) so keyboard focus is not dropped.
  const hardDisabled = !canEdit || loading || state === null;

  return (
    <section
      className="space-y-3"
      data-ui-bridge-id="coordination-fixer-spawn-toggle"
      data-testid="fixer-spawn-toggle"
    >
      <div>
        <h3 className="text-sm font-medium" id={labelId}>
          Spawn fixer sessions for stuck PRs
        </h3>
        <p className="text-xs text-muted-foreground">
          Coord may start fixer sessions for your stuck PRs (red CI, conflicts).
          Bounded by the fleet in-flight cap. Individual repos can also opt out
          with <span className="font-mono">merge.auto_fix_pr: false</span>. This
          switch does not cover the merge shepherd, which escalates PRs coord
          cannot land; that is the separate{" "}
          <span className="font-mono">merge_shepherd</span> agent setting.
        </p>
      </div>

      <div className="rounded-lg border border-border px-4 py-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            className="text-xs text-muted-foreground"
            data-testid="fixer-spawn-tenant-setting"
            aria-live="polite"
          >
            {loading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading…
              </span>
            ) : (
              <>
                Tenant setting:{" "}
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

          <div
            role="radiogroup"
            aria-labelledby={labelId}
            className="inline-flex shrink-0 rounded-md border border-border overflow-hidden"
          >
            {CHOICES.map((opt, idx) => {
              const active = current === opt.value;
              return (
                <button
                  key={opt.value}
                  ref={(el) => {
                    buttonRefs.current[idx] = el;
                  }}
                  type="button"
                  role="radio"
                  tabIndex={active || (current === null && idx === 0) ? 0 : -1}
                  onKeyDown={(e) => onRadioKeyDown(e, idx)}
                  aria-checked={active}
                  aria-disabled={saving || undefined}
                  disabled={hardDisabled}
                  onClick={() => {
                    if (saving || active) return;
                    void setChoice(opt.value);
                  }}
                  data-ui-bridge-id={`coordination-fixer-spawn-${opt.value}`}
                  data-testid={`fixer-spawn-${opt.value}`}
                  className={[
                    "px-3 py-1 text-xs font-medium transition-colors focus:outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    "disabled:pointer-events-none disabled:opacity-50",
                    "aria-disabled:opacity-70",
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

        <p className="text-xs text-muted-foreground">
          Applies immediately. An explicit Off at any scope wins: a repo that
          commits <span className="font-mono">merge.auto_fix_pr: false</span>{" "}
          stays off when this is On, and a repo&apos;s{" "}
          <span className="font-mono">true</span> does not override Off here.
        </p>

        {autonomyState === "not_effective" && (
          <p
            className="text-xs text-yellow-500/80"
            data-testid="fixer-spawn-autonomy-off"
          >
            Fixer dispatch is also off for another reason: the &ldquo;Automatic
            fixer for stuck PRs&rdquo; row under Advanced is not effective
            (platform flag off, or its autonomy is not Auto).
          </p>
        )}

        {!editRightsKnown && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="fixer-spawn-rights-unknown"
          >
            Read-only here: your edit rights could not be determined because the
            coordination settings did not load. Reload the page to try again.
          </p>
        )}

        {unsupported && (
          <p
            className="text-xs text-yellow-500/80"
            data-testid="fixer-spawn-unsupported"
          >
            Not available yet on this server. It becomes settable once
            coordination serves this setting.
          </p>
        )}
        {error && (
          <p className="text-xs text-red-300" data-testid="fixer-spawn-error">
            {error}{" "}
            <button
              type="button"
              onClick={reload}
              className="underline focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="fixer-spawn-retry"
            >
              Retry
            </button>
          </p>
        )}
      </div>
    </section>
  );
}
