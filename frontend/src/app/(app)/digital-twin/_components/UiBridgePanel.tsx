"use client";

import { useMemo, useState } from "react";
import {
  Camera,
  Database,
  Loader2,
  Network,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import {
  useRunnerSnapshot,
  useRunnerSpecGraph,
  useRunnerSpecList,
} from "../_hooks/useUiBridge";

const DEFAULT_APP_ID = "qontinui-web";

// The runner exposes no /apps/list, so the app id is typed. These are the
// common ids surfaced as suggestions (datalist) — not a hard allowlist, so a
// custom id still works for runners that manage other apps.
const KNOWN_APP_IDS = ["qontinui-web", "runner", "qontinui-mobile"];

function countStates(config?: { stateMachine?: { states?: unknown[] } }): number {
  return config?.stateMachine?.states?.length ?? 0;
}

/**
 * UI Bridge tab — the twin's UI half, split into its two natures:
 *  - CACHED / processed: the runner's spec pages + state-machine graph, read
 *    from on-disk IR (no running app needed).
 *  - AUTOMATION-required: a live snapshot, captured on demand from the running
 *    app (needs the app connected to the runner).
 */
export function UiBridgePanel() {
  const { runners } = useRealtimeConnections();
  const deviceId = runners[0]?.id ?? null;
  const [appId, setAppId] = useState(DEFAULT_APP_ID);
  const [snapshotRequested, setSnapshotRequested] = useState(false);

  const specList = useRunnerSpecList(deviceId, appId);
  const specGraph = useRunnerSpecGraph(deviceId, appId);
  const snapshot = useRunnerSnapshot(deviceId, snapshotRequested);

  // useMemo so the array reference is stable across renders (the `?? []`
  // otherwise makes a new array every render → react-hooks/exhaustive-deps on
  // the totalStates memo below).
  const specs = useMemo(() => specList.data?.specs ?? [], [specList.data]);
  const graphPages = specGraph.data?.pages ?? [];
  const snap = snapshot.data;

  const totalStates = useMemo(
    () => specs.reduce((acc, s) => acc + countStates(s.config), 0),
    [specs],
  );

  if (!deviceId) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <WifiOff className="size-4" /> Connect a runner to inspect its UI
          Bridge spec pages and capture live snapshots.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground" htmlFor="dt-app-id">
          App
        </label>
        <input
          id="dt-app-id"
          value={appId}
          list="dt-app-id-options"
          onChange={(e) => setAppId(e.target.value.trim())}
          className="h-7 w-48 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <datalist id="dt-app-id-options">
          {KNOWN_APP_IDS.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => {
            specList.refetch();
            specGraph.refetch();
          }}
        >
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* CACHED / processed side */}
        <section className="rounded-lg border border-l-4 border-l-emerald-500 bg-card p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Database className="size-4" /> Processed (cached)
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Spec pages + state-machine graph read from the runner&apos;s on-disk
            IR — no running app required.
          </p>

          {specList.isLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading specs…
            </p>
          )}
          {specList.isError && (
            <p className="text-sm text-muted-foreground">
              Could not read specs for <code>{appId}</code> from the runner.
            </p>
          )}
          {!specList.isLoading && !specList.isError && (
            <>
              <div className="mb-3 flex gap-6 text-sm">
                <span>
                  <span className="text-lg font-semibold">{specs.length}</span>{" "}
                  <span className="text-muted-foreground">pages</span>
                </span>
                <span>
                  <span className="text-lg font-semibold">{totalStates}</span>{" "}
                  <span className="text-muted-foreground">states</span>
                </span>
                <span>
                  <span className="text-lg font-semibold">
                    {graphPages.length}
                  </span>{" "}
                  <span className="text-muted-foreground">graph nodes</span>
                </span>
              </div>
              <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                {specs.map((s) => (
                  <li
                    key={s.specId}
                    className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1"
                  >
                    <code className="truncate text-xs">{s.specId}</code>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {countStates(s.config)} states
                    </span>
                  </li>
                ))}
                {specs.length === 0 && (
                  <li className="text-xs text-muted-foreground">
                    No spec pages found for this app.
                  </li>
                )}
              </ul>
            </>
          )}
        </section>

        {/* AUTOMATION-required side */}
        <section className="rounded-lg border border-l-4 border-l-indigo-500 bg-card p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Camera className="size-4" /> Live (automation)
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            A live snapshot captured from the running app on demand — requires
            the app connected to the runner.
          </p>

          <Button
            size="sm"
            className="mb-3 gap-1.5"
            disabled={snapshot.isFetching}
            onClick={() => {
              setSnapshotRequested(true);
              if (snapshotRequested) snapshot.refetch();
            }}
          >
            {snapshot.isFetching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Network className="size-4" />
            )}
            Capture snapshot
          </Button>

          {snapshot.isError && snapshotRequested && (
            <p className="text-sm text-muted-foreground">
              Could not capture a snapshot — the app may not be connected to the
              runner.
            </p>
          )}
          {snap && (
            <>
              <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>
                  <span className="text-lg font-semibold">
                    {snap.elements?.length ?? 0}
                  </span>{" "}
                  <span className="text-muted-foreground">elements</span>
                </span>
                <span>
                  <span className="text-lg font-semibold">
                    {snap.states?.length ?? 0}
                  </span>{" "}
                  <span className="text-muted-foreground">states</span>
                </span>
                <span>
                  <span className="text-lg font-semibold">
                    {snap.activeStates?.length ?? 0}
                  </span>{" "}
                  <span className="text-muted-foreground">active</span>
                </span>
              </div>
              <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-[11px] leading-relaxed">
                {JSON.stringify(snap, null, 2)}
              </pre>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
