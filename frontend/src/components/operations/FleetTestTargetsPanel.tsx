"use client";

/**
 * FleetTestTargetsPanel — fleet-fresh test-target routing (plan
 * `2026-06-20-fleet-fresh-test-target-routing.md`, phase P5).
 *
 * One panel on /admin/coord/fleet that ties together the three P5 surfaces:
 *  - App config editor: update_strategy (pull_only | pull_build) + build/start
 *    commands (PATCH /api/v1/fleet/apps/{app_id}).
 *  - Per-device/per-app freshness badges (fresh | building | failed | unknown),
 *    joined server-side from project.app_deploy_state.
 *  - Designate-test-host + auto_fresh toggle (PUT/DELETE
 *    /api/v1/fleet/test-targets/{device_id}/{app_id}, writing coord.test_targets).
 *  - "Run on fresh host" affordance (POST /api/v1/dispatch/fresh-host).
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Rocket, Server, Trash2, Save, RefreshCw } from "lucide-react";
import { httpClient } from "@/services/service-factory";
import { CollapsiblePanel } from "@/components/operations/CollapsiblePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const API = "/api/v1";
const POLL_INTERVAL_MS = 15_000;

type UpdateStrategy = "pull_only" | "pull_build";

interface AppConfig {
  app_id: string;
  display_name: string;
  repo_root: string;
  update_strategy: UpdateStrategy;
  build_command: string | null;
  start_command: string | null;
}

interface TestTargetRow {
  device_id: string;
  app_id: string;
  auto_fresh: boolean;
  device_name: string;
  hostname: string;
  derived_status: string;
  freshness: string | null;
  deployed_sha: string | null;
  deployed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DeviceWire {
  id: string;
  name: string;
  hostname: string;
  derivedStatus?: string;
}

interface FreshHostResponse {
  device_id: string;
  device_name: string;
  hostname: string;
  port: number | null;
  freshness_status: string;
}

type BadgeVariant =
  | "success"
  | "info"
  | "warning"
  | "destructive"
  | "secondary"
  | "outline";

/** Map a freshness state to a badge variant + label. */
function freshnessBadge(freshness: string | null): {
  variant: BadgeVariant;
  label: string;
} {
  switch (freshness) {
    case "fresh":
      return { variant: "success", label: "fresh" };
    case "building":
      return { variant: "info", label: "building" };
    case "failed":
      return { variant: "destructive", label: "failed" };
    case "stale":
      return { variant: "warning", label: "stale" };
    default:
      return { variant: "outline", label: "unknown" };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Per-app card: config editor + designations + run-on-fresh-host.
 */
function AppCard({
  app,
  targets,
  devices,
  onChanged,
}: {
  app: AppConfig;
  targets: TestTargetRow[];
  devices: DeviceWire[];
  onChanged: () => void;
}) {
  const [strategy, setStrategy] = useState<UpdateStrategy>(app.update_strategy);
  const [buildCommand, setBuildCommand] = useState(app.build_command ?? "");
  const [startCommand, setStartCommand] = useState(app.start_command ?? "");
  const [saving, setSaving] = useState(false);
  const [designateDevice, setDesignateDevice] = useState<string>("");
  const [dispatching, setDispatching] = useState(false);

  // Keep local edit state in sync when a poll refreshes the underlying app.
  useEffect(() => {
    setStrategy(app.update_strategy);
    setBuildCommand(app.build_command ?? "");
    setStartCommand(app.start_command ?? "");
  }, [app.update_strategy, app.build_command, app.start_command]);

  const dirty =
    strategy !== app.update_strategy ||
    buildCommand !== (app.build_command ?? "") ||
    startCommand !== (app.start_command ?? "");

  const saveConfig = useCallback(async () => {
    setSaving(true);
    try {
      await httpClient.patch(`${API}/fleet/apps/${app.app_id}`, {
        update_strategy: strategy,
        build_command: buildCommand,
        start_command: startCommand,
      });
      toast.success(`Saved config for ${app.display_name}`);
      onChanged();
    } catch (e) {
      toast.error(`Save failed: ${errMsg(e)}`);
    } finally {
      setSaving(false);
    }
  }, [app.app_id, app.display_name, strategy, buildCommand, startCommand, onChanged]);

  const designate = useCallback(
    async (deviceId: string, autoFresh: boolean) => {
      try {
        await httpClient.put(
          `${API}/fleet/test-targets/${deviceId}/${app.app_id}`,
          { auto_fresh: autoFresh }
        );
        onChanged();
      } catch (e) {
        toast.error(`Designation failed: ${errMsg(e)}`);
      }
    },
    [app.app_id, onChanged]
  );

  const undesignate = useCallback(
    async (deviceId: string) => {
      try {
        await httpClient.delete(
          `${API}/fleet/test-targets/${deviceId}/${app.app_id}`
        );
        onChanged();
      } catch (e) {
        toast.error(`Remove failed: ${errMsg(e)}`);
      }
    },
    [app.app_id, onChanged]
  );

  const addDesignation = useCallback(async () => {
    if (!designateDevice) return;
    await designate(designateDevice, false);
    setDesignateDevice("");
  }, [designateDevice, designate]);

  const runOnFreshHost = useCallback(async () => {
    setDispatching(true);
    try {
      const res = await httpClient.post<FreshHostResponse>(
        `${API}/dispatch/fresh-host?app_id=${encodeURIComponent(
          app.app_id
        )}&strategy=best_effort`
      );
      toast.success(
        `Resolved ${res.device_name} (${res.freshness_status}) for ${app.display_name}`
      );
    } catch (e) {
      toast.error(`No host available: ${errMsg(e)}`);
    } finally {
      setDispatching(false);
    }
  }, [app.app_id, app.display_name]);

  const designatedIds = new Set(targets.map((t) => t.device_id));
  const undesignated = devices.filter((d) => !designatedIds.has(d.id));

  return (
    <div
      className="rounded-lg border border-border p-4 space-y-3"
      data-testid="fleet-target-app-card"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Server className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium truncate">{app.display_name}</span>
          <span className="font-mono text-xs text-muted-foreground truncate">
            {app.app_id}
          </span>
          <Badge variant="outline">{strategy}</Badge>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={runOnFreshHost}
          disabled={dispatching}
          data-testid="fleet-target-run-fresh"
        >
          <Rocket className="h-3.5 w-3.5 mr-1" />
          Run on fresh host
        </Button>
      </div>

      {/* Config editor */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Update strategy</Label>
          <Select
            value={strategy}
            onValueChange={(v) => setStrategy(v as UpdateStrategy)}
          >
            <SelectTrigger
              className="h-8"
              data-testid="fleet-target-strategy-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pull_only">pull_only</SelectItem>
              <SelectItem value="pull_build">pull_build</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button
            size="sm"
            onClick={saveConfig}
            disabled={!dirty || saving}
            data-testid="fleet-target-save-config"
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>
        </div>
        {strategy === "pull_build" && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Build command</Label>
              <Input
                className="h-8 font-mono text-xs"
                value={buildCommand}
                placeholder="npm run build"
                onChange={(e) => setBuildCommand(e.target.value)}
                data-testid="fleet-target-build-command"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Start command</Label>
              <Input
                className="h-8 font-mono text-xs"
                value={startCommand}
                placeholder="npm run start"
                onChange={(e) => setStartCommand(e.target.value)}
                data-testid="fleet-target-start-command"
              />
            </div>
          </>
        )}
      </div>

      {/* Designated test hosts */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Designated test hosts
        </p>
        {targets.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No designated hosts for this app.
          </p>
        ) : (
          <ul className="space-y-1">
            {targets.map((t) => {
              const badge = freshnessBadge(t.freshness);
              return (
                <li
                  key={t.device_id}
                  className="flex items-center justify-between gap-2 text-sm"
                  data-testid="fleet-target-host-row"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate">{t.device_name}</span>
                    <span className="font-mono text-xs text-muted-foreground truncate">
                      {t.hostname}
                    </span>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {t.deployed_sha && (
                      <span
                        className="font-mono text-[10px] text-muted-foreground"
                        title={t.deployed_sha}
                      >
                        {t.deployed_sha.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1">
                      <Switch
                        id={`auto-fresh-${app.app_id}-${t.device_id}`}
                        checked={t.auto_fresh}
                        onCheckedChange={(v) => designate(t.device_id, v)}
                        data-testid="fleet-target-auto-fresh"
                      />
                      <Label
                        htmlFor={`auto-fresh-${app.app_id}-${t.device_id}`}
                        className="text-xs text-muted-foreground"
                      >
                        auto-fresh
                      </Label>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => undesignate(t.device_id)}
                      data-testid="fleet-target-remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Designate a new device */}
        {undesignated.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <Select value={designateDevice} onValueChange={setDesignateDevice}>
              <SelectTrigger
                className="h-8 w-56"
                data-testid="fleet-target-designate-select"
              >
                <SelectValue placeholder="Designate a device…" />
              </SelectTrigger>
              <SelectContent>
                {undesignated.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name} ({d.hostname})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={addDesignation}
              disabled={!designateDevice}
              data-testid="fleet-target-designate-add"
            >
              Designate
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function FleetTestTargetsPanel() {
  const [apps, setApps] = useState<AppConfig[]>([]);
  const [targets, setTargets] = useState<TestTargetRow[]>([]);
  const [devices, setDevices] = useState<DeviceWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [appList, targetList, deviceList] = await Promise.all([
        httpClient.get<AppConfig[]>(`${API}/fleet/apps`),
        httpClient.get<TestTargetRow[]>(`${API}/fleet/test-targets`),
        httpClient.get<DeviceWire[]>(`${API}/devices`),
      ]);
      setApps(appList);
      setTargets(targetList);
      setDevices(deviceList);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const targetsByApp = (appId: string) =>
    targets.filter((t) => t.app_id === appId);

  return (
    <CollapsiblePanel
      data-testid="fleet-test-targets"
      storageKey="fleet:test-targets"
      icon={<Rocket className="h-4 w-4" />}
      title="Fresh test hosts"
      contentClassName="space-y-3"
      summary={
        <Badge variant="outline" className="ml-2">
          {apps.length}
        </Badge>
      }
      headerActions={
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchData}
          data-testid="fleet-test-targets-refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      }
    >
      {error && (
        <p className="text-sm text-destructive">
          Failed to load fleet targets: {error}
        </p>
      )}
      {loading && apps.length === 0 ? (
        <Skeleton className="h-24 w-full" />
      ) : apps.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No registered apps. Register an app on a runner to configure
          fleet-fresh routing.
        </p>
      ) : (
        apps.map((app) => (
          <AppCard
            key={app.app_id}
            app={app}
            targets={targetsByApp(app.app_id)}
            devices={devices}
            onChanged={fetchData}
          />
        ))
      )}
    </CollapsiblePanel>
  );
}
