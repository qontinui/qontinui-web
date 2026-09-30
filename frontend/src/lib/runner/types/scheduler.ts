// =============================================================================
// Scheduler Types - the runner's wire shapes, generated from qontinui-schemas
// =============================================================================
//
// These are the canonical types from @qontinui/shared-types (generated from
// `qontinui-schemas/rust/src/scheduler.rs`). The runner serializes every
// scheduler struct camelCase (`skipIfCompleted`, `lastRun`, `conditionStatus`,
// `requireIdle`, ...) and accepts snake_case only as an input alias. The hand-
// written snake_case duplicates that used to live here matched neither
// direction for reads, so every response field they named read `undefined`.
// The task enum is the exception: it is tagged `task_type` with snake_case
// fields, and the generated type says so.

export type {
  CatchUpPolicy,
  ConditionStatus,
  CreateScheduledTaskRequest,
  IdleCondition,
  NextTaskInfo,
  RepositoryInactiveCondition,
  RepositoryWatch,
  ScheduleConditions,
  ScheduleExpression,
  ScheduledTask,
  ScheduledTaskStatus,
  ScheduledTaskType,
  SchedulerSettings,
  SchedulerStatus,
  TaskExecutionRecord,
  UpdateScheduledTaskRequest,
} from "@qontinui/shared-types/scheduler";
