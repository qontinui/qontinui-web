/**
 * The runner persists a task's conditions (project.scheduled_tasks.conditions,
 * qontinui-web#1561) and serializes them camelCase. Saving from the editor must
 * carry forward every condition and task field it does not render, and must
 * never send an owned field twice (snake_case + camelCase is a serde
 * duplicate-field refusal).
 */

import { describe, expect, it } from "vitest";
import type {
  ScheduleConditions,
  ScheduledTaskType,
} from "@/lib/runner/types/scheduler";
import { buildConditions, buildWorkflowTask } from "./schedule-editor";

const REPO_INACTIVE: ScheduleConditions["requireRepoInactive"] = {
  enabled: true,
  repositories: [{ path: "/repo", inactiveMinutes: 30 }],
};

describe("buildConditions", () => {
  it("returns undefined when nothing is set and nothing is preserved", () => {
    expect(buildConditions(false, false, 0)).toBeUndefined();
    expect(buildConditions(false, false, "", null)).toBeUndefined();
  });

  it("returns an empty object when the section is open and nothing is set", () => {
    expect(buildConditions(true, false, 0)).toEqual({});
  });

  it("builds the fields the editor owns, camelCase", () => {
    expect(buildConditions(true, true, 15)).toEqual({
      requireIdle: { enabled: true },
      timeoutMinutes: 15,
    });
  });

  it("preserves requireRepoInactive when the form has no conditions", () => {
    expect(
      buildConditions(false, false, 0, { requireRepoInactive: REPO_INACTIVE })
    ).toEqual({ requireRepoInactive: REPO_INACTIVE });
  });

  it("preserves conditions the editor does not model", () => {
    const probe = { enabled: true, command: ["true"], pollSeconds: 300 };
    const existing = { requireProbe: probe } as ScheduleConditions;
    expect(buildConditions(true, true, 0, existing)).toEqual({
      requireProbe: probe,
      requireIdle: { enabled: true },
    });
  });

  it("lets the form clear the fields it owns, as the runner sends them", () => {
    expect(
      buildConditions(false, false, 0, {
        requireIdle: { enabled: true },
        timeoutMinutes: 30,
        requireRepoInactive: REPO_INACTIVE,
      })
    ).toEqual({ requireRepoInactive: REPO_INACTIVE });
  });

  it("never emits an owned field under both spellings", () => {
    const existing = {
      require_idle: { enabled: true },
      timeout_minutes: 5,
    } as unknown as ScheduleConditions;
    expect(buildConditions(true, true, 10, existing)).toEqual({
      requireIdle: { enabled: true },
      timeoutMinutes: 10,
    });
  });
});

describe("buildWorkflowTask", () => {
  const existing: ScheduledTaskType = {
    task_type: "Workflow",
    workflow_name: "nightly",
    workflow_id: "wf-1",
    config_path: "/cfg.json",
    monitor_index: 1,
  };

  it("builds a bare Workflow task when there is nothing to keep", () => {
    expect(buildWorkflowTask("nightly")).toEqual({
      task_type: "Workflow",
      workflow_name: "nightly",
    });
    expect(
      buildWorkflowTask("nightly", {
        task_type: "Prompt",
        prompt_id: "p",
      })
    ).toEqual({ task_type: "Workflow", workflow_name: "nightly" });
  });

  it("keeps every field of an unchanged Workflow task", () => {
    expect(buildWorkflowTask("nightly", existing)).toEqual(existing);
  });

  it("drops the stale workflow_id when the workflow changes", () => {
    expect(buildWorkflowTask("weekly", existing)).toEqual({
      task_type: "Workflow",
      workflow_name: "weekly",
      config_path: "/cfg.json",
      monitor_index: 1,
    });
  });
});
