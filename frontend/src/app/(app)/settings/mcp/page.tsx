"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useRunnerHealth,
  runnerApi,
  type McpServer,
  type McpServerStatus,
} from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Wifi,
  Terminal,
  Globe,
  Plus,
  Edit2,
  Trash2,
  Power,
  PowerOff,
  Wrench,
  ChevronDown,
  ChevronRight,
  Server,
  RefreshCw,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface ServerFormData {
  name: string;
  description: string;
  transport: "stdio" | "http";
  command: string;
  args: string;
  cwd: string;
  url: string;
  headers: string;
  timeout_seconds: number;
  enabled: boolean;
  auto_start: boolean;
}

const EMPTY_FORM: ServerFormData = {
  name: "",
  description: "",
  transport: "stdio",
  command: "",
  args: "",
  cwd: "",
  url: "",
  headers: "",
  timeout_seconds: 30,
  enabled: true,
  auto_start: false,
};

function serverToFormData(server: McpServer): ServerFormData {
  return {
    name: server.name,
    description: server.description ?? "",
    transport: server.transport,
    command: server.command ?? "",
    args: (server.args ?? []).join("\n"),
    cwd: server.cwd ?? "",
    url: server.url ?? "",
    headers:
      Object.keys(server.headers ?? {}).length > 0
        ? JSON.stringify(server.headers, null, 2)
        : "",
    timeout_seconds: server.timeout_seconds ?? 30,
    enabled: server.enabled,
    auto_start: server.auto_start,
  };
}

