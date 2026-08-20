"use client";

/**
 * /admin/coord/trees — primary-tree state from Phase 1.
 *
 * Two views:
 *   - "By device" — list `coord.primary_trees` rows per device.
 *     Pass ?device_id=... to seed the selection from a cross-link.
 *   - "Contention" — cross-machine overlap view from coord.
 *
 * ## Console style (Phase 3 Wave 1)
 *
 * Migrated onto `components/console` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`, against
 * `frontend/docs/console-ui-style-guide.md`. This route was the wave's canary
 * for two reasons and both bit:
 *
 * - **R2/R5 — it had no detail at all.** `TreeCard` held zero `useState` and
 *   zero `onClick`; every field it knew was printed on the card, which is why
 *   the card was three lines tall. `<TreeRow>` keeps the scannable signals on
 *   the line and gives the rest a `<RecordDetail>` that did not previously
 *   exist.
 * - **R6 — the two views are now `<FilterTabs>` with live counts, and the
 *   contention count reads `–` until that view has been opened.** It is not
 *   `0`: the contention list is fetched only while its own view is mounted
 *   (that is what keeps its 10s poll off every visitor), so before the first
 *   visit the honest answer is "not asked", not "none". Opening the view fills
 *   the count in and it survives switching away, because a last-known count is
 *   still a measurement.
 *
 * **D5 — nothing about the fetching changed.** Same two endpoints, same 10s
 * cadence, same "contention polls only while open" scoping. The count is
 * hoisted by callback, not by a new request.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import {
  FilterTabs,
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
} from "@/components/console";
import { TreeRow } from "@/components/admin/coord/TreeRow";
import {
  deriveTreesHealth,
  type PrimaryTreeRow,
} from "@/components/admin/coord/treeStatus";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 10_000;

type TreesView = "by-device" | "contention";

interface ContentionRow {
  repo: string;
  primary_paths?: string[];
  devices?: { device_id: string; hostname?: string; primary_path: string }[];
}

interface TreesByDeviceResponse {
  device_id?: string;
  trees?: PrimaryTreeRow[];
}

interface ContentionResponse {
  overlaps?: ContentionRow[];
}

function TreesByDevicePanel({
  initialDeviceId,
  onCount,
}: {
  initialDeviceId: string;
  onCount: (n: number | null) => void;
}) {
  const [deviceId, setDeviceId] = useState(initialDeviceId);
  const [data, setData] = useState<TreesByDeviceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!deviceId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const body = await httpClient.get<TreesByDeviceResponse>(
        `${API}/trees/by-device/${encodeURIComponent(deviceId)}`
      );
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    fetchData();
    if (!deviceId) return;
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData, deviceId]);

  const trees = data?.trees ?? [];
  const loaded = data !== null;

  // Report the count up for the tab badge. `null` while no device is selected
  // or nothing has come back — R6's dash, not a zero.
  useEffect(() => {
    onCount(loaded ? trees.length : null);
  }, [onCount, loaded, trees.length]);

  const health = deriveTreesHealth(trees);

  return (
    <div className="space-y-3" data-testid="coord-trees-by-device">
      <HealthStrip
        level={loaded ? health.level : "amber"}
        headline={
          !deviceId
            ? "No device selected"
            : loaded
              ? health.headline
              : "Waiting for coord…"
        }
        detail={
          !deviceId
            ? "enter a device_id, or click into a device from the Fleet page"
            : loaded
              ? health.detail
              : "counts appear once the tree list arrives"
        }
        badges={[
          {
            key: "trees",
            label: <>trees {loaded ? trees.length : "–"}</>,
            tone: "muted",
          },
          {
            key: "dirty",
            label: <>dirty {loaded ? health.dirty : "–"}</>,
            tone: loaded && health.dirty > 0 ? "default" : "muted",
          },
          {
            key: "stale",
            label: <>stale {loaded ? health.stale : "–"}</>,
            tone: loaded && health.stale > 0 ? "attention" : "muted",
            title: "dirty trees whose WIP has not been touched for 24h or more",
          },
          {
            key: "held",
            label: <>held {loaded ? health.held : "–"}</>,
            tone: loaded && health.held > 0 ? "attention" : "muted",
            title: "coord will not pull these without a human: hold or diverged",
          },
        ]}
        data-testid="coord-trees-health"
      />

      <div className="flex items-center gap-2">
        <Input
          placeholder="device_id (UUID)"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value.trim())}
          className="max-w-md font-mono text-xs"
          data-testid="coord-trees-device-input"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          data-testid="coord-trees-refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      {!deviceId ? (
        <p className="text-sm text-muted-foreground italic">
          Enter a device_id to list its primary trees, or click into a device
          from the Fleet page.
        </p>
      ) : (
        <RecordList
          items={trees}
          itemKey={(t) => `${t.repo}:${t.primary_path}`}
          loaded={!(loading && !data)}
          skeletonRows={4}
          empty={
            <p className="text-sm text-muted-foreground italic">
              No primary trees registered for device {deviceId}.
            </p>
          }
          renderRow={(t, ctx) => (
            <TreeRow tree={t} expanded={ctx.expanded} onToggle={ctx.onToggle} />
          )}
        />
      )}
    </div>
  );
}

function ContentionPanel({ onCount }: { onCount: (n: number | null) => void }) {
  const [data, setData] = useState<ContentionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const body = await httpClient.get<ContentionResponse>(
        `${API}/trees/contention`
      );
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const overlaps = data?.overlaps ?? [];
  const loaded = data !== null;

  useEffect(() => {
    if (loaded) onCount(overlaps.length);
  }, [onCount, loaded, overlaps.length]);

  return (
    <div className="space-y-3" data-testid="coord-trees-contention">
      <HealthStrip
        level={!loaded ? "amber" : overlaps.length > 0 ? "amber" : "green"}
        headline={
          !loaded
            ? "Waiting for coord…"
            : overlaps.length === 0
              ? "No contention detected"
              : `${overlaps.length} repo${
                  overlaps.length === 1 ? "" : "s"
                } checked out on more than one device`
        }
        detail={
          overlaps.length > 0
            ? "the same repo on two machines is not an error — it is a coordination cost"
            : undefined
        }
        badges={[
          {
            key: "overlaps",
            label: <>overlaps {loaded ? overlaps.length : "–"}</>,
            tone: loaded && overlaps.length > 0 ? "default" : "muted",
          },
        ]}
      />

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      <RecordList
        items={overlaps}
        itemKey={(o) => o.repo}
        loaded={!(loading && !data)}
        skeletonRows={2}
        empty={
          <p className="text-sm text-muted-foreground italic">
            No contention detected.
          </p>
        }
        renderRow={(o, ctx) => {
          const devices = o.devices ?? [];
          const paths = o.primary_paths ?? [];
          const n = devices.length || paths.length;
          return (
            <RecordRow
              data-testid="coord-tree-contention-row"
              rowKey={o.repo}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
              identity={o.repo}
              label={
                <span className="text-xs text-muted-foreground">
                  {n} checkout{n === 1 ? "" : "s"}
                </span>
              }
              reason={devices
                .map((d) => d.hostname || d.device_id.slice(0, 8))
                .join(", ")}
            >
              <RecordDetail
                why={
                  <p className="text-xs text-muted-foreground">
                    coord sees this repo as a primary tree on {n} device
                    {n === 1 ? "" : "s"}. Pull decisions are made per device, so
                    the two can diverge without either being wrong.
                  </p>
                }
                problems={
                  <ul className="space-y-0.5 text-xs">
                    {devices.map((d) => (
                      <li key={d.device_id} className="flex gap-2">
                        <span className="text-muted-foreground shrink-0">
                          {d.hostname || d.device_id.slice(0, 8)}
                        </span>
                        <span className="font-mono break-all">
                          {d.primary_path}
                        </span>
                      </li>
                    ))}
                    {/* Fallback for the older `primary_paths` shape */}
                    {devices.length === 0 &&
                      paths.map((p) => (
                        <li key={p} className="font-mono break-all">
                          {p}
                        </li>
                      ))}
                  </ul>
                }
                raw={
                  <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
                    {devices.map((d) => d.device_id).join(" · ")}
                  </div>
                }
              />
            </RecordRow>
          );
        }}
      />
    </div>
  );
}

export default function CoordTreesPage() {
  const searchParams = useSearchParams();
  const initialDeviceId = searchParams?.get("device_id") ?? "";
  const [view, setView] = useState<TreesView>("by-device");
  // `null` = NOT FETCHED, which `<FilterTabs>` renders as `–`. The contention
  // list is only fetched while its own view is mounted, so before the first
  // visit "0 overlaps" would be a claim nobody made.
  const [treeCount, setTreeCount] = useState<number | null>(null);
  const [overlapCount, setOverlapCount] = useState<number | null>(null);

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-trees-page">
      <FilterTabs<TreesView>
        tabs={[
          { id: "by-device", label: "By device", count: treeCount },
          { id: "contention", label: "Contention", count: overlapCount },
        ]}
        active={view}
        onChange={setView}
        testIdPrefix="coord-trees-tab"
      />

      {view === "by-device" ? (
        <TreesByDevicePanel
          initialDeviceId={initialDeviceId}
          onCount={setTreeCount}
        />
      ) : (
        <ContentionPanel onCount={setOverlapCount} />
      )}
    </div>
  );
}
