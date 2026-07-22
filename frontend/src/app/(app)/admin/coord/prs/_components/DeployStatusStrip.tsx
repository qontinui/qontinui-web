"use client";

/**
 * DeployStatusStrip — always-visible "is prod current?" strip atop /admin/coord/prs.
 *
 * Renders one compact chip per deploy surface (ecs / vercel / npm, plus the
 * runner GitHub-Releases surface shown as "Runner") with its surface-level
 * drift state, short deployed sha, and lag — glanceable context above the PRs
 * tabs.
 *
 * Data: `GET /api/v1/admin-dev/release-verdict` (the admin-dev proxy of coord
 * `GET /coord/twin/release/verdict`). That proxy degrades to a 200 empty
 * envelope on coord-down so the crawl gate / page never see a 5xx — contrast
 * the old digital-twin proxy (`/api/v1/digital-twin/subspace/release/raw`),
 * which 502s when coord is unreachable and so failed the Spec CI crawl gate.
 * We read each surface's state from `verdict.surfaces[i].components` — the
 * per-surface block, NOT the top-level envelope drift_class.
 *
 * Fetch pattern intentionally mirrors the page (`page.tsx`): `httpClient.get`
 * from the service-factory inside a `useEffect`, with a light ~60s refetch and
 * cleanup. It does NOT use @tanstack/react-query, so the strip has no
 * QueryClientProvider dependency.
 *
 * Coord-down resilience (mirrors the page, web#770): a degraded 200 carries
 * `coord_error` with EMPTY surfaces. Applying that envelope would collapse the
 * strip to "deploy status unavailable" on every transient blip — directly above
 * a PRs table that correctly retains its rows. So instead: when a fetch degrades
 * (a `coord_error` envelope OR a thrown fetch error — both mean "what's on
 * screen may be stale") and we hold last-good surfaces, RETAIN them, dimmed,
 * with a subtle "reconnecting" marker carrying the reason, and poll faster until
 * coord recovers. The muted one-liner is reserved for a cold start with nothing
 * to retain. Loading → a thin skeleton. Never throws, never blocks the page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Rocket } from "lucide-react";
import { httpClient } from "@/services/service-factory";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  normalizeDriftClass,
  surfaceLabel,
  type ReleaseSurfaceComponents,
  type ReleaseVerdictResponse,
} from "./release-verdict";

const RELEASE_RAW_URL = "/api/v1/admin-dev/release-verdict";

// Light refetch cadence — this is glanceable context, not the primary table.
const REFRESH_MS = 60_000;

// Faster cadence while degraded, so retained (stale) chips are corrected soon
// after coord recovers. Deliberately NOT the page's 5s: this strip is secondary
// glanceable context (see the doc comment above), so 15s recovers promptly
// without adding a 12x poll multiplier for a decoration.
const RECONNECT_REFRESH_MS = 15_000;

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
  // Normalize the runner surface's namespaced `release:*` sub-classes to the
  // shared canonical tokens the tone/label map is keyed on.
  const meta = driftMeta(normalizeDriftClass(c.drift_class));
  const rawSurface = (c.surface ?? "?").toString();
  const surface = surfaceLabel(rawSurface);
  const target = shortTarget(c.target);
  const sha = shortSha(c.deployed_sha);
  const lag = lagLabel(c.lag_seconds);

  const title = [
    `surface: ${rawSurface}`,
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
      // testid keyed on the RAW surface token (a stable selector); the visible
      // label uses the friendly `surfaceLabel` map.
      data-testid={`deploy-surface-${rawSurface}`}
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
  // Why the data on screen may be stale — the coord_error from a degraded 200,
  // or a thrown fetch error's message. Non-null drives the retention decision,
  // the reconnecting marker and the fast poll. Replaces the old `failed`
  // boolean, which conflated "coord is down" with "we have nothing to show".
  const [degraded, setDegraded] = useState<string | null>(null);
  const inFlight = useRef(false);

  // Synchronous mirror of the last APPLIED surfaces. `load` is memoized with no
  // deps, so reading the `surfaces` STATE inside it would always see the initial
  // `null` (a stale closure) and never retain. The `inFlight` guard means
  // fetches never overlap, so this ref always reads fresh.
  const surfacesRef = useRef<ReleaseSurfaceComponents[] | null>(null);

  // Unmount safety for the async setState calls (replaces the old per-effect
  // `cancelled` flag, which can't span the split load/poll effects).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;

    // Apply one fetch's outcome under the retention rule. `degradedReason` is
    // the coord_error (success path) or the thrown error's message (catch
    // path) — both mean the same thing to the strip.
    const applyResult = (
      list: ReleaseSurfaceComponents[],
      degradedReason: string | null,
    ) => {
      // Retain the last-good chips when this fetch degraded and we actually
      // have something to keep; otherwise apply the response as-is.
      const prev = surfacesRef.current;
      const retain =
        degradedReason !== null && prev !== null && prev.length > 0;
      if (!retain) {
        surfacesRef.current = list;
        setSurfaces(list);
      }
      // Always reflect the LATEST fetch, so the marker and poll cadence track
      // reality even while the chips themselves are retained.
      setDegraded(degradedReason);
    };

    try {
      const resp = await httpClient.get<ReleaseVerdictResponse>(
        RELEASE_RAW_URL,
      );
      if (!mounted.current) return;
      const list = (resp?.verdict?.surfaces ?? [])
        .map((s) => s?.components)
        .filter(
          (c): c is ReleaseSurfaceComponents =>
            c != null && typeof c === "object",
        );
      applyResult(list, resp?.coord_error ?? null);
    } catch (e) {
      if (!mounted.current) return;
      // A thrown fetch error degrades on exactly the same rule as a coord_error
      // envelope: retain the chips if we have any, otherwise fall through to
      // the cold-start one-liner.
      applyResult([], e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setLoading(false);
      inFlight.current = false;
    }
  }, []);

  // Initial fetch. `surfaces`/`surfacesRef` are deliberately never cleared —
  // retention across an outage depends on them surviving.
  useEffect(() => {
    load();
  }, [load]);

  // Poll. While degraded, poll faster so retained chips are corrected soon
  // after coord recovers; a healthy response clears `degraded` and this effect
  // re-runs at the normal cadence.
  useEffect(() => {
    const intervalMs =
      degraded !== null ? RECONNECT_REFRESH_MS : REFRESH_MS;
    const id = setInterval(() => {
      load();
    }, intervalMs);
    return () => clearInterval(id);
  }, [degraded, load]);

  // Loading (first paint) → a thin skeleton.
  if (loading && surfaces === null && degraded === null) {
    return (
      <div data-testid="deploy-strip-loading">
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  // COLD START ONLY — genuinely nothing to show (empty surfaces, and nothing
  // retained). A degraded fetch with last-good chips renders those chips + the
  // reconnecting marker below instead of collapsing to this. The reason, if
  // any, rides the tooltip rather than cluttering the strip.
  if (!surfaces || surfaces.length === 0) {
    return (
      <div
        className="text-xs text-muted-foreground italic"
        data-testid="deploy-strip-unavailable"
        title={degraded ?? undefined}
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
      {/* Reconnecting marker — coord is down and these chips are last-good.
          Deliberately NO relative "X ago" label: the strip has no 1s ticker
          (the page's `now` ticker is page-local), so a computed age would
          freeze between polls and lie. The marker + tooltip is the honest
          signal; each chip's own lag/sha carries the data. */}
      {degraded !== null && (
        <span
          className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-400"
          data-testid="deploy-strip-reconnecting"
          role="status"
          title={`coord is currently unavailable (${degraded}) — showing last known deploy status. Retries automatically.`}
        >
          <RefreshCw className="h-3 w-3 animate-spin" />
          reconnecting
        </span>
      )}
      {/* Dim the retained chips so staleness reads visually, not just textually. */}
      <div
        className={`flex flex-wrap items-center gap-2 ${degraded !== null ? "opacity-70" : ""}`}
      >
        {surfaces.map((c, i) => (
          <SurfaceChip key={`${c.surface ?? "s"}-${c.target ?? i}`} c={c} />
        ))}
      </div>
    </div>
  );
}
