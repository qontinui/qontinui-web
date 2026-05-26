"use client";

/**
 * Live Sessions page — Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * The dashboard-facing surface for coord-native sessions. Reads from
 * the backend proxy at `/api/v1/operations/sessions` (which forwards
 * to `coord.qontinui.io/sessions`).
 *
 * Sibling pages that share this surface:
 *   - `/operations` (Fleet Overview, device-hardware-only after this
 *     PR strips the activity sub-line from MachineCard)
 *   - `/sessions/[id]` (this PR — session detail view)
 */

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionsList } from "@/components/sessions/SessionsList";
import { TenantSwitcher } from "@/components/sessions/TenantSwitcher";
import { useDeviceStatusStream } from "@/components/operations/useDeviceStatusStream";

export default function SessionsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const tenant = useTenant();
  const deviceStatus = useDeviceStatusStream();

  // Redirect unauthenticated users to the marketing root. Same posture
  // as the rest of the (app) shell.
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  // Build a device_id → hostname resolver from the live
  // device-status stream. Sessions store device_id (UUID); operators
  // recognize hostnames.
  const hostnameFor = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of deviceStatus.byHostname.values()) {
      if (row.hostname) byId.set(row.device_id, row.hostname);
    }
    return (deviceId: string) => byId.get(deviceId);
  }, [deviceStatus.byHostname]);

  if (!user) return null;

  return (
    <div
      className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
      data-ui-bridge-id="sessions.page"
    >
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">Live Sessions</h1>
            <p className="text-xs text-muted-foreground">
              Coord-native sessions across machines — Terminal, Claude,
              agentic, workflow, automation, debug. Heartbeat cadence
              15s; stale at 45s, auto-close at 180s.
            </p>
          </div>
        </div>
        {/*
         * Tenant switcher only renders when the operator belongs to
         * >1 tenant (plan §D12). Single-tenant operators see nothing
         * — the choice is structurally hidden.
         */}
        <div className="flex items-center gap-3">
          {tenant.error && (
            <span
              className="text-xs text-red-300"
              data-ui-bridge-id="sessions.tenant-error"
              title={tenant.error}
            >
              tenant resolve failed
            </span>
          )}
          <TenantSwitcher />
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-4">
          <SessionsList hostnameFor={hostnameFor} />
        </div>
      </ScrollArea>
    </div>
  );
}
