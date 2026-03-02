"use client";

import { Input } from "@/components/ui/input";
import { Calendar, Clock, Repeat } from "lucide-react";
import type { ScheduleType, IntervalUnit } from "../_types/schedule-editor";

const SCHEDULE_OPTIONS = [
  { key: "once" as const, label: "One-time", icon: Calendar },
  { key: "cron" as const, label: "Cron", icon: Clock },
  { key: "interval" as const, label: "Interval", icon: Repeat },
];

interface ScheduleTypeSelectorProps {
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
}

export function ScheduleTypeSelector({
  scheduleType,
  setScheduleType,
  onceDateTime,
  setOnceDateTime,
  cronExpression,
  setCronExpression,
  intervalAmount,
  setIntervalAmount,
  intervalUnit,
  setIntervalUnit,
}: ScheduleTypeSelectorProps) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-text-muted">Schedule</p>
      <div className="flex gap-1">
        {SCHEDULE_OPTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setScheduleType(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
              scheduleType === key
                ? "bg-brand-primary/15 border-brand-primary/40 text-brand-primary"
                : "bg-surface-canvas/30 border-border-subtle/30 text-text-muted hover:text-text-secondary hover:border-border-subtle"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {scheduleType === "once" && (
        <div className="space-y-1.5 mt-2">
          <label htmlFor="sed-datetime" className="text-xs text-text-muted">
            Date & Time
          </label>
          <Input
            id="sed-datetime"
            type="datetime-local"
            value={onceDateTime}
            onChange={(e) => setOnceDateTime(e.target.value)}
            className="bg-surface-canvas/50 border-border-subtle/50 text-sm"
          />
        </div>
      )}

      {scheduleType === "cron" && (
        <div className="space-y-1.5 mt-2">
          <label htmlFor="sed-cron" className="text-xs text-text-muted">
            Cron Expression
          </label>
          <Input
            id="sed-cron"
            placeholder="0 9 * * *"
            value={cronExpression}
            onChange={(e) => setCronExpression(e.target.value)}
            className="bg-surface-canvas/50 border-border-subtle/50 font-mono text-sm"
          />
          <p className="text-[11px] text-text-muted/70">
            Format: minute hour day-of-month month day-of-week (e.g., &quot;0 9
            * * *&quot; = daily at 9:00 AM)
          </p>
        </div>
      )}

      {scheduleType === "interval" && (
        <div className="space-y-1.5 mt-2">
          <label
            htmlFor="sed-interval-amount"
            className="text-xs text-text-muted"
          >
            Repeat Every
          </label>
          <div className="flex gap-2">
            <Input
              id="sed-interval-amount"
              type="number"
              min={1}
              value={intervalAmount}
              onChange={(e) =>
                setIntervalAmount(Math.max(1, parseInt(e.target.value) || 1))
              }
              className="w-24 bg-surface-canvas/50 border-border-subtle/50 text-sm"
            />
            <select
              value={intervalUnit}
              onChange={(e) => setIntervalUnit(e.target.value as IntervalUnit)}
              className="flex-1 rounded-md border border-border-subtle/50 bg-surface-canvas/50 px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/50"
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
