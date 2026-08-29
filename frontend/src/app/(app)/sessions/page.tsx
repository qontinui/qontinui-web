"use client";

/**
 * /sessions — the consolidated sessions console.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` Phase 1. Was Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`, which rendered a fat
 * `<Card>` per session grouped by machine.
 *
 * ## What changed and what deliberately did not
 *
 * The hero is now `SessionsConsole` — one line per session over
 * `@/components/console`, reading ONE consolidated list
 * (`GET /operations/sessions?shape=consolidated`) that joins `coord.sessions`
 * to `coord.agent_sessions` with an explicit `row_class` discriminant. Three
 * routes' worth of session surfaces answer the same question today
 * (`/sessions`, `/admin/agent-sessions`, `/environments/sessions`); this is
 * the one they collapse onto.
 *
 * **`sessions.page` is carried forward verbatim** — Spec-CI asserts on it
 * (trap 5), and a testid must not be renamed in the PR that moves what it
 * points at.
 *
 * **The old list is still mounted, behind a disclosure.** Phase 1 is additive
 * on purpose: the two shapes have to be comparable against a live fleet before
 * Phase 3 deletes anything. `SessionsList` and its 394-line `SessionCard` are
 * removed there, not here.
 *
 * `TenantSwitcher` stays and renders only for operators in more than one
 * tenant (trap 10). Tenant scoping itself is coord's, on the forwarded bearer
 * — nothing on this page filters by tenant.
 */

import { useMemo } from "react";
import { Activity } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CollapsiblePanel } from "@/components/console";
import { SessionsConsole } from "@/components/sessions/SessionsConsole";
import { SessionsList } from "@/components/sessions/SessionsList";
import { TenantSwitcher } from "@/components/sessions/TenantSwitcher";
import { useDeviceStatusStream } from "@/components/operations/useDeviceStatusStream";

export default function SessionsPage() {
  const { user } = useAuth();
  const tenant = useTenant();
  const deviceStatus = useDeviceStatusStream();
  const searchParams = useSearchParams();
  // `?device=` — `environments/machines/page.tsx` already builds exactly this
  // deep link against `/environments/sessions`, and Phase 3's 308 preserves it
  // verbatim onto this route.
  const device = searchParams.get("device") ?? undefined;

  // Build a device_id → hostname resolver from the live device-status stream.
  // Sessions store device_id (UUID); operators recognize hostnames.
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
            <h1 className="text-lg font-semibold">Sessions</h1>
            <p className="text-xs text-muted-foreground">
              Every coord session on the fleet — lifecycle rows, agent-session
              lineage rows, and the ones that are both. Heartbeat cadence 15s;
              stale at 45s, auto-close at 180s.
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
        <div className="px-6 py-4 space-y-4">
          <SessionsConsole hostnameFor={hostnameFor} initialDevice={device} />

          {/*
           * The pre-consolidation surface, kept reachable for exactly one
           * phase so the two can be compared on a live fleet. It is COLLAPSED,
           * so its 5s poll and its per-session cards do not mount until an
           * operator opens it — `CollapsiblePanel` unmounts its children.
           * Deleted by Phase 3 together with `SessionCard.tsx`.
           */}
          <CollapsiblePanel
            title="Previous card view"
            summary="the pre-consolidation grouped-card list, for side-by-side comparison — removed in Phase 3"
            defaultOpen={false}
            data-testid="sessions-legacy-cards"
          >
            <SessionsList hostnameFor={hostnameFor} />
          </CollapsiblePanel>
        </div>
      </ScrollArea>
    </div>
  );
}
