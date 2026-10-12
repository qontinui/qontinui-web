"use client";

/**
 * The page-scoped filter bar on `/admin/coord/plans`: status class, "needs a
 * /vet-imp", "document only" and difficulty — all CLIENT-side, and labelled
 * as filtering THIS PAGE ONLY.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phases 1,
 * 3 and 5, composed into one bar so the class filter and the difficulty
 * filter do not collide (Phase 3's sequencing note).
 *
 * The chip counts are counts over the rows on this page, and the strip's
 * label says so. The vet-imp chip also carries the number of rows the
 * predicate could not decide, because an attested plan whose vet freshness
 * is unknown is not a "no".
 */

import { Layers, SignalHigh } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterChips } from "@/components/console";
import {
  DIFFICULTY_FILTERS,
  type DifficultyFilter,
  type DifficultyIndex,
} from "@/components/admin/coord/planDifficulty";
import { STATUS_CLASS_FILTERS, type StatusClassFilter } from "./statusClass";
import type { PageChipCounts, PageFilters, RowChip } from "./rowFilters";
import type { DeriveModeReading } from "./deriveMode";

export const PAGE_ONLY_NOTE = "filters this page only";

export function PlanPageFilters({
  filters,
  onChange,
  counts,
  difficulty,
  deriveMode,
}: {
  filters: PageFilters;
  onChange: (next: PageFilters) => void;
  counts: PageChipCounts;
  difficulty: DifficultyIndex;
  deriveMode: DeriveModeReading;
}) {
  const difficultyLoaded = difficulty.state === "loaded";
  const toggleChip = (chip: RowChip) =>
    onChange({
      ...filters,
      chips: filters.chips.includes(chip)
        ? filters.chips.filter((c) => c !== chip)
        : [...filters.chips, chip],
    });

  return (
    <div className="space-y-1.5" data-testid="coord-plans-page-filters">
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
        <Select
          value={filters.statusClass}
          onValueChange={(v) =>
            onChange({ ...filters, statusClass: v as StatusClassFilter })
          }
        >
          <SelectTrigger
            className="w-[230px]"
            data-testid="coord-plans-status-class-select"
            title={`coord's derived status class (axis A) — ${PAGE_ONLY_NOTE}. The route takes no class parameter.`}
          >
            <SelectValue placeholder="status class" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_CLASS_FILTERS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <SignalHigh className="h-4 w-4 text-muted-foreground" aria-hidden />
        <Select
          value={difficultyLoaded ? filters.difficulty : "any"}
          onValueChange={(v) =>
            onChange({ ...filters, difficulty: v as DifficultyFilter })
          }
          disabled={!difficultyLoaded}
        >
          <SelectTrigger
            className="w-[180px]"
            data-testid="coord-plans-difficulty-select"
            title={
              difficulty.state === "failed"
                ? `Difficulty ratings could not be read: ${difficulty.reason}`
                : difficulty.state === "pending"
                  ? "Difficulty ratings are still loading."
                  : `The plan library's difficulty rating — ${PAGE_ONLY_NOTE}. Unrated is not low.`
            }
          >
            <SelectValue placeholder="difficulty" />
          </SelectTrigger>
          <SelectContent>
            {DIFFICULTY_FILTERS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <FilterChips<RowChip>
          label={`Show only (${PAGE_ONLY_NOTE})`}
          options={[
            {
              value: "needs_vet_imp",
              label: "Needs a /vet-imp",
              count: counts.needs_vet_imp,
              title:
                "status class free_known, OR attested with vet freshness moved/gone. " +
                `${counts.vet_imp_undetermined} row(s) on this page could not be decided and are not counted.`,
            },
            {
              value: "document_only",
              label: "Document only (no coord unit)",
              count: counts.document_only,
              title:
                "A plan-library document with no coord work unit — a hand-POSTed or agent-captured orphan, never conflated with a joined row.",
            },
          ]}
          selected={filters.chips}
          onToggle={toggleChip}
          onClear={() => onChange({ ...filters, chips: [] })}
          allLabel="all rows"
          testIdPrefix="coord-plans-chips"
        />
      </div>

      {counts.vet_imp_undetermined > 0 && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-plans-vet-imp-undetermined"
        >
          {counts.vet_imp_undetermined} row
          {counts.vet_imp_undetermined === 1 ? "" : "s"} on this page could not
          be decided for &ldquo;needs a /vet-imp&rdquo; (class or vet freshness
          UNKNOWN) — they are neither counted nor excluded as &ldquo;no&rdquo;.
        </p>
      )}

      {deriveMode.caveat !== null && (
        <p
          className="text-xs text-amber-200"
          data-testid="coord-plans-derive-mode-caveat"
          data-derive-mode={deriveMode.kind}
        >
          {deriveMode.caveat}
        </p>
      )}
    </div>
  );
}
