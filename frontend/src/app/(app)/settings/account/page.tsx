"use client";

import { useEffect, useState } from "react";
import { useRunnerHealth, runnerApi, type DeviceInfo } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { useAuth } from "@/contexts/auth-context";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, User, Wifi, Tag, ExternalLink } from "lucide-react";
import Link from "next/link";

export default function AccountSettingsPage() {
  const {
    isOffline,
    isLoading: healthLoading,
    data: health,
  } = useRunnerHealth();
  const { user } = useAuth();
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [runnerName, setRunnerName] = useState("");

  useEffect(() => {
    if (isOffline) {
      setLoading(false);
      return;
    }
    loadDeviceInfo();
  }, [isOffline]);

  const loadDeviceInfo = async () => {
    setLoading(true);
    try {
      const data = await runnerApi.getDeviceInfo();
      setDeviceInfo(data);
      setRunnerName(data.device_name || "");
    } catch {
      // Device info is optional, don't block the page
    } finally {
      setLoading(false);
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

  const isConnected = !!health;

  return (
    <div className="p-6 max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
          <User className="size-5" />
          Account
        </h2>
        <p className="text-sm text-text-muted mt-1">
          Connection status and identity information
        </p>
      </div>

      {/* User Info */}
      {user && (
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader>
            <CardTitle className="text-sm">User Account</CardTitle>
            <CardDescription>
              Your qontinui.io account information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
              <span className="text-text-muted">Email</span>
              <span className="text-text-primary">{user.email}</span>

              <span className="text-text-muted">Username</span>
              <span className="text-text-primary">{user.username}</span>

              {user.full_name && (
                <>
                  <span className="text-text-muted">Name</span>
                  <span className="text-text-primary">{user.full_name}</span>
                </>
              )}
            </div>

            <div className="pt-2 border-t border-border-subtle/30">
              <Link
                href="/profile"
                className="inline-flex items-center gap-1.5 text-sm text-brand-primary hover:text-brand-primary/80 transition-colors"
              >
                <ExternalLink className="size-3.5" />
                Manage account in Profile
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Connected Runner */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Wifi className="size-4" />
            Connected Runner
          </CardTitle>
          <CardDescription>Desktop runner connection status</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div
              className={`size-2.5 rounded-full ${
                isConnected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-sm text-text-primary">
              {isConnected ? "Connected" : "Disconnected"}
            </span>
            {health?.version && (
              <span className="text-xs text-text-muted">v{health.version}</span>
            )}
          </div>

          {deviceInfo && (
            <div className="grid grid-cols-[120px_1fr] gap-y-2 text-sm pt-2 border-t border-border-subtle/30">
              <span className="text-text-muted flex items-center gap-1.5">
                <Tag className="size-3.5" />
                Device Name
              </span>
              <span className="text-text-primary font-mono text-xs">
                {deviceInfo.device_name}
              </span>

              <span className="text-text-muted">Platform</span>
              <span className="text-text-primary font-mono text-xs">
                {deviceInfo.platform}
              </span>

              <span className="text-text-muted">Device ID</span>
              <span className="text-text-primary font-mono text-xs truncate">
                {deviceInfo.device_id}
              </span>
            </div>
          )}

          {/* Runner Name */}
          <div className="space-y-2 pt-2 border-t border-border-subtle/30">
            <Label className="text-sm text-text-muted">Runner Name</Label>
            <Input
              type="text"
              placeholder="My Runner"
              value={runnerName}
              onChange={(e) => setRunnerName(e.target.value)}
              className="bg-surface-canvas/50 border-border-subtle/50"
            />
            <p className="text-xs text-text-muted">
              Display name for this runner instance
            </p>
          </div>

          {health?.uptime_seconds != null && (
            <div className="text-xs text-text-muted pt-2 border-t border-border-subtle/30">
              Uptime: {formatUptime(health.uptime_seconds)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
