"use client";

import { useEffect, useRef, useState } from "react";
import { CollapsiblePanel } from "@/components/console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TasteBudget, TastePool } from "@/lib/api/taste";

/** The batch size the build button asks for. */
export const CALIBRATION_BATCH_SIZE = 20;

/**
 * The calibration batch, the operator's reference uploads and the weekly
 * budget (step 3 and the budget setting of step 2). Secondary material, so it
 * collapses (R7) — but its signal does not: the summary line says how big
 * the pool is and how many directions it spans even while closed.
 */
export function SetupPanel({
  pool,
  budget,
  canLabel,
  busy,
  onBuild,
  onUpload,
  onBudget,
}: {
  pool: TastePool | null;
  budget: TasteBudget | null;
  canLabel: boolean;
  busy: boolean;
  onBuild: (size: number) => void;
  onUpload: (files: File[]) => void;
  onBudget: (weekly: number) => void;
}) {
  const [budgetInput, setBudgetInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // Follow the stored VALUE, not the read: every write re-reads the inbox,
  // and resetting on each new object would wipe a number being typed.
  const storedWeekly = budget?.weekly_budget;
  useEffect(() => {
    if (storedWeekly !== undefined) setBudgetInput(String(storedWeekly));
  }, [storedWeekly]);
  const parsed = Number(budgetInput);
  const budgetValid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000;

  const summary = pool
    ? `${pool.images} ${pool.images === 1 ? "image" : "images"} across ${pool.directions.length} ${pool.directions.length === 1 ? "direction" : "directions"}`
    : "pool unknown";

  return (
    <CollapsiblePanel
      title="Calibration and budget"
      summary={summary}
      storageKey="coord-taste-setup"
      data-testid="taste-setup"
    >
      <div className="space-y-4 text-sm">
        <div className="space-y-2">
          <p className="text-muted-foreground">
            The first batch pairs this project&apos;s own images across their
            declared directions — different directions first — so early labels
            cover the most ground. Your own references join the pool as their
            own direction. Building again only adds pairs not yet asked.
          </p>
          {pool && pool.directions.length > 0 && (
            <ul
              className="flex flex-wrap gap-2"
              data-testid="taste-pool-directions"
            >
              {pool.directions.map((d) => (
                <li
                  key={d.direction}
                  className="rounded border border-border px-2 py-0.5 font-mono text-xs"
                >
                  {d.direction} {d.images}
                </li>
              ))}
            </ul>
          )}
          {canLabel && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || pool === null}
                onClick={() => onBuild(CALIBRATION_BATCH_SIZE)}
                data-testid="taste-build-batch"
              >
                Build a calibration batch of {CALIBRATION_BATCH_SIZE}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length) onUpload(files);
                }}
                data-testid="taste-reference-input"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                data-testid="taste-upload-references"
              >
                Upload reference images
              </Button>
            </div>
          )}
        </div>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (budgetValid) onBudget(parsed);
          }}
        >
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>
              Weekly budget —{" "}
              {budget
                ? budget.source === "default"
                  ? "the default; none set for this project"
                  : "set for this project"
                : "unknown"}
            </span>
            <Input
              type="number"
              min={1}
              max={1000}
              value={budgetInput}
              disabled={!canLabel || busy}
              onChange={(e) => setBudgetInput(e.target.value)}
              className="w-28"
              data-testid="taste-budget-input"
            />
          </label>
          {canLabel && (
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={
                busy || !budgetValid || parsed === budget?.weekly_budget
              }
              data-testid="taste-budget-save"
            >
              Save budget
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            How many labels the inbox asks for in a week (Monday to Sunday,
            UTC).
          </span>
        </form>
      </div>
    </CollapsiblePanel>
  );
}