function formDataToPayload(form: ServerFormData): Omit<McpServer, "id"> {
  const args = form.args
    .split("\n")
    .map((a) => a.trim())
    .filter(Boolean);

  let headers: Record<string, string> = {};
  if (form.headers.trim()) {
    try {
      headers = JSON.parse(form.headers);
    } catch {
      // Try key:value per line format
      headers = {};
      for (const line of form.headers.split("\n")) {
        const idx = line.indexOf(":");
        if (idx > 0) {
          headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
    }
  }

  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    transport: form.transport,
    command: form.transport === "stdio" ? form.command.trim() || null : null,
    args: form.transport === "stdio" ? args : [],
    cwd: form.transport === "stdio" ? form.cwd.trim() || null : null,
    url: form.transport === "http" ? form.url.trim() || null : null,
    headers: form.transport === "http" ? headers : {},
    timeout_seconds: form.timeout_seconds,
    enabled: form.enabled,
    auto_start: form.auto_start,
  };
}

// ============================================================================
// Server Form Component
// ============================================================================

function ServerForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing,
}: {
  initialData: ServerFormData;
  onSubmit: (data: ServerFormData) => Promise<void>;
  onCancel: () => void;
  isEditing: boolean;
}) {
  const [form, setForm] = useState<ServerFormData>(initialData);
  const [submitting, setSubmitting] = useState(false);

  const update = (patch: Partial<ServerFormData>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Server name is required");
      return;
    }
    if (form.transport === "stdio" && !form.command.trim()) {
      toast.error("Command is required for stdio transport");
      return;
    }
    if (form.transport === "http" && !form.url.trim()) {
      toast.error("Server URL is required for HTTP transport");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(form);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="bg-surface-raised/30 border-brand-primary/30">
      <CardHeader>
        <CardTitle className="text-sm">
          {isEditing ? "Edit Server" : "Add Server"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Name */}
        <div className="space-y-1.5">
          <Label className="text-sm text-text-primary">
            Name <span className="text-red-400">*</span>
          </Label>
          <Input
            placeholder="e.g., filesystem-mcp"
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            className="bg-surface-raised/50 border-border-subtle/50"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-sm text-text-primary">Description</Label>
          <Input
            placeholder="Optional description"
            value={form.description}
            onChange={(e) => update({ description: e.target.value })}
            className="bg-surface-raised/50 border-border-subtle/50"
          />
        </div>

        {/* Transport */}
        <div className="space-y-1.5">
          <Label className="text-sm text-text-primary">Transport</Label>
          <div className="flex gap-2">
            <button
              onClick={() => update({ transport: "stdio" })}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-colors ${
                form.transport === "stdio"
                  ? "bg-brand-primary/10 border-brand-primary/30 text-brand-primary"
                  : "bg-surface-canvas/30 border-border-subtle/30 text-text-muted hover:text-text-primary"
              }`}
            >
              <Terminal className="size-4" />
              Stdio
            </button>
            <button
              onClick={() => update({ transport: "http" })}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-colors ${
                form.transport === "http"
                  ? "bg-brand-primary/10 border-brand-primary/30 text-brand-primary"
                  : "bg-surface-canvas/30 border-border-subtle/30 text-text-muted hover:text-text-primary"
              }`}
            >
              <Globe className="size-4" />
              HTTP
            </button>
          </div>
        </div>

        {/* Stdio fields */}
        {form.transport === "stdio" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-sm text-text-primary">
                Command <span className="text-red-400">*</span>
              </Label>
              <Input
                placeholder="e.g., npx -y @modelcontextprotocol/server-filesystem"
                value={form.command}
                onChange={(e) => update({ command: e.target.value })}
                className="bg-surface-raised/50 border-border-subtle/50 font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-text-primary">
                Arguments (one per line)
              </Label>
              <Textarea
                placeholder={"/path/to/allowed/dir\n/another/path"}
                value={form.args}
                onChange={(e) => update({ args: e.target.value })}
                rows={3}
                className="bg-surface-raised/50 border-border-subtle/50 font-mono text-sm resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-text-primary">
                Working Directory
              </Label>
              <Input
                placeholder="e.g., C:\projects\my-app"
                value={form.cwd}
                onChange={(e) => update({ cwd: e.target.value })}
                className="bg-surface-raised/50 border-border-subtle/50 text-sm"
              />
            </div>
          </>
        )}

        {/* HTTP fields */}
        {form.transport === "http" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-sm text-text-primary">
                Server URL <span className="text-red-400">*</span>
              </Label>
              <Input
                placeholder="http://localhost:3001/mcp"
                value={form.url}
                onChange={(e) => update({ url: e.target.value })}
                className="bg-surface-raised/50 border-border-subtle/50 font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-text-primary">
                Headers (JSON or key:value per line)
              </Label>
              <Textarea
                placeholder={'{"Authorization": "Bearer token"}'}
                value={form.headers}
                onChange={(e) => update({ headers: e.target.value })}
                rows={3}
                className="bg-surface-raised/50 border-border-subtle/50 font-mono text-sm resize-none"
              />
            </div>
          </>
        )}

        {/* Timeout */}
        <div className="space-y-1.5">
          <Label className="text-sm text-text-primary">Timeout (seconds)</Label>
          <Input
            type="number"
            min={1}
            max={300}
            value={form.timeout_seconds}
            onChange={(e) =>
              update({ timeout_seconds: Number(e.target.value) || 30 })
            }
            className="bg-surface-raised/50 border-border-subtle/50 text-sm w-32"
          />
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => update({ enabled: v })}
            />
            <Label className="text-sm text-text-primary">Enabled</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={form.auto_start}
              onCheckedChange={(v) => update({ auto_start: v })}
            />
            <Label className="text-sm text-text-primary">Auto-start</Label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-text-muted hover:text-text-primary"
          >
            Cancel
          </Button>
          <Button
            variant="brand-primary"
            size="sm"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {isEditing ? "Update" : "Create"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Server Card Component
// ============================================================================

function ServerCard({
  server,
  status,
  expanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onConnect,
  onDisconnect,
}: {
  server: McpServer;
  status?: McpServerStatus;
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete server "${server.name}"?`)) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      if (status?.connected) {
        await onDisconnect();
      } else {
        await onConnect();
      }
    } finally {
      setConnecting(false);
    }
  };

  const isConnected = status?.connected ?? false;
  const hasError = !!status?.error;
  const tools = status?.tools ?? [];

  return (
    <div
      className={`rounded-lg border transition-all ${
        server.enabled
          ? "border-border-subtle/50 bg-surface-canvas/30"
          : "border-border-subtle/30 bg-surface-canvas/10 opacity-60"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Transport Icon */}
          <div className="mt-0.5">
            {server.transport === "stdio" ? (
              <Terminal className="size-4 text-green-400" />
            ) : (
              <Globe className="size-4 text-blue-400" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <p className="text-sm font-semibold text-text-primary">
                {server.name}
              </p>
              {!server.enabled && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  Disabled
                </Badge>
              )}
              {server.auto_start && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  Auto-start
                </Badge>
              )}
              {/* Connection status dot */}
              <span
                className={`size-2 rounded-full ${
                  isConnected
                    ? "bg-green-400"
                    : hasError
                      ? "bg-red-400"
                      : "bg-gray-500"
                }`}
                title={
                  isConnected
                    ? "Connected"
                    : hasError
                      ? `Error: ${status?.error}`
                      : "Disconnected"
                }
              />
            </div>
            <p className="text-xs text-text-muted font-mono truncate">
              {server.transport === "stdio" ? server.command : server.url}
            </p>
            {hasError && (
              <p className="text-xs text-red-400 mt-1 truncate">
                {status?.error}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-text-primary"
              onClick={handleConnect}
              disabled={connecting}
              title={isConnected ? "Disconnect" : "Connect"}
            >
              {connecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isConnected ? (
                <PowerOff className="size-3.5" />
              ) : (
                <Power className="size-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-text-primary"
              onClick={onEdit}
              title="Edit"
            >
              <Edit2 className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-red-400"
              onClick={handleDelete}
              disabled={deleting}
              title="Delete"
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-text-primary"
              onClick={onToggleExpand}
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Expanded: Tools */}
      {expanded && (
        <div className="border-t border-border-subtle/30 px-4 py-3 bg-surface-canvas/10">
          {tools.length === 0 ? (
            <p className="text-xs text-text-muted italic">
              {isConnected
                ? "No tools available from this server"
                : "Connect to see available tools"}
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-text-muted mb-2 flex items-center gap-1.5">
                <Wrench className="size-3.5" />
                Available Tools ({tools.length})
              </p>
              {tools.map((tool) => (
                <div
                  key={tool.name}
                  className="flex items-start gap-2 px-2 py-1.5 rounded bg-surface-canvas/20"
                >
                  <code className="text-xs text-brand-primary font-mono whitespace-nowrap">
                    {tool.name}
                  </code>
                  {tool.description && (
                    <span className="text-xs text-text-muted truncate">
                      {tool.description}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function McpServersSettingsPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [serverStatuses, setServerStatuses] = useState<
    Record<string, McpServerStatus>
  >({});
  const [isAdding, setIsAdding] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    try {
      const data = await runnerApi.getSettingsMcpServers();
      setServers(data ?? []);
    } catch {
      toast.error("Failed to load MCP servers");
    }
  }, []);

  const loadStatuses = useCallback(async () => {
    try {
      const statuses = await runnerApi.getMcpServersStatus();
      const map: Record<string, McpServerStatus> = {};
      for (const s of statuses ?? []) {
        map[s.server_id] = s;
      }
      setServerStatuses(map);
    } catch {
      // Statuses are non-critical; silently ignore
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadServers(), loadStatuses()]);
    setLoading(false);
  }, [loadServers, loadStatuses]);

  useEffect(() => {
    if (isOffline) {
      setLoading(false);
      return;
    }
    loadAll();
  }, [isOffline, loadAll]);

  // Poll statuses
  useEffect(() => {
    if (isOffline) return;
    const interval = setInterval(loadStatuses, 10000);
    return () => clearInterval(interval);
  }, [isOffline, loadStatuses]);

  const handleCreate = async (form: ServerFormData) => {
    try {
      const payload = formDataToPayload(form);
      await runnerApi.createMcpServer(payload);
      toast.success(`Server "${form.name}" created`);
      setIsAdding(false);
      await loadAll();
    } catch (err) {
      toast.error(
        `Failed to create: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleUpdate = async (form: ServerFormData) => {
    if (!editingServer) return;
    try {
      const payload = formDataToPayload(form);
      await runnerApi.updateMcpServer(editingServer.id, payload);
      toast.success(`Server "${form.name}" updated`);
      setEditingServer(null);
      await loadAll();
    } catch (err) {
      toast.error(
        `Failed to update: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await runnerApi.deleteMcpServer(id);
      toast.success("Server deleted");
      await loadAll();
    } catch (err) {
      toast.error(
        `Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleConnect = async (id: string) => {
    try {
      await runnerApi.connectMcpServer(id);
      toast.success("Connecting...");
      // Refresh statuses after a short delay
      setTimeout(loadStatuses, 1500);
    } catch (err) {
      toast.error(
        `Failed to connect: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await runnerApi.disconnectMcpServer(id);
      toast.success("Disconnected");
      setTimeout(loadStatuses, 1000);
    } catch (err) {
      toast.error(
        `Failed to disconnect: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  if (healthLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  // Are we showing a form?
  const showForm = isAdding || editingServer !== null;

  return (
    <div className="p-6 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Wifi className="size-5" />
            MCP Servers
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Configure Model Context Protocol server connections
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={loadAll}
            className="text-text-muted hover:text-text-primary"
          >
            <RefreshCw className="size-4" />
          </Button>
          {!showForm && (
            <Button
              variant="brand-primary"
              size="sm"
              onClick={() => {
                setEditingServer(null);
                setIsAdding(true);
              }}
            >
              <Plus className="size-4" />
              Add Server
            </Button>
          )}
        </div>
      </div>

      {/* Add/Edit Form */}
      {isAdding && (
        <ServerForm
          initialData={EMPTY_FORM}
          onSubmit={handleCreate}
          onCancel={() => setIsAdding(false)}
          isEditing={false}
        />
      )}
      {editingServer && (
        <ServerForm
          initialData={serverToFormData(editingServer)}
          onSubmit={handleUpdate}
          onCancel={() => setEditingServer(null)}
          isEditing={true}
        />
      )}

      {/* Server List */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Server className="size-4" />
                Configured Servers
              </CardTitle>
              <CardDescription>
                MCP servers available for tool use
              </CardDescription>
            </div>
            {servers.length > 0 && (
              <Badge variant="secondary">{servers.length} servers</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {servers.length === 0 ? (
            <div className="text-center py-12">
              <Server className="size-10 mx-auto mb-3 text-text-muted" />
              <p className="text-sm text-text-muted mb-4">
                No MCP servers configured
              </p>
              {!showForm && (
                <Button
                  variant="brand-primary"
                  size="sm"
                  onClick={() => setIsAdding(true)}
                >
                  <Plus className="size-4" />
                  Add Your First Server
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {servers.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  status={serverStatuses[server.id]}
                  expanded={expandedServerId === server.id}
                  onToggleExpand={() =>
                    setExpandedServerId(
                      expandedServerId === server.id ? null : server.id
                    )
                  }
                  onEdit={() => {
                    setIsAdding(false);
                    setEditingServer(server);
                  }}
                  onDelete={() => handleDelete(server.id)}
                  onConnect={() => handleConnect(server.id)}
                  onDisconnect={() => handleDisconnect(server.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
