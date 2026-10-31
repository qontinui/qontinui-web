"use client";

/**
 * /admin/coord/spawns/requests — the spawn requests investigation view: every
 * request coord was asked to place in the window, filtered by how it ended
 * (R6), each with where it went, how long it waited and its device timeline
 * (R5), and the per-device placement.
 *
 * The agentic-activity page (`/admin/coord/spawns`) shows these as counts and
 * links here: a per-request list is a triage queue at agent altitude, which
 * the operator reaches when a count calls for it, not as the default view.
 *
 * It is an operator surface. It is in no nav and not in
 * `PRESENTATION_READY_ROUTES`, so while presenting the lens layout withholds
 * it (`PresentationPage`) and no lens link leads to it. Every UNKNOWN arm the
 * list had on the agentic-activity page it keeps (`SpawnRequestList`,
 * `DevicePlacement`, `LedgerReadBanners`): an unread count is a dash, never 0,
 * and an undeployed ledger is said to be one.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RefreshButton } from "@/components/console";
import { usePresentationMode } from "@/components/presentation";
import { useFleetDispatchRoles } from "@/components/operations/useFleetDispatchRoles";
import { useFleetHealth } from "@/components/operations/useFleetHealth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SpawnStatsWindow } from "@/lib/api/operations/coordSpawns";
import { DevicePlacement } from "../_components/DevicePlacement";
import { LedgerReadBanners } from "../_components/LedgerReadBanners";
import { SpawnRequestList } from "../_components/SpawnRequestList";
import { SPAWN_WINDOWS, windowSpec } from "../_lib/spawnStatus";
import { windowFromQuery } from "../_lib/spawnRequestsRoute";
import { SPAWNS_SOURCES } from "../_lib/spawnsSources";
import { SPAWNS_POLL_MS, useSpawnLedger } from "../_lib/useSpawnLedger";
import {
  useDeviceNaming,
  useDeviceRoles,
  usePageClock,
} from "../_lib/useSpawnPageContext";

/** The agentic-activity page this view investigates for. */
const SPAWNS_HREF = "/admin/coord/spawns";

/** The window shown when the link carried none this view offers. */
const DEFAULT_WINDOW: SpawnStatsWindow = "7d";

/** Stable identity for "no devices", so memos keyed on it hold. */
const NO_DEVICES: never[] = [];

export default function CoordSpawnRequestsPage() {
  const { presenting } = usePresentationMode();
  // `null` until `?window=` is read: the ledger reads nothing before then, so
  // its first read is the linked window's rather than a default one's.
  const [chosenWindow, setWindowId] = useState<SpawnStatsWindow | null>(null);
  // `?window=` is read once on mount from `window.location`, as
  // `/admin/coord/findings?id=` does: a one-shot read is not worth putting a
  // client page behind the Suspense boundary `useSearchParams` needs.
  useEffect(() => {
    setWindowId(windowFromQuery(window.location.search) ?? DEFAULT_WINDOW);
  }, []);
  const windowId = chosenWindow ?? DEFAULT_WINDOW;
  const ledger = useSpawnLedger(chosenWindow);
  const fleet = useFleetHealth();
  const dispatchRoles = useFleetDispatchRoles();
  const roster = useMemo(() => fleet.data?.devices ?? NO_DEVICES, [fleet.data]);
  const naming = useDeviceNaming(roster, presenting);
  const roles = useDeviceRoles(dispatchRoles.read);
  const nowMs = usePageClock();
  const spec = windowSpec(windowId);

  const refreshAll = () =>
    Promise.allSettled([
      ledger.refresh(),
      fleet.refresh(),
      dispatchRoles.refresh(),
    ]);

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-spawn-requests-page"
      data-ui-bridge-id="coord-spawn-requests-page"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={SPAWNS_HREF}
          className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline"
          data-testid="coord-spawn-requests-back"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden /> Agentic activity
        </Link>
        <RefreshButton
          onRefresh={refreshAll}
          label="Refresh spawn requests"
          title={`Re-reads the spawn ledger, the roster and the dispatch roles now; the page also refreshes itself (the ledger every ${SPAWNS_POLL_MS / 1000} s)`}
          data-testid="coord-spawns-refresh"
        />
        <Select
          value={windowId}
          onValueChange={(v) => setWindowId(v as SpawnStatsWindow)}
        >
          <SelectTrigger
            className="h-8 w-[150px] text-xs"
            aria-label="Window"
            data-testid="coord-spawns-window"
            title="The window the list and the placement cover: requests first requested in it. Requests still waiting are listed whatever their age."
          >
            <SelectValue placeholder="window" />
          </SelectTrigger>
          <SelectContent>
            {SPAWN_WINDOWS.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <LedgerReadBanners
        ledger={ledger}
        presenting={presenting}
        retainedSubject="the rows below"
      />

      <SpawnRequestList
        // A new window is a new list: its filter and open row start over.
        key={windowId}
        ledger={ledger}
        windowLabel={spec.label}
        naming={naming}
        nowMs={nowMs}
      />

      <DevicePlacement
        stats={ledger.stats.data}
        statsStale={ledger.stats.issue !== null}
        roles={roles}
        naming={naming}
        windowLabel={spec.label}
        sources={[
          {
            source: SPAWNS_SOURCES.ledger,
            asOf: ledger.stats.data?.as_of ?? null,
          },
          { source: SPAWNS_SOURCES.fleetHealth, asOf: fleet.asOfMs },
          {
            source: SPAWNS_SOURCES.dispatchRoles,
            asOf: dispatchRoles.asOfMs,
          },
        ]}
      />
    </div>
  );
}
