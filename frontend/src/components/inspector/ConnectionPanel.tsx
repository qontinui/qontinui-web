"use client";

import { useState } from "react";
import type { SdkConnection } from "@/hooks/use-inspector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Unplug,
  CheckCircle2,
  AlertCircle,
  Plug,
  RefreshCw,
  Search,
  Plus,
} from "lucide-react";

interface ConnectionPanelProps {
  connections: SdkConnection[];
  activeConnection: SdkConnection | null;
  connectUrl: string;
  onConnectUrlChange: (url: string) => void;
  isConnecting: boolean;
  onConnect: (url: string) => Promise<void>;
  onDisconnect: (url?: string) => Promise<void>;
  onSwitch: (url: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onDiscover: () => Promise<void>;
  isDiscovering: boolean;
  elementCount: number;
  error: string | null;
}

export function ConnectionPanel({
  connections,
  activeConnection,
  connectUrl,
  onConnectUrlChange,
  isConnecting,
  onConnect,
  onDisconnect,
  onSwitch,
  onRefresh,
  onDiscover,
  isDiscovering,
  elementCount,
  error,
}: ConnectionPanelProps) {
  const [showConnectInput, setShowConnectInput] = useState(false);

  const handleConnect = () => {
    if (connectUrl.trim()) {
      onConnect(connectUrl.trim());
      onConnectUrlChange("");
      setShowConnectInput(false);
    }
  };

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50">
      <CardHeader className="pb-2 pt-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Plug className="w-3.5 h-3.5" />
            Connected Apps
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onRefresh}
              className="text-text-muted hover:text-white h-7 px-2"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
            {activeConnection && (
              <Badge variant="success" className="text-[10px] gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Connected
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pb-3">
        {/* App dropdown */}
        {connections.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={activeConnection?.url ?? ""}
              onChange={(e) => {
                if (e.target.value) {
                  onSwitch(e.target.value);
                }
              }}
              className="flex-1 h-9 rounded-md border border-border-subtle/50 bg-surface-raised/50 px-3 text-sm text-white focus:border-purple-500/50 focus:outline-none"
            >
              {connections.map((conn) => (
                <option key={conn.url} value={conn.url}>
                  {conn.app.appName || conn.url}
                  {conn.app.appName ? ` (${conn.url})` : ""}
                </option>
              ))}
            </select>
            {activeConnection && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onDisconnect(activeConnection.url)}
                className="h-9"
              >
                <Unplug className="w-3.5 h-3.5 mr-1.5" />
                Disconnect
              </Button>
            )}
          </div>
        )}

        {/* Connect new app */}
        {showConnectInput ? (
          <div className="flex items-center gap-2">
            <Input
              placeholder="http://localhost:3001"
              value={connectUrl}
              onChange={(e) => onConnectUrlChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              className="flex-1 h-8 bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted text-sm"
              autoFocus
            />
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={isConnecting || !connectUrl.trim()}
              className="h-8"
            >
              {isConnecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plug className="w-3.5 h-3.5 mr-1.5" />
              )}
              {isConnecting ? "" : "Connect"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowConnectInput(false)}
              className="h-8 px-2"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowConnectInput(true)}
              className="h-8"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Connect New App
            </Button>
            <Button
              onClick={onDiscover}
              disabled={isDiscovering || !activeConnection}
              size="sm"
              variant="outline"
              className="h-8"
            >
              {isDiscovering ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <Search className="w-3.5 h-3.5 mr-1.5" />
              )}
              Discover Elements
            </Button>
            {elementCount > 0 && (
              <span className="text-xs text-text-muted">
                {elementCount} element{elementCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <p className="text-xs">{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
