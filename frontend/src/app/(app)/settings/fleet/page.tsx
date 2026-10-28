"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Runner } from "@qontinui/shared-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AppWindow,
  Loader2,
  MonitorCheck,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { relativeTime } from "@/components/operations/utils";
import { AppConfigAdminOnly } from "@/components/operations/AppConfigAdminOnly";
import { isAppConfigAdminRefusal } from "@/components/operations/fleetTestTargets";
import { listRunners } from "@/lib/api/runners";
import {
  APP_CONFIG_ADMIN_ONLY,
  designateTestTarget,
  listFleetApps,
  listFreshness,
  listTestTargets,
  undesignateTestTarget,
  updateFleetApp,
  type FleetApp,
  type FreshnessRow,
  type TestTargetRow,
  type UpdateStrategy,
} from "@/lib/api/fleet";
import { FleetReadNote } from "./_components/FleetReadNote";
import { errorText, useFleetRead } from "./_hooks/useFleetRead";

/** Freshness poll cadence — the auto-fresh engine flips states at
 *  pull/build cadence, so 10s is fresh enough without hot-looping. */
const FRESHNESS_POLL_MS = 10_000;

/**
 * What the app-registry read (`GET /api/v1/fleet/apps`) answered.
 *
 * - `pending` — not back yet. `fetchAll` keeps the page's loader up until
 *   EVERY read has settled, so this state is never rendered past the loader.
 * - `read` — `apps` is the registry; an empty list is a real "none". If a
 *   later read failed, the registry stays on screen labelled stale.
 * - `admin-only` — REFUSED: the viewer is not a platform admin. The registry
 *   and its editors are replaced by `AppConfigAdminOnly`, never by an empty
 *   list or a generic error.
 * - `failed` — the read failed before it ever succeeded; nothing is known.
 *
 * The registry is not a `useFleetRead` like the page's other reads, for two
 * reasons. A refusal must DROP what an earlier read delivered, and a retained
 * value cannot be dropped. And its reads cannot overtake each other: only
 * `fetchAll` reads it, and the loader hides the one control that re-runs
 * `fetchAll` until it has settled. So one state and one reason
 * (`registryFailure`) are exact here.
 */
type AppRegistryRead = "pending" | "read" | "admin-only" | "failed";

/** Editable slice of an app's config, mirrored as local draft state. */
interface AppDraft {
  update_strategy: UpdateStrategy;
  build_command: string;
  start_command: string;
}

function draftFromApp(app: FleetApp): AppDraft {
  return {
    update_strategy: app.update_strategy,
    build_command: app.build_command ?? "",
    start_command: app.start_command ?? "",
  };
}

function draftIsDirty(app: FleetApp, draft: AppDraft): boolean {
  return (
    draft.update_strategy !== app.update_strategy ||
    draft.build_command !== (app.build_command ?? "") ||
    draft.start_command !== (app.start_command ?? "")
  );
}

