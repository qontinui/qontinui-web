/**
 * Schedule Slice
 *
 * Manages schedules and execution records.
 */

import type { StateCreator } from "zustand";
import type { AutomationStore, ScheduleSlice } from "../types";
import { projectLogger } from "@/lib/project-logger";

export const createScheduleSlice: StateCreator<
  AutomationStore,
  [["zustand/immer", never]],
  [],
  ScheduleSlice
> = (set, get) => ({
  // Initial state
  schedules: [],
  executionRecords: [],

  // Actions
  setSchedules: (schedules) => {
    projectLogger.debug("ScheduleSlice", "setSchedules", {
      count: schedules.length,
    });
    set((state) => {
      state.schedules = schedules;
    });
  },

  addSchedule: (schedule) => {
    projectLogger.info("ScheduleSlice", "addSchedule", {
      id: schedule.id,
      name: schedule.name,
    });
    set((state) => {
      state.schedules.push({
        ...schedule,
        projectName: state.projectName,
      });
    });
    get().triggerSave();
  },

  updateSchedule: (schedule) => {
    projectLogger.debug("ScheduleSlice", "updateSchedule", { id: schedule.id });
    set((state) => {
      const index = state.schedules.findIndex((s) => s.id === schedule.id);
      if (index !== -1) {
        state.schedules[index] = schedule;
      }
    });
    get().triggerSave();
  },

  deleteSchedule: (scheduleId) => {
    projectLogger.info("ScheduleSlice", "deleteSchedule", { scheduleId });
    set((state) => {
      state.schedules = state.schedules.filter((s) => s.id !== scheduleId);
      // Also remove related execution records
      state.executionRecords = state.executionRecords.filter(
        (r) => r.scheduleId !== scheduleId
      );
    });
    get().triggerSave();
  },

  // Execution records
  setExecutionRecords: (records) => {
    projectLogger.debug("ScheduleSlice", "setExecutionRecords", {
      count: records.length,
    });
    set((state) => {
      state.executionRecords = records;
    });
  },

  getScheduleExecutions: (scheduleId) => {
    return get().executionRecords.filter((r) => r.scheduleId === scheduleId);
  },

  getSchedulerStatistics: () => {
    const { schedules, executionRecords } = get();

    const activeSchedules = schedules.filter((s) => s.enabled).length;
    const successfulExecutions = executionRecords.filter(
      (r) => r.success
    ).length;
    const failedExecutions = executionRecords.filter((r) => !r.success).length;

    const totalIterations = executionRecords.reduce(
      (sum, r) => sum + r.iterationCount,
      0
    );
    const averageIterationCount =
      executionRecords.length > 0
        ? totalIterations / executionRecords.length
        : 0;

    return {
      totalSchedules: schedules.length,
      activeSchedules,
      totalExecutions: executionRecords.length,
      successfulExecutions,
      failedExecutions,
      averageIterationCount,
    };
  },
});
