import type {
  ScheduleExpression,
  ScheduleConditions,
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

export function buildConditions(
  showConditions: boolean,
  requireIdle: boolean,
  timeoutMinutes: number | ""
): ScheduleConditions | undefined {
  if (
    !showConditions &&
    !requireIdle &&
    (!timeoutMinutes || timeoutMinutes === 0)
  ) {
    return undefined;
  }
  const conditions: ScheduleConditions = {};
  if (requireIdle) {
    conditions.require_idle = { enabled: true };
  }
  if (timeoutMinutes && timeoutMinutes > 0) {
    conditions.timeout_minutes = Number(timeoutMinutes);
  }
  return conditions;
}
