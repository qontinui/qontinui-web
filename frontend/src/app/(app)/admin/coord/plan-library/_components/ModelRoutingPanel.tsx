"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useModelRouting } from "../_hooks/useModelRouting";
import {
  MODEL_FAMILIES,
  MODEL_ROUTING_LEVELS,
  type ModelFamily,
  type ModelRoutingLevel,
  type ModelRoutingUpdate,
} from "../types";

const LEVEL_COPY: Record<ModelRoutingLevel, { label: string; blurb: string }> =
  {
    high: {
      label: "High",
      blurb: "Plans that need the strongest reasoning to vet and implement.",
    },
    medium: {
      label: "Medium",
      blurb: "Plans a mid tier handles well.",
    },
    low: {
      label: "Low",
      blurb: "Small, mechanical plans — a fast tier is enough.",
    },
  };

const isFamily = (value: string): value is ModelFamily =>
  (MODEL_FAMILIES as readonly string[]).includes(value);

/**
 * Which model FAMILY each plan difficulty level routes to — plan
 * `2026-10-08-operator-editable-model-family-per-plan-difficulty`.
 *
 * Only a family is chosen: the harness resolves `opus` to the latest Opus, so
 * a new model release needs no edit here. The consumer is
 * `/vet-imp-sweep --route-by-difficulty`, which reads this map off the
 * plan-library responses it already loads; with the flag off the map is
 * reported, not spent.
 *
 * What is shown beside each select is what the backend SERVES, with whether a
 * stored row or the shipped default answered. The selects are a draft until
 * Save, and after a save the panel shows the backend's own re-read, not what
 * the form sent.
 */
export function ModelRoutingPanel() {
  const {
    routing,
    loading,
    saving,
    error,
    saveError,
    savedAt,
    reload,
    save,
    reset,
  } = useModelRouting();

  // Keyed on the served VALUES, not the object: a refresh that returns the
  // same map must not throw away unsaved edits.
  const servedKey = routing ? JSON.stringify(routing.model_selectors) : null;
  const served = useMemo(
    () =>
      servedKey ? (JSON.parse(servedKey) as Record<string, string>) : null,
    [servedKey]
  );
  const [draft, setDraft] = useState<Record<string, string> | null>(null);

  // Re-seed the draft when what is served CHANGES (first load, a save, a
  // reset, someone else's write) — the form starts from what is served.
  useEffect(() => {
    if (served) setDraft({ ...served });
  }, [served]);

  const canEdit = routing?.can_edit === true;
  const dirty =
    draft != null &&
    served != null &&
    MODEL_ROUTING_LEVELS.some((level) => draft[level] !== served[level]);
  const complete =
    draft != null &&
    MODEL_ROUTING_LEVELS.every((level) => isFamily(draft[level] ?? ""));
  const anyStored =
    routing != null &&
    MODEL_ROUTING_LEVELS.some((level) => routing.sources[level] === "stored");
  const displayOf = (family: string) =>
    routing?.families.find((f) => f.family === family)?.display ?? family;

  const onSave = () => {
    if (!draft || !complete) return;
    const update = Object.fromEntries(
      MODEL_ROUTING_LEVELS.map((level) => [level, draft[level]])
    ) as ModelRoutingUpdate;
    void save(update);
  };

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="model-routing"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Cpu className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Model per plan difficulty</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Which model family vets and implements a plan of each difficulty.
              Pick a family only — the Claude Code Agent tool takes a family
              alias and runs that family&apos;s <strong>latest</strong> model,
              so a new release needs no change here. Read off the plan-library
              responses by <code>/vet-imp-sweep --route-by-difficulty</code> and{" "}
              <code>/plan-triage --route-by-difficulty</code>; without the flag
              a sweep only reports the model a plan would have drawn. A sweep
              already paging when you save sees two different maps and stops
              rather than mixing them — re-run it. The map belongs to your
              account&apos;s plan library, not to the Project selected in the
              sidebar.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void reload()}
          disabled={loading}
          data-testid="model-routing-refresh"
          title="Re-read what is served"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !routing ? (
        <Skeleton className="mt-4 h-28 w-full" />
      ) : !routing || !draft ? (
        <div
          className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="model-routing-unknown"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Couldn&apos;t read the model routing
            {error ? `: ${error}` : ""}. Which model each difficulty routes to
            is unknown — refresh to retry.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2">
            {MODEL_ROUTING_LEVELS.map((level) => {
              const value = draft[level] ?? "";
              const source = routing.sources[level];
              const changed = value !== served?.[level];
              return (
                <div
                  key={level}
                  className="grid items-center gap-2 sm:grid-cols-[7rem_12rem_1fr]"
                  data-testid={`model-routing-row-${level}`}
                >
                  <label
                    htmlFor={`model-routing-${level}`}
                    className="text-xs font-medium"
                  >
                    {LEVEL_COPY[level].label}
                  </label>
                  <select
                    id={`model-routing-${level}`}
                    className="input"
                    value={value}
                    disabled={!canEdit || saving}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...(d ?? {}),
                        [level]: e.target.value,
                      }))
                    }
                    data-testid={`model-routing-select-${level}`}
                  >
                    {/* A served value outside the vocabulary stays visible
                        rather than being silently replaced by the first option. */}
                    {!isFamily(value) && (
                      <option value={value} disabled>
                        {value || "unknown"} (not recognised)
                      </option>
                    )}
                    {MODEL_FAMILIES.map((family) => (
                      <option key={family} value={family}>
                        {displayOf(family)}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{LEVEL_COPY[level].blurb}</span>
                    <Badge
                      variant="outline"
                      data-testid={`model-routing-source-${level}`}
                      title={
                        source === "stored"
                          ? "An operator chose this family."
                          : "No choice recorded — the shipped default is served."
                      }
                    >
                      {source === "stored" ? "set" : (source ?? "unknown")}
                    </Badge>
                    {changed && (
                      <Badge
                        variant="default"
                        data-testid={`model-routing-changed-${level}`}
                      >
                        unsaved
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={onSave}
              disabled={!canEdit || !dirty || !complete || saving}
              data-testid="model-routing-save"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => served && setDraft({ ...served })}
              disabled={!dirty || saving}
              data-testid="model-routing-discard"
            >
              Discard changes
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void reset()}
              disabled={!canEdit || !anyStored || saving}
              data-testid="model-routing-reset"
              title="Delete the stored choices so every level follows the shipped default (which may change in a later release)."
            >
              Reset to defaults
            </Button>
          </div>

          {!canEdit && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="model-routing-readonly"
            >
              Read-only: your account has no personal organization, so its plan
              library is the shared default scope, which always serves the
              default map.
            </p>
          )}

          {savedAt && !dirty && !saveError && (
            <p
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              data-testid="model-routing-saved"
            >
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              Saved at {savedAt.toLocaleTimeString()}. The plan library now
              serves{" "}
              {MODEL_ROUTING_LEVELS.map(
                (level) =>
                  `${level} → ${routing.model_tiers[level] ?? served?.[level]}`
              ).join(", ")}
              .
            </p>
          )}

          {saveError && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="model-routing-save-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Not saved: {saveError}. What is served is unchanged — the badges
                above still describe it.
              </p>
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="model-routing-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Couldn&apos;t re-read the model routing: {error}. Showing the
                last value read — it may be out of date.
              </p>
            </div>
          )}

          {routing.updated_at && (
            <p
              className="text-[11px] text-muted-foreground"
              data-testid="model-routing-updated"
            >
              Last changed {new Date(routing.updated_at).toLocaleString()}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
