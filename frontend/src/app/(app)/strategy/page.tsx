"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listStrategyDocs,
  type StrategyDocSummary,
} from "@/lib/api/strategy";
import { StrategySidebar } from "./_components/StrategySidebar";

/**
 * /strategy — Phase 1 read-only landing. Lists docs; redirects to the
 * first doc once loaded so the viewer is the default surface.
 */
export default function StrategyIndexPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<StrategyDocSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listStrategyDocs()
      .then((d) => {
        setDocs(d);
        const first = d[0];
        if (first) {
          router.replace(`/strategy/${encodeURIComponent(first.name)}`);
        }
      })
      .catch((e) => setError(e.message));
  }, [router]);

  if (error) {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load strategy: {error}
      </div>
    );
  }
  if (docs === null) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  return (
    <div className="flex h-full">
      <StrategySidebar docs={docs} />
      <div className="flex-1 p-6 text-sm text-muted-foreground">
        {docs.length === 0
          ? "No strategy documents."
          : "Select a document."}
      </div>
    </div>
  );
}
