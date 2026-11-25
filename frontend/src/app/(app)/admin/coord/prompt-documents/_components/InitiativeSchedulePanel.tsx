"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchPlans, planRowsOf } from "@/lib/api/operations/coordPlans";
import { fetchGatesList } from "@/lib/api/operations/coordGates";
import {
  applySchedule,
  blankMilestone,
  draftFromBody,
  readSchedule,
  validDate,
  type CalendarBreakEntry,
  type MilestoneEntry,
  type ScheduleDraft,
} from "../_lib/initiativeSchedule";

interface InitiativeSchedulePanelProps {
  /** The document body as it stands in the editor (the single source of truth). */
  body: string;
  /** Hands the rewritten body back; the dialog's own Save persists it. */
  onBodyChange: (next: string) => void;
  disabled?: boolean;
}

const WORK_UNIT_LIST = "initiative-schedule-work-units";
const GATE_LIST = "initiative-schedule-gates";

/**
 * Structured entry of the project's milestones, dates and forecast calendar, for
 * an initiative-kind document (plan
 * `2026-11-25-overview-timeline-and-milestones-derive-from-coord`, Phase 7).
 *
 * The Project Overview is derived only from coord: it holds no copy of these
 * values and has no override. This panel edits the initiative document's
 * `milestones:` / `calendar:` / `programme:` frontmatter blocks inside the same
 * editor body, and the dialog's existing Save (`PATCH
 * /coord/prompt-documents/{kind}/{name}`) writes them, so coord versions and
 * attributes each change. The raw body editor stays beside it.
 *
 * The preview runs the TypeScript twin of the parser the overview reads with
 * (parity pinned by one shared fixture file), so an unreadable row is listed
 * here exactly as the overview will list it, and nothing is repaired.
 */
