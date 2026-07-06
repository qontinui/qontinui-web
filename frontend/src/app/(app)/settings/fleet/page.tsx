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
import { listRunners } from "@/lib/api/runners";
import {
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

/** Freshness poll cadence — the auto-fresh engine flips states at
 *  pull/build cadence, so 10s is fresh enough without hot-looping. */
const FRESHNESS_POLL_MS = 10_000;

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

  // ---- Test-target section state ------------------------------------------
  const [targets, setTargets] = useState<TestTargetRow[]>([]);
  const [devices, setDevices] = useState<Runner[]>([]);
  const [addDeviceId, setAddDeviceId] = useState("");
  const [addAppId, setAddAppId] = useState("");
  const [addAutoFresh, setAddAutoFresh] = useState(false);
  const [adding, setAdding] = useState(false);

  // ---- Freshness section state --------------------------------------------
  const [freshness, setFreshness] = useState<FreshnessRow[]>([]);

  const [loading, setLoading] = useState(true);

  const fetchApps = useCallback(async () => {
    const rows = await listFleetApps();
    setApps(rows);
    setDrafts(
      Object.fromEntries(rows.map((app) => [app.app_id, draftFromApp(app)]))
    );
  }, []);

  const fetchTargets = useCallback(async () => {
    setTargets(await listTestTargets());
  }, []);

  const fetchFreshness = useCallback(async () => {
    setFreshness(await listFreshness());
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      await Promise.all([
        fetchApps(),
        fetchTargets(),
        fetchFreshness(),
        listRunners().then(setDevices),
      ]);
    } catch (err) {
      toast.error(
        `Failed to load fleet data: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setLoading(false);
    }
  }, [fetchApps, fetchTargets, fetchFreshness]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Poll freshness while mounted — silent on failure (a transient poll
  // error must not toast-storm; the next tick retries).
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
        // Empty string clears the command server-side.
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
      toast.error(
        `Failed to save: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSavingAppId(null);
    }
  };

  const handleToggleAutoFresh = async (target: TestTargetRow) => {
    try {
      await designateTestTarget(
        target.device_id,
        target.app_id,
        !target.auto_fresh
      );
      await fetchTargets();
    } catch (err) {
      toast.error(
        `Failed to toggle auto-fresh: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleRemoveTarget = async (target: TestTargetRow) => {
    try {
      await undesignateTestTarget(target.device_id, target.app_id);
      toast.success(
        `Removed ${target.device_name} as test host for ${target.app_id}`
      );
      await fetchTargets();
    } catch (err) {
      toast.error(
        `Failed to remove designation: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleAddTarget = async () => {
    if (!addDeviceId || !addAppId) return;
    setAdding(true);
    try {
      await designateTestTarget(addDeviceId, addAppId, addAutoFresh);
      toast.success("Test host designated");
      setAddDeviceId("");
      setAddAppId("");
      setAddAutoFresh(false);
      await fetchTargets();
    } catch (err) {
      toast.error(
        `Failed to designate test host: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setAdding(false);
    }
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
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
        <div className="p-4">
          {apps.length === 0 ? (
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
                        <SelectTrigger className="w-36" size="sm">
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
          {/* Add designation */}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleAddTarget();
            }}
          >
            <Select value={addDeviceId} onValueChange={setAddDeviceId}>
              <SelectTrigger className="w-48" size="sm">
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
              <SelectTrigger className="w-48" size="sm">
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

          {targets.length === 0 ? (
            <div className="text-center py-8">
              <MonitorCheck className="size-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No test hosts designated yet. Add one above.
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
                      />
                      Auto-fresh
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveTarget(target)}
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
        <div className="p-4">
          {sortedFreshness.length === 0 ? (
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
