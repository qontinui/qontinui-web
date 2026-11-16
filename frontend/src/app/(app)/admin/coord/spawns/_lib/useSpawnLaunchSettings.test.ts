/**
 * `useSpawnLaunchSettings` ordering — plan
 * `2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type` Phase 5.
 *
 * A save that resolves while a read is in flight must neither leave `loading`
 * stuck nor let the older read paint the pre-write row over the read-back.
 */

import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type {
  SpawnLaunchSettingRow,
  SpawnLaunchSettingsResponse,
} from "@/lib/api/spawnLaunchSettings";

const reads: ((v: SpawnLaunchSettingsResponse) => void)[] = [];
const putSpawnLaunchSetting = vi.fn();

vi.mock("@/lib/api/spawnLaunchSettings", () => ({
  fetchSpawnLaunchSettings: () =>
    new Promise<SpawnLaunchSettingsResponse>((resolve) => reads.push(resolve)),
  putSpawnLaunchSetting: (...args: unknown[]) => putSpawnLaunchSetting(...args),
}));

import { useSpawnLaunchSettings } from "./useSpawnLaunchSettings";

function rowFx(
  over: Partial<SpawnLaunchSettingRow> = {}
): SpawnLaunchSettingRow {
  return {
    spawn_type: "post_merge",
    description: "d",
    model: null,
    effort: null,
    source: "default",
    updated_by: null,
    updated_at: null,
    ...over,
  };
}

function bodyFx(row: SpawnLaunchSettingRow): SpawnLaunchSettingsResponse {
  return {
    settings: [row],
    model_families: ["fable", "opus", "sonnet", "haiku"],
    effort_levels: ["low", "medium", "high", "xhigh", "max"],
    can_edit: true,
  };
}

describe("useSpawnLaunchSettings", () => {
  it("a save landing during a read keeps its read-back and clears loading", async () => {
    const { result } = renderHook(() => useSpawnLaunchSettings());
    await act(async () => reads.shift()?.(bodyFx(rowFx())));
    expect(result.current.loading).toBe(false);

    // A refresh is issued, then a save resolves before it answers.
    let refresh: Promise<void> = Promise.resolve();
    act(() => {
      refresh = result.current.reload();
    });
    expect(result.current.loading).toBe(true);
    const written = rowFx({ model: "sonnet", source: "stored" });
    putSpawnLaunchSetting.mockResolvedValueOnce(written);
    await act(async () => {
      await result.current.save("post_merge", {
        model: "sonnet",
        effort: null,
      });
    });

    // The older read answers with the pre-write row.
    await act(async () => {
      reads.shift()?.(bodyFx(rowFx()));
      await refresh;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data?.settings[0]?.model).toBe("sonnet");
  });
});
