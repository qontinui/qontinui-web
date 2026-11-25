"use client";

/**
 * The work-unit page's "Schedule" panel — where a person enters the phases,
 * phase-to-unit links, milestone link and planned dates the Project Overview
 * derives its Timeline from.
 *
 * Plan `2026-11-25-overview-timeline-and-milestones-derive-from-coord`
 * Phase 5. The Overview has no entered value, no overlay and no pin (D5): a
 * wrong or missing figure is corrected HERE, at its source in coord, on the
 * page that already holds this unit's status. Saving writes through
 * `PATCH /plans/{slug}/schedule-metadata` to coord's operator door, which
 * owns the closed key set and every validation; its refusal text is shown
 * verbatim.
 *
 * Collapsed by default (R7): it is supporting material, and its summary says
 * how many phases are declared without opening it.
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CollapsiblePanel } from "@/components/console";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import {
  patchPlanScheduleMetadata,
  type CoordWorkUnit,
} from "@/lib/api/operations/coordPlans";
import {
  buildSchedulePatch,
  draftFromMetadata,
  draftIsUnchanged,
  validateDraft,
  type PhaseDraft,
  type ScheduleDraft,
} from "../_lib/scheduleDraft";

const EMPTY_PHASE: PhaseDraft = {
  index: "",
  name: "",
  milestone: "",
  plannedStart: "",
  plannedEnd: "",
  units: "",
};

interface SchedulePanelProps {
  slug: string;
  plan: CoordWorkUnit;
  /** Re-read the unit after a save so the panel shows what coord now holds. */
  onSaved: () => Promise<void> | void;
}

