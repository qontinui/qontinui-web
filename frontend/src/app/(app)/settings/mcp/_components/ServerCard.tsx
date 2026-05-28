"use client";

import { useState } from "react";
import type { McpServer, McpServerStatus } from "@/lib/runner-api";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Terminal,
  Globe,
  Edit2,
  Trash2,
  Power,
  PowerOff,
  Wrench,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

export function ServerCard({
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
          ? "border-border bg-background"
          : "border-border bg-background opacity-60"
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
              <p className="text-sm font-semibold text-foreground">
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
                data-content-role="status"
                data-content-label="server connection status"
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
            <p className="text-xs text-muted-foreground font-mono truncate">
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
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
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
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onEdit}
              title="Edit"
            >
              <Edit2 className="size-3.5" />
            </Button>
            <DestructiveButton
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-red-400"
              onClick={handleDelete}
              disabled={deleting}
              title="Delete"
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </DestructiveButton>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
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
        <div className="border-t border-border px-4 py-3 bg-background">
          {tools.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              {isConnected
                ? "No tools available from this server"
                : "Connect to see available tools"}
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <Wrench className="size-3.5" />
                Available Tools ({tools.length})
              </p>
              {tools.map((tool) => (
                <div
                  key={tool.name}
                  className="flex items-start gap-2 px-2 py-1.5 rounded bg-background"
                >
                  <code className="text-xs text-primary font-mono whitespace-nowrap">
                    {tool.name}
                  </code>
                  {tool.description && (
                    <span
                      data-content-role="description"
                      data-content-label="tool description"
                      className="text-xs text-muted-foreground truncate"
                    >
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