function freshnessBadgeVariant(freshness: string | null | undefined) {
  switch (freshness) {
    case "fresh":
      return "success" as const;
    case "building":
      return "warning" as const;
    case "failed":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

function deviceStatusBadgeVariant(status: string) {
  switch (status) {
    case "healthy":
      return "success" as const;
    case "unhealthy":
      return "warning" as const;
    default:
      return "secondary" as const;
  }
}

export default function FleetSettingsPage() {
  // ---- Apps section state ------------------------------------------------
  const [apps, setApps] = useState<FleetApp[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AppDraft>>({});
  const [savingAppId, setSavingAppId] = useState<string | null>(null);
  const [registry, setRegistry] = useState<AppRegistryRead>("pending");
  // Why the latest registry read failed; null once one delivers the registry.
  // Read only by the `failed` state and by `read`'s stale label, so a refusal
  // leaves it alone: every read after a refusal either delivers or fails anew.
  const [registryFailure, setRegistryFailure] = useState<string | null>(null);

  // ---- Test-target section state ------------------------------------------
  // Each list read keeps its own outcome, so a failed read renders as UNKNOWN
  // or STALE with its reason, never as the section's "none yet".
  const targetsRead = useFleetRead<TestTargetRow[]>([]);
  // The add form's Device choice.
  const devicesRead = useFleetRead<Runner[]>([]);
  const [addDeviceId, setAddDeviceId] = useState("");
  const [addAppId, setAddAppId] = useState("");
  const [addAutoFresh, setAddAutoFresh] = useState(false);
  const [adding, setAdding] = useState(false);

  // ---- Freshness section state --------------------------------------------
  const freshnessRead = useFleetRead<FreshnessRow[]>([]);

  const [loading, setLoading] = useState(true);

  const targets = targetsRead.rows;
  const devices = devicesRead.rows;
  const freshness = freshnessRead.rows;
  const { load: loadTargets } = targetsRead;
  const { load: loadDevices } = devicesRead;
  const { load: loadFreshness } = freshnessRead;

  /** The viewer may not see the registry: drop it and every draft of it. */
  const refuseRegistry = useCallback(() => {
    setApps([]);
    setDrafts({});
    setRegistry("admin-only");
  }, []);

  const fetchApps = useCallback(async () => {
    try {
      const rows = await listFleetApps();
      setApps(rows);
      setDrafts(
        Object.fromEntries(rows.map((app) => [app.app_id, draftFromApp(app)]))
      );
      setRegistry("read");
      setRegistryFailure(null);
    } catch (err) {
      // A refusal is an answer, not a load failure: no "Failed to load" toast.
      if (isAppConfigAdminRefusal(err)) {
        refuseRegistry();
        return;
      }
      // A registry read earlier stays on screen, labelled stale; one never
      // read is unknown. Both say why.
      setRegistry((prev) => (prev === "read" ? prev : "failed"));
      setRegistryFailure(errorText(err));
      throw err;
    }
  }, [refuseRegistry]);

  const fetchTargets = useCallback(
    () => loadTargets(listTestTargets),
    [loadTargets]
  );

  const fetchFreshness = useCallback(
    () => loadFreshness(listFreshness),
    [loadFreshness]
  );

  const fetchAll = useCallback(async () => {
    // `allSettled`, not `all`: the loader comes down only once EVERY read has
    // answered. With `all`, the first read to fail cleared it while the
    // registry read was still out, and the page rendered that unknown registry
    // as "No apps registered yet" and its add-form slot as "could not be
    // read". It also toasted only the first failure; every one is named now.
    const reads = await Promise.allSettled([
      fetchApps(),
      fetchTargets(),
      fetchFreshness(),
      loadDevices(() => listRunners()),
    ]);
    const failures = reads.flatMap((read) =>
      read.status === "rejected" ? [errorText(read.reason)] : []
    );
    if (failures.length > 0) {
      toast.error(`Failed to load fleet data: ${failures.join("; ")}`);
    }
    setLoading(false);
  }, [fetchApps, fetchTargets, fetchFreshness, loadDevices]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Poll freshness while mounted. No toast on failure: a transient poll error
  // must not toast-storm, and the next tick retries. The Freshness section
  // still says so (`freshnessRead`), so its rows are never shown as current
  // after a poll that failed to refresh them.
  useEffect(() => {
    const timer = setInterval(() => {
      fetchFreshness().catch(() => {});
    }, FRESHNESS_POLL_MS);
    return () => clearInterval(timer);
  }, [fetchFreshness]);

  const setDraft = (appId: string, patch: Partial<AppDraft>) => {
    setDrafts((prev) => {
      const current = prev[appId];
      if (!current) return prev;
      return { ...prev, [appId]: { ...current, ...patch } };
    });
  };

  const handleSaveApp = async (app: FleetApp) => {
    const draft = drafts[app.app_id];
    if (!draft) return;
    setSavingAppId(app.app_id);
    try {
      const updated = await updateFleetApp(app.app_id, {
        update_strategy: draft.update_strategy,
        // A blank value (empty or whitespace-only) clears the command
        // server-side; anything else is stored trimmed.
        build_command: draft.build_command,
        start_command: draft.start_command,
      });
      setApps((prev) =>
        prev.map((a) => (a.app_id === updated.app_id ? updated : a))
      );
      setDrafts((prev) => ({
        ...prev,
        [updated.app_id]: draftFromApp(updated),
      }));
      toast.success(`Saved ${updated.display_name}`);
    } catch (err) {
      if (isAppConfigAdminRefusal(err)) {
        // The viewer is no longer a platform admin: say so, and take the
        // editors away with the registry they were rendered from.
        toast.error(`Failed to save: ${APP_CONFIG_ADMIN_ONLY}`);
        refuseRegistry();
      } else {
        toast.error(
          `Failed to save: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } finally {
      setSavingAppId(null);
    }
  };

  /**
   * Re-read the designations after a write that SUCCEEDED. A failed re-read
   * is not the write failing, so it is not toasted as one: the section labels
   * its rows stale, with the reason (`targetsRead`).
   */
  const rereadTargets = () => fetchTargets().catch(() => {});

  const handleToggleAutoFresh = async (target: TestTargetRow) => {
    try {
      await designateTestTarget(
        target.device_id,
        target.app_id,
        !target.auto_fresh
      );
    } catch (err) {
      toast.error(`Failed to toggle auto-fresh: ${errorText(err)}`);
      return;
    }
    await rereadTargets();
  };

  const handleRemoveTarget = async (target: TestTargetRow) => {
    try {
      await undesignateTestTarget(target.device_id, target.app_id);
    } catch (err) {
      toast.error(`Failed to remove designation: ${errorText(err)}`);
      return;
    }
    toast.success(
      `Removed ${target.device_name} as test host for ${target.app_id}`
    );
    await rereadTargets();
  };

  const handleAddTarget = async () => {
    if (!addDeviceId || !addAppId) return;
    setAdding(true);
    try {
      await designateTestTarget(addDeviceId, addAppId, addAutoFresh);
    } catch (err) {
      toast.error(`Failed to designate test host: ${errorText(err)}`);
      setAdding(false);
      return;
    }
    toast.success("Test host designated");
    setAddDeviceId("");
    setAddAppId("");
    setAddAutoFresh(false);
    await rereadTargets();
    setAdding(false);
  };

  const sortedFreshness = useMemo(
    () =>
      [...freshness].sort(
        (a, b) =>
          a.device_name.localeCompare(b.device_name) ||
          a.app_id.localeCompare(b.app_id)
      ),
    [freshness]
  );

  // The add-designation form is offered only when the registry (its App
  // choice) and the device list (its Device choice) were both read. Copy that
  // points at the form says so only while it is there.
  const addFormOffered = registry === "read" && !devicesRead.unknown;

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-20"
        data-testid="fleet-loading"
      >
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Server className="size-5" />
            Fleet
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Test-host designation and auto-fresh deployment management
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLoading(true);
            fetchAll();
          }}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Refresh"
          data-testid="fleet-refresh"
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {/* Apps */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <AppWindow className="size-4" />
            Apps
          </h3>
          <p className="text-xs text-muted-foreground">
            How the runner keeps each registered app current on designated test
            hosts. Build and start commands only apply to the{" "}
            <span className="font-mono">pull_build</span> strategy.
          </p>
        </div>
        <div className="p-4 space-y-3">
          {registry === "read" && registryFailure !== null && (
            <FleetReadNote
              testId="fleet-apps-read-stale"
              reason={registryFailure}
            >
              The latest read of the app registry failed. The apps below are
              from an earlier read and may be out of date.
            </FleetReadNote>
          )}
          {registry === "admin-only" ? (
            <AppConfigAdminOnly />
          ) : registry === "failed" ? (
            <FleetReadNote
              testId="fleet-apps-read-failed"
              reason={registryFailure}
            >
              The app registry could not be read, so which apps are registered
              is unknown. Refresh to try again.
            </FleetReadNote>
          ) : apps.length === 0 ? (
            <div className="text-center py-12">
              <AppWindow className="size-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No apps registered yet. Apps appear here once a runner registers
                them.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {apps.map((app) => {
                const draft = drafts[app.app_id] ?? draftFromApp(app);
                const dirty = draftIsDirty(app, draft);
                return (
                  <div
                    key={app.app_id}
                    className="rounded-lg border border-border px-4 py-3 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {app.display_name}{" "}
                          <span className="font-mono text-xs text-muted-foreground">
                            {app.app_id}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {app.repo_root}
                        </p>
                      </div>
                      <Button
                        variant="brand-primary"
                        size="sm"
                        disabled={!dirty || savingAppId === app.app_id}
                        onClick={() => handleSaveApp(app)}
                        className="shrink-0"
                        data-testid="fleet-app-save"
                      >
                        {savingAppId === app.app_id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : null}
                        Save
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={draft.update_strategy}
                        onValueChange={(value) =>
                          setDraft(app.app_id, {
                            update_strategy: value as UpdateStrategy,
                          })
                        }
                      >
                        <SelectTrigger
                          className="w-36"
                          size="sm"
                          data-testid="fleet-app-strategy"
                        >
                          <SelectValue placeholder="Strategy" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pull_only">pull_only</SelectItem>
                          <SelectItem value="pull_build">pull_build</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="text"
                        placeholder="Build command (pull_build only)"
                        title="Only used with the pull_build strategy"
                        value={draft.build_command}
                        onChange={(e) =>
                          setDraft(app.app_id, {
                            build_command: e.target.value,
                          })
                        }
                        className="flex-1 min-w-48 font-mono text-sm"
                        data-testid="fleet-app-build-command"
                      />
                      <Input
                        type="text"
                        placeholder="Start command (pull_build only)"
                        title="Only used with the pull_build strategy"
                        value={draft.start_command}
                        onChange={(e) =>
                          setDraft(app.app_id, {
                            start_command: e.target.value,
                          })
                        }
                        className="flex-1 min-w-48 font-mono text-sm"
                        data-testid="fleet-app-start-command"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Test-host designations */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium flex items-center gap-2">
                <MonitorCheck className="size-4" />
                Test-host designations
              </h3>
              <p className="text-xs text-muted-foreground">
                Devices designated to run tests for an app. Auto-fresh keeps the
                device&apos;s build current automatically.
              </p>
            </div>
            {targets.length > 0 && (
              <Badge variant="secondary">{targets.length}</Badge>
            )}
          </div>
        </div>
        <div className="p-4 space-y-4">
          {registry === "read" && devicesRead.stale && (
            <FleetReadNote
              testId="fleet-devices-read-stale"
              reason={devicesRead.failure}
            >
              The latest read of your devices failed. The devices offered below
              are from an earlier read and may be out of date.
            </FleetReadNote>
          )}
          {/* Add designation. Its App choice IS the registry and its Device
              choice IS the device list, so it is offered only when both were
              read. Otherwise a choice would be an empty list that reads as
              "none". */}
          {registry !== "read" ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="fleet-designate-needs-registry"
            >
              {registry === "admin-only"
                ? "Adding a designation needs the app registry, which only a platform administrator can read."
                : "Adding a designation needs the app registry, which could not be read. Refresh to try again."}
              {/* Said only when there ARE designations below to change. */}
              {registry === "admin-only" && targets.length > 0
                ? " The designations below can still be changed."
                : null}
            </p>
          ) : devicesRead.unknown ? (
            <FleetReadNote
              testId="fleet-devices-read-unknown"
              reason={devicesRead.failure}
            >
              Adding a designation needs your devices, which could not be read.
              Refresh to try again.
            </FleetReadNote>
          ) : (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleAddTarget();
              }}
            >
              <Select value={addDeviceId} onValueChange={setAddDeviceId}>
                <SelectTrigger
                  className="w-48"
                  size="sm"
                  data-testid="fleet-designate-device"
                >
                  <SelectValue placeholder="Device" />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name} ({device.derivedStatus})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={addAppId} onValueChange={setAddAppId}>
                <SelectTrigger
                  className="w-48"
                  size="sm"
                  data-testid="fleet-designate-app"
                >
                  <SelectValue placeholder="App" />
                </SelectTrigger>
                <SelectContent>
                  {apps.map((app) => (
                    <SelectItem key={app.app_id} value={app.app_id}>
                      {app.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Switch
                  checked={addAutoFresh}
                  onCheckedChange={setAddAutoFresh}
                />
                Auto-fresh
              </label>
              <Button
                type="submit"
                variant="brand-primary"
                size="sm"
                disabled={adding || !addDeviceId || !addAppId}
              >
                {adding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Add
              </Button>
            </form>
          )}

          {targetsRead.stale && (
            <FleetReadNote
              testId="fleet-targets-read-stale"
              reason={targetsRead.failure}
            >
              The latest read of the test-host designations failed. The
              designations below are from an earlier read and may be out of
              date.
            </FleetReadNote>
          )}
          {targetsRead.unknown ? (
            <FleetReadNote
              testId="fleet-targets-read-unknown"
              reason={targetsRead.failure}
            >
              The test-host designations could not be read, so whether any exist
              is unknown. Refresh to try again.
            </FleetReadNote>
          ) : targets.length === 0 ? (
            <div className="text-center py-8">
              <MonitorCheck className="size-10 mx-auto mb-3 text-muted-foreground" />
              <p
                className="text-sm text-muted-foreground"
                data-testid="fleet-targets-empty"
              >
                No test hosts designated yet.
                {/* Only when the add form above is offered. */}
                {addFormOffered ? " Add one above." : null}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {targets.map((target) => (
                <div
                  key={`${target.device_id}:${target.app_id}`}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Server className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {target.device_name}
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          → {target.app_id}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {target.hostname}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge
                      variant={deviceStatusBadgeVariant(target.derived_status)}
                    >
                      {target.derived_status}
                    </Badge>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={target.auto_fresh}
                        onCheckedChange={() => handleToggleAutoFresh(target)}
                        data-testid="fleet-target-auto-fresh"
                      />
                      Auto-fresh
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveTarget(target)}
                      aria-label={`Remove ${target.device_name} as test host for ${target.app_id}`}
                      data-testid="fleet-target-remove"
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Freshness */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <RefreshCw className="size-4" />
            Freshness
          </h3>
          <p className="text-xs text-muted-foreground">
            Deployment state per device and app, reported by the runner&apos;s
            auto-fresh engine. Refreshes every 10 seconds.
          </p>
        </div>
        <div className="p-4 space-y-3">
          {freshnessRead.stale && (
            <FleetReadNote
              testId="fleet-freshness-read-stale"
              reason={freshnessRead.failure}
            >
              The latest read of the deployment state failed. The rows below are
              from an earlier read and may be out of date.
            </FleetReadNote>
          )}
          {freshnessRead.unknown ? (
            <FleetReadNote
              testId="fleet-freshness-read-unknown"
              reason={freshnessRead.failure}
            >
              The deployment state could not be read, so whether any is reported
              is unknown. It is read again every 10 seconds.
            </FleetReadNote>
          ) : sortedFreshness.length === 0 ? (
            <div className="text-center py-8">
              <RefreshCw className="size-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No deployment state reported yet. Rows appear once a runner
                publishes build state for a designated app.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedFreshness.map((row) => (
                <div
                  key={`${row.device_id}:${row.app_id}`}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5"
                  title={row.last_error ?? undefined}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {row.device_name}
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          → {row.app_id}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Updated {relativeTime(row.updated_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {row.deployed_sha && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {row.deployed_sha.slice(0, 9)}
                      </span>
                    )}
                    <Badge variant={freshnessBadgeVariant(row.freshness)}>
                      {row.freshness}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
