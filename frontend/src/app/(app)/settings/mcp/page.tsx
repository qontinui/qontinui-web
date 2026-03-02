"use client";

import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Wifi, Plus, Server, RefreshCw } from "lucide-react";
import { useMcpServers } from "./_hooks/useMcpServers";
import { ServerForm } from "./_components/ServerForm";
import { ServerCard } from "./_components/ServerCard";
import { EMPTY_FORM, serverToFormData } from "./types";

export default function McpServersSettingsPage() {
  const {
    isOffline,
    healthLoading,
    loading,
    servers,
    serverStatuses,
    isAdding,
    editingServer,
    expandedServerId,
    showForm,
    loadAll,
    handleCreate,
    handleUpdate,
    handleDelete,
    handleConnect,
    handleDisconnect,
    startAdding,
    cancelAdding,
    startEditing,
    cancelEditing,
    toggleExpanded,
  } = useMcpServers();

  if (healthLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Wifi className="size-5" />
            MCP Servers
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure Model Context Protocol server connections
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={loadAll}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="size-4" />
          </Button>
          {!showForm && (
            <Button variant="brand-primary" size="sm" onClick={startAdding}>
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
          onCancel={cancelAdding}
          isEditing={false}
        />
      )}
      {editingServer && (
        <ServerForm
          initialData={serverToFormData(editingServer)}
          onSubmit={handleUpdate}
          onCancel={cancelEditing}
          isEditing={true}
        />
      )}

      {/* Server List */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Server className="size-4" />
                Configured Servers
              </h3>
              <p className="text-xs text-muted-foreground">
                MCP servers available for tool use
              </p>
            </div>
            {servers.length > 0 && (
              <Badge variant="secondary">{servers.length} servers</Badge>
            )}
          </div>
        </div>
        <div className="p-4">
          {servers.length === 0 ? (
            <div className="text-center py-12">
              <Server className="size-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-4">
                No MCP servers configured
              </p>
              {!showForm && (
                <Button variant="brand-primary" size="sm" onClick={startAdding}>
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
                  onToggleExpand={() => toggleExpanded(server.id)}
                  onEdit={() => startEditing(server)}
                  onDelete={() => handleDelete(server.id)}
                  onConnect={() => handleConnect(server.id)}
                  onDisconnect={() => handleDisconnect(server.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
