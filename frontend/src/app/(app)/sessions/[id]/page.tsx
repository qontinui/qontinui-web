"use client";

/**
 * Session detail page — Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Renders one `coord.sessions` row plus its event timeline (via SSE).
 * Phase 6 layers the Steal-with-reason action and ConflictRow on top
 * of this same surface.
 */

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionDetail } from "@/components/sessions/SessionDetail";
import { useDeviceStatusStream } from "@/components/operations/useDeviceStatusStream";

export default function SessionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const deviceStatus = useDeviceStatusStream();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  const hostnameFor = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of deviceStatus.byHostname.values()) {
      if (row.hostname) byId.set(row.device_id, row.hostname);
    }
    return (deviceId: string) => byId.get(deviceId);
  }, [deviceStatus.byHostname]);

  // Candidate handoff targets — every online device in the live
  // status stream. The HandoffModal filters out the session's own
  // device; coord also rejects a self-handoff with a 400.
  const handoffTargets = useMemo(
    () =>
      Array.from(deviceStatus.byHostname.values()).map((row) => ({
        device_id: row.device_id,
        hostname: row.hostname ?? "",
      })),
    [deviceStatus.byHostname]
  );

  if (!user) return null;

  // Next.js's `useParams` returns string | string[] | undefined.
  // The route is `[id]`, single-value; defensive collapse.
  const rawId = params?.id;
  const sessionId = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!sessionId) {
    return (
      <div
        className="h-[calc(100vh-44px)] flex items-center justify-center text-muted-foreground"
        data-ui-bridge-id="sessions.detail-missing-id"
      >
        <p className="text-sm">No session id in URL.</p>
      </div>
    );
  }

  return (
    <div
      className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
      data-ui-bridge-id="sessions.detail-page"
      data-session-id={sessionId}
    >
      <header className="flex items-center gap-2 px-6 py-3 border-b border-border shrink-0">
        <Activity className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Session</h1>
          <p className="text-xs text-muted-foreground font-mono">{sessionId}</p>
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-4">
          <SessionDetail
            sessionId={sessionId}
            hostnameFor={hostnameFor}
            handoffTargets={handoffTargets}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