export function SchedulePanel({ slug, plan, onSaved }: SchedulePanelProps) {
  // Keyed on the CONTENT of the stored metadata, not its object identity: every
  // refetch (a status transition re-reads the unit) hands back a new object,
  // and keying on identity would wipe an operator's unsaved edits each time.
  const storedKey = JSON.stringify(plan.metadata ?? null);
  const stored = useMemo(
    () => draftFromMetadata(plan.metadata),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see storedKey
    [storedKey]
  );
  const [draft, setDraft] = useState<ScheduleDraft>(stored);
  const [saving, setSaving] = useState(false);

  // What coord holds changed (a save landed, or another operator wrote), or
  // the route moved to another unit: the draft restarts from it, so the panel
  // never shows an edit coord does not hold as if it did.
  useEffect(() => {
    setDraft(stored);
  }, [stored, slug]);

  const problems = useMemo(() => validateDraft(draft), [draft]);
  const unchanged = useMemo(
    () => draftIsUnchanged(draft, plan.metadata),
    [draft, plan.metadata]
  );

  const setPhase = (i: number, patch: Partial<PhaseDraft>) =>
    setDraft((d) => ({
      ...d,
      phases: d.phases.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    }));

  const addPhase = () =>
    setDraft((d) => {
      const used = d.phases
        .map((p) => Number(p.index))
        .filter((n) => Number.isInteger(n));
      const next = used.length > 0 ? Math.max(...used) + 1 : 1;
      return {
        ...d,
        phases: [...d.phases, { ...EMPTY_PHASE, index: String(next) }],
      };
    });

  const removePhase = (i: number) =>
    setDraft((d) => ({ ...d, phases: d.phases.filter((_, j) => j !== i) }));

  const onSave = async () => {
    if (problems.length > 0) return;
    setSaving(true);
    try {
      await patchPlanScheduleMetadata(slug, {
        metadata_patch: { ...buildSchedulePatch(draft) },
        from_updated_at: plan.updated_at ?? undefined,
      });
      toast.success("Schedule saved");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  };

  const declared = stored.phases.length;

  return (
    <CollapsiblePanel
      titleAs="h2"
      className="p-3"
      defaultOpen={false}
      storageKey="coord-plan-schedule"
      icon={<CalendarRange className="h-3.5 w-3.5" />}
      title="Schedule"
      summary={
        <Badge
          variant="outline"
          className="font-mono text-[11px]"
          title="Phases coord holds for this work unit"
        >
          {declared === 0 ? "no phases" : `${declared} phases`}
        </Badge>
      }
      data-testid="coord-plan-schedule"
      data-ui-bridge-id="coord-plan-schedule"
    >
      <p className="mb-2 text-xs text-muted-foreground">
        The Project Overview shows exactly what is entered here and nothing
        else. A phase with no linked unit and no dates is shown as not
        confirmed, not as planned.
      </p>
      <CoordAdminOnly
        fallback={
          <ReadOnlyNotice label="The schedule can be changed by administrators only." />
        }
      >
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table
              className="w-full text-xs"
              data-testid="coord-plan-schedule-phases"
              data-ui-bridge-id="coord-plan-schedule-phases"
            >
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pr-2 font-normal">Index</th>
                  <th className="pr-2 font-normal">Phase name</th>
                  <th className="pr-2 font-normal">Milestone</th>
                  <th className="pr-2 font-normal">Planned start</th>
                  <th className="pr-2 font-normal">Planned end</th>
                  <th className="pr-2 font-normal">Linked work units</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.phases.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-2 italic text-muted-foreground"
                      data-testid="coord-plan-schedule-empty"
                    >
                      No phases are entered for this work unit.
                    </td>
                  </tr>
                )}
                {draft.phases.map((p, i) => (
                  <tr key={i} data-testid="coord-plan-schedule-phase-row">
                    <td className="pr-2 py-0.5">
                      <Input
                        className="h-7 w-14"
                        inputMode="numeric"
                        value={p.index}
                        onChange={(e) => setPhase(i, { index: e.target.value })}
                        aria-label={`Phase ${i + 1} index`}
                        data-testid="coord-plan-schedule-index"
                        data-ui-bridge-id={`coord-plan-schedule-index-${i}`}
                      />
                    </td>
                    <td className="pr-2 py-0.5">
                      <Input
                        className="h-7 min-w-[140px]"
                        value={p.name}
                        onChange={(e) => setPhase(i, { name: e.target.value })}
                        aria-label={`Phase ${i + 1} name`}
                        data-testid="coord-plan-schedule-name"
                        data-ui-bridge-id={`coord-plan-schedule-name-${i}`}
                      />
                    </td>
                    <td className="pr-2 py-0.5">
                      <Input
                        className="h-7 w-24"
                        placeholder="e.g. V1"
                        value={p.milestone}
                        onChange={(e) =>
                          setPhase(i, { milestone: e.target.value })
                        }
                        aria-label={`Phase ${i + 1} milestone`}
                        data-testid="coord-plan-schedule-milestone"
                        data-ui-bridge-id={`coord-plan-schedule-milestone-${i}`}
                      />
                    </td>
                    <td className="pr-2 py-0.5">
                      <Input
                        className="h-7 w-[120px]"
                        placeholder="2026-12-01"
                        value={p.plannedStart}
                        onChange={(e) =>
                          setPhase(i, { plannedStart: e.target.value })
                        }
                        aria-label={`Phase ${i + 1} planned start`}
                        data-testid="coord-plan-schedule-start"
                        data-ui-bridge-id={`coord-plan-schedule-start-${i}`}
                      />
                    </td>
                    <td className="pr-2 py-0.5">
                      <Input
                        className="h-7 w-[120px]"
                        placeholder="2026-12-18"
                        value={p.plannedEnd}
                        onChange={(e) =>
                          setPhase(i, { plannedEnd: e.target.value })
                        }
                        aria-label={`Phase ${i + 1} planned end`}
                        data-testid="coord-plan-schedule-end"
                        data-ui-bridge-id={`coord-plan-schedule-end-${i}`}
                      />
                    </td>
                    <td className="pr-2 py-0.5">
                      <Input
                        className="h-7 min-w-[200px] font-mono"
                        placeholder="work-unit slugs, comma separated"
                        value={p.units}
                        onChange={(e) => setPhase(i, { units: e.target.value })}
                        aria-label={`Phase ${i + 1} linked work units`}
                        data-testid="coord-plan-schedule-units"
                        data-ui-bridge-id={`coord-plan-schedule-units-${i}`}
                      />
                    </td>
                    <td className="py-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removePhase(i)}
                        aria-label={`Remove phase ${i + 1}`}
                        data-testid="coord-plan-schedule-remove"
                        data-ui-bridge-id={`coord-plan-schedule-remove-${i}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={addPhase}
            data-testid="coord-plan-schedule-add"
            data-ui-bridge-id="coord-plan-schedule-add"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add phase
          </Button>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                parent work unit
              </label>
              <Input
                className="h-8 min-w-[220px] font-mono"
                placeholder="slug of the programme this unit belongs to"
                value={draft.parent}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, parent: e.target.value }))
                }
                data-testid="coord-plan-schedule-parent"
                data-ui-bridge-id="coord-plan-schedule-parent"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                parent phase index
              </label>
              <Input
                className="h-8 w-24"
                inputMode="numeric"
                value={draft.parentPhase}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, parentPhase: e.target.value }))
                }
                data-testid="coord-plan-schedule-parent-phase"
                data-ui-bridge-id="coord-plan-schedule-parent-phase"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                initiative document
              </label>
              <Input
                className="h-8 min-w-[220px] font-mono"
                placeholder="initiative/current-initiative"
                value={draft.intentInitiative}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, intentInitiative: e.target.value }))
                }
                data-testid="coord-plan-schedule-initiative"
                data-ui-bridge-id="coord-plan-schedule-initiative"
              />
            </div>
          </div>

          {problems.length > 0 && (
            <ul
              className="list-disc pl-5 text-xs text-destructive"
              data-testid="coord-plan-schedule-problems"
            >
              {problems.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}

          <Button
            onClick={onSave}
            disabled={saving || problems.length > 0 || unchanged}
            data-testid="coord-plan-schedule-save"
            data-ui-bridge-id="coord-plan-schedule-save"
          >
            {saving ? "Saving..." : "Save schedule"}
          </Button>
        </div>
      </CoordAdminOnly>
    </CollapsiblePanel>
  );
}
