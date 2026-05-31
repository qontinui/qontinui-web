"use client";

/**
 * /admin/coord/trees — primary-tree state from Phase 1.
 *
 * Two tabs:
 *   - "By device" — list `coord.primary_trees` rows per device.
 *     Pass ?device_id=... to seed the selection from a cross-link.
 *   - "Contention" — cross-machine overlap view from coord.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Boxes, RefreshCw, AlertTriangle } from "lucide-react";
import {
  TreeCard,
  type PrimaryTreeRow,
} from "@/components/admin/coord/TreeCard";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 10_000;

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

function TreesByDevicePanel({ initialDeviceId }: { initialDeviceId: string }) {
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

  return (
    <Card data-testid="coord-trees-by-device">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Boxes className="h-4 w-4" />
          Primary trees by device
          <Badge variant="outline" className="ml-2">
            {trees.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
        ) : loading && !data ? (
          <Skeleton className="h-24 w-full" />
        ) : trees.length > 0 ? (
          <div className="space-y-2">
            {trees.map((t, i) => (
              <TreeCard key={`${t.repo}-${i}`} tree={t} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No primary trees registered for device {deviceId}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ContentionPanel() {
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

  return (
    <Card data-testid="coord-trees-contention">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Tree contention (same-repo on multiple devices)
          <Badge variant="outline" className="ml-2">
            {overlaps.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && (
          <p className="text-sm text-destructive">Failed to load: {error}</p>
        )}
        {loading && !data ? (
          <Skeleton className="h-16 w-full" />
        ) : overlaps.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No contention detected.
          </p>
        ) : (
          <ul className="space-y-2">
            {overlaps.map((o, i) => (
              <li
                key={`${o.repo}-${i}`}
                data-testid="coord-tree-contention-row"
                className="text-sm"
              >
                <div className="font-mono">{o.repo}</div>
                <ul className="ml-4 text-xs text-muted-foreground font-mono space-y-0.5">
                  {(o.devices ?? []).map((d, j) => (
                    <li key={j}>
                      {d.hostname || d.device_id.slice(0, 8)}: {d.primary_path}
                    </li>
                  ))}
                  {/* Fallback for the older `primary_paths` shape */}
                  {!o.devices &&
                    (o.primary_paths ?? []).map((p, j) => <li key={j}>{p}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function CoordTreesPage() {
  const searchParams = useSearchParams();
  const initialDeviceId = searchParams?.get("device_id") ?? "";

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-trees-page">
      <Tabs defaultValue={initialDeviceId ? "by-device" : "by-device"}>
        <TabsList>
          <TabsTrigger value="by-device" data-testid="coord-trees-tab-by-device">
            By device
          </TabsTrigger>
          <TabsTrigger value="contention" data-testid="coord-trees-tab-contention">
            Contention
          </TabsTrigger>
        </TabsList>
        <TabsContent value="by-device" className="mt-4">
          <TreesByDevicePanel initialDeviceId={initialDeviceId} />
        </TabsContent>
        <TabsContent value="contention" className="mt-4">
          <ContentionPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
