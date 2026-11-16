/**
 * Spawn launch settings — the operator's model and effort per spawn type.
 *
 * Proxied by `backend/app/api/v1/endpoints/spawn_launch_settings.py` to coord's
 * `/coord/spawn-launch-settings`. Plan
 * `2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type` Phase 5.
 *
 * Same conventions as the typed `/operations` client (`operations/base.ts`):
 * `httpClient.fetch` on a RELATIVE URL, inlined, parsed through `readJson`, so
 * a rejection reads `<METHOD> <url> failed: <status> - <body>` and
 * `httpStatusOf` / `isWriteFailureUnknown` read it as they read every other.
 */

import { httpClient } from "@/services/service-factory";
import { readJson } from "./operations/base";

export const SPAWN_LAUNCH_SETTINGS_BASE = "/api/v1/spawn-launch-settings";

/** A model family; `--model <family>` runs that family's latest model. */
export type ModelFamily = "fable" | "opus" | "sonnet" | "haiku";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/** Mirrors `SpawnLaunchSettingRow`. `null` model/effort = inherit. */
export interface SpawnLaunchSettingRow {
  spawn_type: string;
  description: string;
  model: ModelFamily | null;
  effort: EffortLevel | null;
  /** `stored` — a row exists for this type; `default` — none does. */
  source: "stored" | "default";
  updated_by: string | null;
  updated_at: string | null;
}

/** Mirrors `SpawnLaunchSettingsResponse`. */
export interface SpawnLaunchSettingsResponse {
  settings: SpawnLaunchSettingRow[];
  model_families: ModelFamily[];
  effort_levels: EffortLevel[];
  can_edit: boolean;
}

/** The PUT body: the full pair, `null` = inherit (a real write). */
export interface SpawnLaunchSettingWrite {
  model: ModelFamily | null;
  effort: EffortLevel | null;
}

/** `GET /spawn-launch-settings` (`get_spawn_launch_settings`). */
export async function fetchSpawnLaunchSettings(): Promise<SpawnLaunchSettingsResponse> {
  const url = `${SPAWN_LAUNCH_SETTINGS_BASE}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<SpawnLaunchSettingsResponse>(res, `GET ${url}`);
}

/**
 * `PUT /spawn-launch-settings/{spawn_type}` (`put_spawn_launch_setting`). The
 * answer is coord's row as it now holds it — the read-back. Sent ONCE
 * (`maxRetries: 0`), as every classified write is (`writeOutcome.ts`): a retry
 * would let a later connect failure hide an earlier answer that may have
 * committed.
 */
export async function putSpawnLaunchSetting(
  spawnType: string,
  write: SpawnLaunchSettingWrite
): Promise<SpawnLaunchSettingRow> {
  const url = `${SPAWN_LAUNCH_SETTINGS_BASE}/${encodeURIComponent(spawnType)}`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify(write),
    idempotent: false,
    maxRetries: 0,
  });
  return readJson<SpawnLaunchSettingRow>(res, `PUT ${url}`);
}
