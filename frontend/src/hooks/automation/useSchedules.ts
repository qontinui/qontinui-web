/**
 * useSchedules Hook
 *
 * Hook for schedule and execution record operations.
 */

import { useAutomationStore } from "@/stores/automation";

export function useSchedules() {
  // State
  const schedules = useAutomationStore((s) => s.schedules);
  const executionRecords = useAutomationStore((s) => s.executionRecords);

  // Actions
  const setSchedules = useAutomationStore((s) => s.setSchedules);
  const addSchedule = useAutomationStore((s) => s.addSchedule);
  const updateSchedule = useAutomationStore((s) => s.updateSchedule);
  const deleteSchedule = useAutomationStore((s) => s.deleteSchedule);

  // Execution records
  const setExecutionRecords = useAutomationStore((s) => s.setExecutionRecords);
  const getScheduleExecutions = useAutomationStore(
    (s) => s.getScheduleExecutions
  );
  const getSchedulerStatistics = useAutomationStore(
    (s) => s.getSchedulerStatistics
  );

  return {
    // State
    schedules,
    executionRecords,

    // CRUD
    setSchedules,
    addSchedule,
    updateSchedule,
    deleteSchedule,

    // Execution records
    setExecutionRecords,
    getScheduleExecutions,
    getSchedulerStatistics,
  };
}
