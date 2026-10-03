import type {
  ScheduleExpression,
  ScheduleConditions,
  ScheduledTaskType,
} from "@/lib/runner/types/scheduler";

export type ScheduleType = "once" | "cron" | "interval";
export type IntervalUnit = "minutes" | "hours" | "days";

export interface ScheduleFormState {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  workflowName: string;
  setWorkflowName: (v: string) => void;
  workflowSearch: string;
  setWorkflowSearch: (v: string) => void;
  scheduleType: ScheduleType;
  setScheduleType: (v: ScheduleType) => void;
  onceDateTime: string;
  setOnceDateTime: (v: string) => void;
  cronExpression: string;
  setCronExpression: (v: string) => void;
  intervalAmount: number;
  setIntervalAmount: (v: number) => void;
  intervalUnit: IntervalUnit;
  setIntervalUnit: (v: IntervalUnit) => void;
  showConditions: boolean;
  setShowConditions: (v: boolean) => void;
  requireIdle: boolean;
  setRequireIdle: (v: boolean) => void;
  timeoutMinutes: number | "";
  setTimeoutMinutes: (v: number | "") => void;
  autoFixOnFailure: boolean;
  setAutoFixOnFailure: (v: boolean) => void;
  skipIfCompleted: boolean;
  setSkipIfCompleted: (v: boolean) => void;
  isSaving: boolean;
  /** Why the schedule may not be CREATED right now (coord's outcome), or null. */
  saveRefusal: string | null;
  filteredWorkflows: Array<{
    id: string;
    name: string;
    description?: string | null;
  }>;
  workflowsLoading: boolean;
  handleSave: () => Promise<void>;
}

export function getScheduleType(schedule?: ScheduleExpression): ScheduleType {
  if (!schedule) return "once";
  switch (schedule.type) {
    case "Once":
      return "once";
    case "Cron":
      return "cron";
    case "Interval":
      return "interval";
    default:
      return "once";
  }
}

export function getIntervalValues(seconds: number): {
  amount: number;
  unit: IntervalUnit;
} {
  if (seconds >= 86400 && seconds % 86400 === 0) {
    return { amount: seconds / 86400, unit: "days" };
  }
  if (seconds >= 3600 && seconds % 3600 === 0) {
    return { amount: seconds / 3600, unit: "hours" };
  }
  return { amount: Math.max(1, Math.round(seconds / 60)), unit: "minutes" };
}

export function intervalToSeconds(amount: number, unit: IntervalUnit): number {
  switch (unit) {
    case "minutes":
      return amount * 60;
    case "hours":
      return amount * 3600;
    case "days":
      return amount * 86400;
  }
}

export function toDateTimeLocal(iso?: string): string {
  if (!iso) {
    const d = new Date(Date.now() + 3600_000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function buildSchedule(
  scheduleType: ScheduleType,
  onceDateTime: string,
  cronExpression: string,
  intervalAmount: number,
  intervalUnit: IntervalUnit
): ScheduleExpression {
  switch (scheduleType) {
    case "once":
      return { type: "Once", value: new Date(onceDateTime).toISOString() };
    case "cron":
      return { type: "Cron", value: cronExpression };
    case "interval":
      return {
        type: "Interval",
        value: intervalToSeconds(intervalAmount, intervalUnit),
      };
  }
}

/**
 * Build the conditions to save. The editor only owns `requireIdle` and
 * `timeoutMinutes`; every other field of `existing` (`requireRepoInactive`,
 * and any condition a newer runner reports that this form does not model) is
 * carried forward untouched, so saving never removes a gate the user was not
 * shown. The runner serializes conditions camelCase; a snake_case spelling of
 * an owned field is dropped too, so the payload never carries both (serde
 * refuses that as a duplicate field).
 */
export function buildConditions(
  showConditions: boolean,
  requireIdle: boolean,
  timeoutMinutes: number | "",
  existing?: ScheduleConditions | null
): ScheduleConditions | undefined {
  const {
    requireIdle: _ownedIdle,
    timeoutMinutes: _ownedTimeout,
    require_idle: _ownedIdleAlias,
    timeout_minutes: _ownedTimeoutAlias,
    ...preserved
  } = (existing ?? {}) as ScheduleConditions & {
    require_idle?: unknown;
    timeout_minutes?: unknown;
  };
  const conditions: ScheduleConditions = { ...preserved };
  if (requireIdle) {
    conditions.requireIdle = { enabled: true };
  }
  if (timeoutMinutes && timeoutMinutes > 0) {
    conditions.timeoutMinutes = Number(timeoutMinutes);
  }
  if (!showConditions && Object.keys(conditions).length === 0) {
    return undefined;
  }
  return conditions;
}

/** Order-insensitive equality; absent, null and `{}` all mean "no conditions". */
export function sameConditions(
  a: ScheduleConditions | null | undefined,
  b: ScheduleConditions | null | undefined
): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined && v !== null)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([k, v]) => [k, canonical(v)])
      );
    }
    return value;
  };
  return (
    JSON.stringify(canonical(a ?? {})) === JSON.stringify(canonical(b ?? {}))
  );
}

/**
 * Build the Workflow task to save. Editing an existing Workflow task keeps its
 * other fields (`config_path`, `monitor_index`); `workflow_id` is kept only
 * while the workflow name is unchanged, because the runner runs by id first
 * and a stale id would keep running the old workflow.
 */
export function buildWorkflowTask(
  workflowName: string,
  existing?: ScheduledTaskType | null
): ScheduledTaskType {
  if (existing?.task_type !== "Workflow") {
    return { task_type: "Workflow", workflow_name: workflowName };
  }
  if (existing.workflow_name === workflowName) {
    return { ...existing };
  }
  const { workflow_id: _staleId, ...rest } = existing;
  return { ...rest, task_type: "Workflow", workflow_name: workflowName };
}
