"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Hourglass } from "lucide-react";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API } from "./utils";
import { CollapsiblePanel } from "./CollapsiblePanel";
import {
  DEMO_FEATURES,
  type DemoFeature,
  type ProposalDetail,
  type QueueResponse,
} from "./mergeTypes";

const POLL_INTERVAL_MS = 2_500;
const HIGHLIGHT_MS = 6_000;

// ----------------------------------------------------------------------------
// Per-feature card
// ----------------------------------------------------------------------------

function FeatureCard({
  feature,
  landedAt,
}: {
  feature: DemoFeature;
  landedAt: number | null;
}) {
  const justLanded = landedAt !== null && Date.now() - landedAt < HIGHLIGHT_MS;

  return (
    <div
      className={`flex flex-col border rounded-md overflow-hidden transition-all duration-500 ${
        justLanded
          ? "ring-2 ring-green-400 shadow-[0_0_24px_rgba(74,222,128,0.35)]"
          : ""
      }`}
      data-feature={feature.slug}
      data-landed={landedAt !== null ? "true" : "false"}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
        <p className="text-xs font-medium">{feature.title}</p>
        {landedAt !== null ? (
          <span className="flex items-center gap-1 text-[10px] text-green-300 uppercase tracking-wide">
            <Sparkles className="h-3 w-3" />
            Live
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wide">
            <Hourglass className="h-3 w-3" />
            Waiting
          </span>
        )}
      </div>
      <div className="flex-1 bg-background">
        {landedAt !== null ? (
          <iframe
            src={feature.url}
            title={`Demo feature: ${feature.title}`}
            className="w-full h-64 border-0"
            sandbox="allow-same-origin allow-scripts allow-forms"
            loading="lazy"
          />
        ) : (
          <div className="h-64 flex items-center justify-center">
            <p className="text-xs text-muted-foreground">Pending merge…</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Panel
// ----------------------------------------------------------------------------

export function LandedFeaturesPanel() {
  // `landedAt[slug]` is the wall-clock timestamp at which we first observed
  // a proposal for that feature's branch reach `status === "merged"`.
  // null = not yet landed.
  const [landedAt, setLandedAt] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(DEMO_FEATURES.map((f) => [f.slug, null]))
  );
  const [loading, setLoading] = useState(true);
  const cleanedUpRef = useRef(false);

  const branchToSlug = useRef(
    new Map(DEMO_FEATURES.map((f) => [f.branch, f.slug]))
  );

  const tick = useCallback(async () => {
    try {
      const res = await httpClient.fetch(`${OPERATIONS_API}/merge/queue`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as QueueResponse | ProposalDetail[];
      const list = Array.isArray(body) ? body : (body.proposals ?? []);

      if (cleanedUpRef.current) return;

      setLandedAt((prev) => {
        const next = { ...prev };
        for (const p of list) {
          if (p.status !== "merged") continue;
          for (const r of p.repos) {
            const slug = branchToSlug.current.get(r.branch);
            if (slug && next[slug] === null) {
              next[slug] = Date.now();
            }
          }
        }
        return next;
      });
    } catch {
      // Polling is best-effort; the next tick retries.
    } finally {
      if (!cleanedUpRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cleanedUpRef.current = false;
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cleanedUpRef.current = true;
      clearInterval(id);
    };
  }, [tick]);

  // Re-render every second while any feature is in its "just landed"
  // highlight window so the ring fades naturally without a setTimeout
  // per card.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const anyJustLanded = Object.values(landedAt).some(
      (t) => t !== null && Date.now() - t < HIGHLIGHT_MS
    );
    if (!anyJustLanded) return;
    const id = setInterval(() => forceTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [landedAt]);

  return (
    <CollapsiblePanel
      storageKey="fleet:landed-features"
      icon={<Sparkles className="h-4 w-4" />}
      title="Live features"
    >
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {DEMO_FEATURES.map((f) => (
            <FeatureCard
              key={f.slug}
              feature={f}
              landedAt={landedAt[f.slug] ?? null}
            />
          ))}
        </div>
      )}
    </CollapsiblePanel>
  );
}
