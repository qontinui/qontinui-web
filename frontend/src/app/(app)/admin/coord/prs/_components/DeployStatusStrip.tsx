"use client";

/**
 * DeployStatusStrip — always-visible "is prod current?" strip atop /admin/coord/prs.
 *
 * Renders one compact chip per deploy surface (ecs / vercel / npm) with its
 * surface-level drift state, short deployed sha, and lag — glanceable context
 * above the PRs tabs.
 *
 * Data: `GET /api/v1/digital-twin/subspace/release/raw` (web backend proxy of
 * coord `GET /coord/twin/release/verdict`). We read each surface's state from
 * `verdict.surfaces[i].components` — the per-surface block, NOT the top-level
 * envelope drift_class.
 *
 * Fetch pattern intentionally mirrors the page (`page.tsx`): `httpClient.get`
 * from the service-factory inside a `useEffect`, with a light ~60s refetch and
 * cleanup. It does NOT use @tanstack/react-query, so the strip has no
 * QueryClientProvider dependency.
 *
 * Degrade gracefully: any fetch error / coord-down / empty surfaces → a small
 * muted one-liner. Loading → a thin skeleton. Never throws, never blocks the page.
 */

import { useEffect, useRef, useState } from "react";
import { Rocket } from "lucide-react";
import { httpClient } from "@/services/service-factory";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  ReleaseSurfaceComponents,
  ReleaseVerdictResponse,
} from "./release-verdict";

const RELEASE_RAW_URL = "/api/v1/digital-twin/subspace/release/raw";

// Light refetch cadence — this is glanceable context, not the primary table.
const REFRESH_MS = 60_000;

type BadgeTone =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

/**
 * Surface-level drift_class → badge tone + label. Keyed on
 * `components.drift_class`. Calm "current" reads green; deploying is amber;
 * the genuinely-stuck states (stale / failed / rolled back) are LOUD red;
 * unknown is muted grey. Mirrors the PrsTable deploy badge's tone language.
 */
type DriftMeta = { tone: BadgeTone; label: string };

const UNKNOWN_META: DriftMeta = { tone: "secondary", label: "unknown" };

const DRIFT_META: Record<string, DriftMeta> = {
  in_sync: { tone: "success", label: "current" },
  in_flight: { tone: "warning", label: "deploying" },
  pending: { tone: "warning", label: "deploying" },
  stale: { tone: "destructive", label: "stale" },
  failed_deploy: { tone: "destructive", label: "stale" },
  rolled_back: { tone: "destructive", label: "rolled back" },
  unknown: UNKNOWN_META,
};

function driftMeta(driftClass: string | null | undefined): DriftMeta {
  if (!driftClass) return UNKNOWN_META;
  return DRIFT_META[driftClass] ?? UNKNOWN_META;
}

/**
 * Short sha for display:
 *  - `sha256:<hex>` → first 7 of the hex
 *  - plain 40/64-char hex → first 7
 *  - a version string like `0.19.0` → as-is
 *  - null/empty → "—"
 */
function shortSha(sha: string | null | undefined): string {
  if (!sha) return "—";
  const colon = sha.indexOf(":");
  if (colon !== -1) {
    return sha.slice(colon + 1, colon + 8) || "—";
  }
  // Heuristic: a long hex string is a git/oci digest → truncate; otherwise
  // (e.g. a semver) show verbatim.
  if (/^[0-9a-f]{16,}$/i.test(sha)) {
    return sha.slice(0, 7);
  }
  return sha;
}

/** Strip the `qontinui-staging/` / org prefix from a target for brevity. */
function shortTarget(target: string | null | undefined): string {
  if (!target) return "";
  const slash = target.lastIndexOf("/");
  return slash !== -1 ? target.slice(slash + 1) : target;
}

/** `lag_seconds` → "Nm behind" / "Nh Nm behind". null → "". */
function lagLabel(lagSeconds: number | null | undefined): string {
  if (typeof lagSeconds !== "number" || !Number.isFinite(lagSeconds) || lagSeconds <= 0) {
    return "";
  }
  const total = Math.floor(lagSeconds);
  const mins = Math.floor(total / 60);
  if (mins < 60) return `${mins}m behind`;
  const hrs = Math.floor(mins / 60);
  const remM = mins % 60;
  return remM ? `${hrs}h ${remM}m behind` : `${hrs}h behind`;
}

function SurfaceChip({ c }: { c: ReleaseSurfaceComponents }) {
  const meta = driftMeta(c.drift_class);
  const surface = (c.surface ?? "?").toString();
  const target = shortTarget(c.target);
  const sha = shortSha(c.deployed_sha);
  const lag = lagLabel(c.lag_seconds);

  const title = [
    `surface: ${surface}`,
    c.target ? `target: ${c.target}` : null,
    `drift: ${c.drift_class ?? "unknown"}`,
    c.deployed_sha ? `deployed: ${c.deployed_sha}` : null,
    c.declared_sha ? `declared: ${c.declared_sha}` : null,
    typeof c.lag_seconds === "number" ? `lag: ${c.lag_seconds}s` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1"
      title={title}
      data-testid={`deploy-surface-${surface}`}
    >
      <span className="text-xs font-medium uppercase text-foreground">
        {surface}
      </span>
      {target && (
        <span className="text-[11px] text-muted-foreground max-w-[8rem] truncate">
          {target}
        </span>
      )}
      <Badge variant={meta.tone}>{meta.label}</Badge>
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {sha}
      </span>
      {lag && (
        <span className="text-[11px] text-amber-700 dark:text-amber-400 tabular-nums">
          {lag}
        </span>
      )}
    </div>
  );
}

export function DeployStatusStrip() {
  const [surfaces, setSurfaces] = useState<ReleaseSurfaceComponents[] | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const resp = await httpClient.get<ReleaseVerdictResponse>(
          RELEASE_RAW_URL,
        );
        if (cancelled) return;
        const list = (resp?.verdict?.surfaces ?? [])
          .map((s) => s?.components)
          .filter(
            (c): c is ReleaseSurfaceComponents =>
              c != null && typeof c === "object",
          );
        setSurfaces(list);
        setFailed(false);
      } catch {
        if (cancelled) return;
        setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
        inFlight.current = false;
      }
    };

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Loading (first paint) → a thin skeleton.
  if (loading && surfaces === null && !failed) {
    return (
      <div data-testid="deploy-strip-loading">
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  // Error / coord-down / empty → small muted one-liner. Never block the page.
  if (failed || !surfaces || surfaces.length === 0) {
    return (
      <div
        className="text-xs text-muted-foreground italic"
        data-testid="deploy-strip-unavailable"
      >
        deploy status unavailable
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="deploy-status-strip"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Rocket className="h-3.5 w-3.5" />
        Deploy status
      </div>
      {surfaces.map((c, i) => (
        <SurfaceChip key={`${c.surface ?? "s"}-${c.target ?? i}`} c={c} />
      ))}
    </div>
  );
}
