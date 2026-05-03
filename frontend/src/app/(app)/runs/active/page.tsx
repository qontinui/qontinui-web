"use client";

import { RunnerEventProvider } from "@/contexts/RunnerEventContext";
import { ActiveRunsContent } from "./_components";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import { useDiscoveredSpec } from "@/lib/ui-bridge/use-discovered-specs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";

export default function ActiveRunsPage() {
  const discoveredSpec = useDiscoveredSpec("active-runs");
  usePageSpecs(
    discoveredSpec
      ? { "active-runs": discoveredSpec.config as SpecConfig }
      : {}
  );

  return (
    <RunnerEventProvider>
      <ActiveRunsContent />
    </RunnerEventProvider>
  );
}
