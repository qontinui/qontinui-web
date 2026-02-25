"use client";

import { RunnerEventProvider } from "@/contexts/RunnerEventContext";
import { ActiveRunsContent } from "./_components";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import pageSpecJson from "./active-runs.spec.uibridge.json";

const pageSpec = pageSpecJson as unknown as SpecConfig;

export default function ActiveRunsPage() {
  usePageSpecs({ "active-runs": pageSpec });

  return (
    <RunnerEventProvider>
      <ActiveRunsContent />
    </RunnerEventProvider>
  );
}
