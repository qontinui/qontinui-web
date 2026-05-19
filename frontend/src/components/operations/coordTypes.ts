// ============================================================================
// qontinui-coord types — mirror StatusRow from
// qontinui-coord/src/status.rs:75. Kept local to /components/operations
// because this is the only consumer in the web frontend today.
//
// Phase 6 of the unified-devices-registry plan renamed `machine_id` →
// `device_id` and `machines` → `devices` to match the canonical
// `coord.devices` table (see `@qontinui/shared-types` `Device` type at
// `qontinui-schemas/ts/src/generated/Device.ts`). The fuller absorbed-column
// surface (`derived_status`, `ui_error`, `capability_*`, `name`, `state`,
// …) lives on `Device`; this status-row endpoint only carries the
// agent-voluntary subset above.
// ============================================================================

export interface DeviceStatusRow {
  device_id: string;
  hostname: string | null;
  current_task: string | null;
  current_repo: string | null;
  current_branch: string | null;
  free_text: string | null;
  details: Record<string, unknown>;
  updated_at: string;
}

export interface DeviceStatusResponse {
  devices: DeviceStatusRow[];
  count: number;
}