export function InitiativeSchedulePanel({
  body,
  onBodyChange,
  disabled = false,
}: InitiativeSchedulePanelProps) {
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftFromBody(body));
  // The last body this panel produced: a `body` that differs came from the raw
  // editor (or a reload) and re-seeds the draft; our own echo must not, or a
  // trailing space typed in a name would be trimmed away mid-keystroke.
  const emitted = useRef(body);

  useEffect(() => {
    if (body !== emitted.current) {
      emitted.current = body;
      setDraft(draftFromBody(body));
    }
  }, [body]);

  const update = (next: ScheduleDraft) => {
    setDraft(next);
    const nextBody = applySchedule(body, next);
    emitted.current = nextBody;
    onBodyChange(nextBody);
  };

  const preview = useMemo(() => readSchedule(body), [body]);

  const [workUnits, setWorkUnits] = useState<string[]>([]);
  const [gates, setGates] = useState<string[]>([]);
  const [pickersFailed, setPickersFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const query = new URLSearchParams({ limit: "500" });
        const [plans, gateList] = await Promise.all([
          fetchPlans(query),
          fetchGatesList(),
        ]);
        if (cancelled) return;
        setWorkUnits(planRowsOf(plans).map((row) => row.slug));
        const rows = Array.isArray(gateList)
          ? gateList
          : (gateList.gates ?? []);
        setGates(rows.map((g) => g.gate_id));
      } catch {
        // Suggestions only: the fields stay typeable, nothing is guessed.
        if (!cancelled) setPickersFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMilestone = (index: number, patch: Partial<MilestoneEntry>) => {
    const milestones = draft.milestones.map((m, i) =>
      i === index ? { ...m, ...patch } : m
    );
    update({ ...draft, milestones });
  };

  const setBreak = (index: number, patch: Partial<CalendarBreakEntry>) => {
    if (!draft.calendar) return;
    const breaks = draft.calendar.breaks.map((b, i) =>
      i === index ? { ...b, ...patch } : b
    );
    update({ ...draft, calendar: { ...draft.calendar, breaks } });
  };

  const unreadableTotal =
    preview.milestonesUnreadable.length + preview.calendarUnreadable.length;

  return (
    <section
      className="space-y-4 rounded-md border border-border p-3"
      data-testid="initiative-schedule-panel"
      data-ui-bridge-id="coord.prompt-documents.schedule-panel"
    >
      <header className="flex items-start gap-2">
        <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-medium">Schedule</h3>
          <p className="text-xs text-muted-foreground">
            Milestones, dates and the forecast calendar the project Overview
            reads from this document. The Overview holds no copy of them: change
            one here, save, and it follows on its next read. The body below is
            rewritten as you edit; Save writes it as a new version.
          </p>
        </div>
      </header>

      <div className="space-y-1">
        <Label htmlFor="schedule-programme">Programme (work unit slug)</Label>
        <Input
          id="schedule-programme"
          data-testid="schedule-programme"
          data-ui-bridge-id="coord.prompt-documents.schedule.programme"
          list={WORK_UNIT_LIST}
          value={draft.programme}
          disabled={disabled}
          onChange={(e) => update({ ...draft, programme: e.target.value })}
          placeholder="Optional: the unit that is this project's programme plan"
          className="max-w-md"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Milestones
          </h4>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={disabled}
            data-testid="schedule-add-milestone"
            data-ui-bridge-id="coord.prompt-documents.schedule.add-milestone"
            onClick={() =>
              update({
                ...draft,
                milestones: [...draft.milestones, blankMilestone()],
              })
            }
          >
            <Plus className="size-3.5" />
            Add milestone
          </Button>
        </div>
        {!preview.listPresent && draft.milestones.length > 0 ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="schedule-legacy-table-note"
          >
            These rows were read from this document&apos;s markdown table. The
            first edit here writes them as a frontmatter list, which then takes
            over from the table.
          </p>
        ) : null}
        {draft.milestones.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No milestones declared in this document.
          </p>
        ) : null}
        {draft.milestones.map((m, i) => {
          const dateBad = m.date.trim() !== "" && validDate(m.date) === null;
          return (
            <div
              key={i}
              className="grid grid-cols-1 gap-2 rounded-md border border-border/60 p-2 md:grid-cols-6"
              data-testid={`schedule-milestone-${i}`}
            >
              <Input
                aria-label={`Milestone ${i + 1} id`}
                data-testid={`schedule-milestone-${i}-id`}
                value={m.id}
                disabled={disabled}
                placeholder="Id (V4)"
                onChange={(e) => setMilestone(i, { id: e.target.value })}
              />
              <Input
                aria-label={`Milestone ${i + 1} name`}
                data-testid={`schedule-milestone-${i}-name`}
                className="md:col-span-2"
                value={m.name}
                disabled={disabled}
                placeholder="Name"
                onChange={(e) => setMilestone(i, { name: e.target.value })}
              />
              <Input
                aria-label={`Milestone ${i + 1} date`}
                data-testid={`schedule-milestone-${i}-date`}
                type="date"
                value={validDate(m.date) ?? ""}
                disabled={disabled}
                aria-invalid={dateBad}
                onChange={(e) => setMilestone(i, { date: e.target.value })}
              />
              <Input
                aria-label={`Milestone ${i + 1} shown by`}
                data-testid={`schedule-milestone-${i}-shown-by`}
                value={m.shown_by}
                disabled={disabled}
                placeholder="Shown by"
                onChange={(e) => setMilestone(i, { shown_by: e.target.value })}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove milestone ${i + 1}`}
                disabled={disabled}
                data-testid={`schedule-milestone-${i}-remove`}
                onClick={() =>
                  update({
                    ...draft,
                    milestones: draft.milestones.filter((_, j) => j !== i),
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
              <Input
                aria-label={`Milestone ${i + 1} work unit`}
                data-testid={`schedule-milestone-${i}-work-unit`}
                className="md:col-span-3"
                list={WORK_UNIT_LIST}
                value={m.work_unit}
                disabled={disabled}
                placeholder="Met when this work unit ships (optional)"
                onChange={(e) => setMilestone(i, { work_unit: e.target.value })}
              />
              <Input
                aria-label={`Milestone ${i + 1} gate`}
                data-testid={`schedule-milestone-${i}-gate`}
                className="md:col-span-3"
                list={GATE_LIST}
                value={m.gate}
                disabled={disabled}
                placeholder="Met when this gate clears (optional)"
                onChange={(e) => setMilestone(i, { gate: e.target.value })}
              />
              {dateBad ? (
                <p
                  className="text-xs text-destructive md:col-span-6"
                  data-testid={`schedule-milestone-${i}-date-error`}
                >
                  &ldquo;{m.date}&rdquo; is not a date. It is kept as written
                  and the Overview lists the row as one it could not read.
                </p>
              ) : null}
            </div>
          );
        })}
        <datalist id={WORK_UNIT_LIST}>
          {workUnits.map((slug) => (
            <option key={slug} value={slug} />
          ))}
        </datalist>
        <datalist id={GATE_LIST}>
          {gates.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        {pickersFailed ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="schedule-pickers-failed"
          >
            Work unit and gate suggestions could not be loaded; type the value.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Forecast calendar
          </h4>
          {draft.calendar === null ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              data-testid="schedule-add-calendar"
              data-ui-bridge-id="coord.prompt-documents.schedule.add-calendar"
              onClick={() =>
                update({
                  ...draft,
                  calendar: { working_day_factor: "1", breaks: [] },
                })
              }
            >
              Declare a calendar
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              data-testid="schedule-remove-calendar"
              onClick={() => update({ ...draft, calendar: null })}
            >
              Remove calendar
            </Button>
          )}
        </div>
        {draft.calendar === null ? (
          <p className="text-xs text-muted-foreground">
            No calendar declared: the Overview&apos;s forecast reads &ldquo;Not
            available&rdquo; (no calendar). It never guesses one.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="schedule-factor">
                Working-day factor (0 to 1; 1 = every weekday works)
              </Label>
              <Input
                id="schedule-factor"
                data-testid="schedule-factor"
                className="max-w-32"
                value={draft.calendar.working_day_factor}
                disabled={disabled}
                onChange={(e) =>
                  update({
                    ...draft,
                    calendar: {
                      ...draft.calendar!,
                      working_day_factor: e.target.value,
                    },
                  })
                }
              />
            </div>
            {draft.calendar.breaks.map((b, i) => (
              <div
                key={i}
                className="grid grid-cols-1 gap-2 md:grid-cols-5"
                data-testid={`schedule-break-${i}`}
              >
                <Input
                  aria-label={`Break ${i + 1} start`}
                  data-testid={`schedule-break-${i}-start`}
                  type="date"
                  value={validDate(b.start) ?? ""}
                  disabled={disabled}
                  onChange={(e) => setBreak(i, { start: e.target.value })}
                />
                <Input
                  aria-label={`Break ${i + 1} end`}
                  data-testid={`schedule-break-${i}-end`}
                  type="date"
                  value={validDate(b.end) ?? ""}
                  disabled={disabled}
                  onChange={(e) => setBreak(i, { end: e.target.value })}
                />
                <Input
                  aria-label={`Break ${i + 1} label`}
                  className="md:col-span-2"
                  value={b.label}
                  disabled={disabled}
                  placeholder="Label (Winter shutdown)"
                  onChange={(e) => setBreak(i, { label: e.target.value })}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove break ${i + 1}`}
                  disabled={disabled}
                  onClick={() =>
                    update({
                      ...draft,
                      calendar: {
                        ...draft.calendar!,
                        breaks: draft.calendar!.breaks.filter(
                          (_, j) => j !== i
                        ),
                      },
                    })
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              disabled={disabled}
              data-testid="schedule-add-break"
              onClick={() =>
                update({
                  ...draft,
                  calendar: {
                    ...draft.calendar!,
                    breaks: [
                      ...draft.calendar!.breaks,
                      { start: "", end: "", label: "" },
                    ],
                  },
                })
              }
            >
              <Plus className="size-3.5" />
              Add break
            </Button>
          </div>
        )}
      </div>

      <div
        className="space-y-1 rounded-md bg-muted/40 p-2 text-xs"
        data-testid="schedule-preview"
        data-ui-bridge-id="coord.prompt-documents.schedule.preview"
      >
        <p className="font-medium">
          What the Overview will read from this body
        </p>
        <p data-testid="schedule-preview-milestones">
          {preview.milestones.length} milestone
          {preview.milestones.length === 1 ? "" : "s"}
          {preview.milestones.length > 0
            ? `: ${preview.milestones.map((m) => `${m.id ?? m.name} ${m.date}`).join(", ")}`
            : ""}
        </p>
        <p data-testid="schedule-preview-calendar">
          {preview.calendar
            ? `Calendar: factor ${preview.calendar.working_day_factor}, ${preview.calendar.breaks.length} break${preview.calendar.breaks.length === 1 ? "" : "s"}`
            : "No usable calendar: the forecast reads Not available (no calendar)."}
        </p>
        {unreadableTotal > 0 ? (
          <div data-testid="schedule-preview-unreadable">
            <p className="font-medium text-destructive">
              Rows coord holds that could not be read ({unreadableTotal}) — the
              Overview reads nothing from them, and lists unreadable milestone
              rows as such:
            </p>
            <ul className="list-disc pl-5 font-mono">
              {[
                ...preview.milestonesUnreadable,
                ...preview.calendarUnreadable,
              ].map((row, i) => (
                <li key={i}>{row}</li>
              ))}
            </ul>
            {preview.structuralUnreadable.length > 0 ? (
              <p className="text-muted-foreground">
                Lines that are not even a key and value are removed when this
                panel rewrites the list; the earlier version stays in History.
              </p>
            ) : null}
            {preview.calendarUnreadable.length > 0 ? (
              <p
                className="text-muted-foreground"
                data-testid="schedule-calendar-rewrite-note"
              >
                {preview.calendarInline
                  ? "An inline calendar is replaced by a calendar block on the first edit made here."
                  : "Calendar lines this panel has no field for are removed when it rewrites the calendar."}{" "}
                The earlier version stays in History.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
