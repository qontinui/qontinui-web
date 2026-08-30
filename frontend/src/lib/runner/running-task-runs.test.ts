/**
 * Shape tests for `GET /task-runs/running`.
 *
 * The endpoint returns an ENVELOPE — `{ scope, task_runs }` — not a bare
 * array. It changed because an operator read `[]`, concluded the runner was
 * idle, and nearly restarted it while 23 live agent sessions were running;
 * `scope` is the runner's own statement that the list is a port-filtered
 * workflow task-run ledger and NOT a session census.
 *
 * These tests pin the two things that silently break if the envelope is ever
 * mis-read: `runnerFetch` must hand the envelope back whole (it unwraps only
 * `{ success, data }`), and `useRunningTaskRuns` must expose `scope` even —
 * especially — when `task_runs` is empty.
 *
 * Plan: 2026-08-29-no-single-answer-to-is-it-safe-to-restart-the-runner.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { runnerFetch } from "./api-client";
import { useRunningTaskRuns } from "./hooks/task-run-hooks";
import type { RunningTaskRunsResponse } from "./types/task-run";

const SCOPE =
  "workflow task-runs on API port 9876; NOT a session census — see /restart-readiness";

function envelope(
  taskRuns: Array<Record<string, unknown>>
): RunningTaskRunsResponse {
  return { scope: SCOPE, task_runs: taskRuns } as RunningTaskRunsResponse;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runnerFetch on /task-runs/running", () => {
  it("returns the { scope, task_runs } envelope whole", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(envelope([{ id: "run-1", status: "running" }]))
    );

    const result =
      await runnerFetch<RunningTaskRunsResponse>("/task-runs/running");

    // Not unwrapped: runnerFetch only strips `{ success, data }`.
    expect(result.scope).toBe(SCOPE);
    expect(result.task_runs).toHaveLength(1);
    expect(result.task_runs[0]!.id).toBe("run-1");
  });
});

describe("useRunningTaskRuns", () => {
  it("reads task_runs and scope out of the envelope", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        envelope([
          { id: "run-1", task_name: "a", status: "running", created_at: "x" },
          { id: "run-2", task_name: "b", status: "running", created_at: "y" },
        ])
      )
    );

    const { result, unmount } = renderHook(() => useRunningTaskRuns());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.runs.map((r) => r.id)).toEqual(["run-1", "run-2"]);
    expect(result.current.scope).toBe(SCOPE);
    expect(result.current.data?.task_runs).toHaveLength(2);
    unmount();
  });

  it("still surfaces scope when the ledger is empty", async () => {
    fetchMock.mockResolvedValue(jsonResponse(envelope([])));

    const { result, unmount } = renderHook(() => useRunningTaskRuns());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // The whole point: an empty list is never allowed to mean "idle runner"
    // without the sentence that says what the list covers.
    expect(result.current.runs).toEqual([]);
    expect(result.current.scope).toBe(SCOPE);
    unmount();
  });

  it("reports no scope before the first response lands", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    const { result, unmount } = renderHook(() => useRunningTaskRuns());

    // Unknown, not empty: no response yet means no scope to show.
    expect(result.current.scope).toBeNull();
    expect(result.current.runs).toEqual([]);
    unmount();
  });
});
