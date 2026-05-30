"use client";

import { useEffect, useState } from "react";
import { useRunnerHealth, runnerApi, type DeviceInfo } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { useAuth } from "@/contexts/auth-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  User,
  Wifi,
  Tag,
  ExternalLink,
  Building2,
  Network,
  ChevronRight,
} from "lucide-react";
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
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  const isConnected = !!health;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <User className="size-5" />
          Account
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Connection status and identity information
        </p>
      </div>

      {/* Signed in as — identity + tenant */}
      {user ? (
        <div className="rounded-lg border border-border">
          <div className="px-4 py-3 border-b border-border bg-muted/50">
            <h3 className="text-sm font-medium">Signed in as</h3>
            <p className="text-xs text-muted-foreground">
              Your account and active tenant
            </p>
          </div>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
              <span
                data-content-role="label"
                data-content-label="email label"
                className="text-muted-foreground"
              >
                Email
              </span>
              <span
                data-content-role="body-text"
                data-content-label="user email"
                className="text-foreground"
              >
                {user.email}
              </span>

              <span
                data-content-role="label"
                data-content-label="username label"
                className="text-muted-foreground"
              >
                Username
              </span>
              <span
                data-content-role="body-text"
                data-content-label="username value"
                className="text-foreground"
              >
                {user.username}
              </span>

              {user.full_name && (
                <>
                  <span
                    data-content-role="label"
                    data-content-label="name label"
                    className="text-muted-foreground"
                  >
                    Name
                  </span>
                  <span
                    data-content-role="body-text"
                    data-content-label="user full name"
                    className="text-foreground"
                  >
                    {user.full_name}
                  </span>
                </>
              )}

              <span
                data-content-role="label"
                data-content-label="tenant label"
                className="text-muted-foreground flex items-center gap-1.5"
              >
                <Building2 className="size-3.5" />
                Tenant
              </span>
              <span
                data-content-role="body-text"
                data-content-label="tenant name"
                className="text-foreground"
              >
                {user.tenant_slug ?? (
                  <span className="text-muted-foreground italic">
                    Personal (default)
                  </span>
                )}
              </span>

              <span
                data-content-role="label"
                data-content-label="tenant id label"
                className="text-muted-foreground"
              >
                Tenant ID
              </span>
              <span
                data-content-role="body-text"
                data-content-label="tenant id value"
                className="text-foreground font-mono text-xs truncate"
              >
                {user.tenant_id ?? (
                  <span className="text-muted-foreground italic font-sans">
                    Not assigned
                  </span>
                )}
              </span>
            </div>

            <div className="pt-2 border-t border-border">
              <Link
                href="/profile"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                <ExternalLink className="size-3.5" />
                Manage account in Profile
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <div className="px-4 py-3 border-b border-border bg-muted/50">
            <h3 className="text-sm font-medium">Signed in as</h3>
            <p className="text-xs text-muted-foreground">
              You are not signed in
            </p>
          </div>
          <div className="p-4 space-y-2 text-sm text-muted-foreground">
            <p>Sign in to view your account info.</p>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
            >
              <ExternalLink className="size-3.5" />
              Go to sign in
            </Link>
          </div>
        </div>
      )}

      {/* Connected Runner */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Wifi className="size-4" />
            Connected Runner
          </h3>
          <p className="text-xs text-muted-foreground">
            Desktop runner connection status
          </p>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div
              className={`size-2.5 rounded-full ${
                isConnected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span
              data-content-role="status"
              data-content-label="connection status"
              className="text-sm text-foreground"
            >
              {isConnected ? "Connected" : "Disconnected"}
            </span>
            {health?.version && (
              <span
                data-content-role="label"
                data-content-label="runner version"
                className="text-xs text-muted-foreground"
              >
                v{health.version}
              </span>
            )}
          </div>

          {deviceInfo && (
            <div className="grid grid-cols-[120px_1fr] gap-y-2 text-sm pt-2 border-t border-border">
              <span
                data-content-role="label"
                data-content-label="device name label"
                className="text-muted-foreground flex items-center gap-1.5"
              >
                <Tag className="size-3.5" />
                Device Name
              </span>
              <span
                data-content-role="body-text"
                data-content-label="device name value"
                className="text-foreground font-mono text-xs"
              >
                {deviceInfo.device_name}
              </span>

              <span
                data-content-role="label"
                data-content-label="platform label"
                className="text-muted-foreground"
              >
                Platform
              </span>
              <span
                data-content-role="body-text"
                data-content-label="platform value"
                className="text-foreground font-mono text-xs"
              >
                {deviceInfo.platform}
              </span>

              <span
                data-content-role="label"
                data-content-label="device id label"
                className="text-muted-foreground"
              >
                Device ID
              </span>
              <span
                data-content-role="body-text"
                data-content-label="device id value"
                className="text-foreground font-mono text-xs truncate"
              >
                {deviceInfo.device_id}
              </span>
            </div>
          )}

          {/* Runner Name */}
          <div className="space-y-2 pt-2 border-t border-border">
            <Label className="text-sm text-muted-foreground">Runner Name</Label>
            <Input
              type="text"
              placeholder="My Runner"
              value={runnerName}
              onChange={(e) => setRunnerName(e.target.value)}
              className="bg-background border-border"
            />
            <p className="text-xs text-muted-foreground">
              Display name for this runner instance
            </p>
          </div>

          {health?.uptime_seconds != null && (
            <div
              data-content-role="metric"
              data-content-label="runner uptime"
              className="text-xs text-muted-foreground pt-2 border-t border-border"
            >
              Uptime: {formatUptime(health.uptime_seconds)}
            </div>
          )}
        </div>
      </div>

      {/* Coordination & automation — coord-tenant autonomous next-step settings */}
      <Link
        href="/settings/coordination"
        className="block rounded-lg border border-border p-4 hover:border-primary transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-medium flex items-center gap-2">
              <Network className="w-4 h-4" />
              Coordination &amp; automation
            </h2>
            <p className="text-xs text-muted-foreground">
              Configure whether coordination can autonomously start your next
              step of work when your session goes stale.
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </div>
      </Link>
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
