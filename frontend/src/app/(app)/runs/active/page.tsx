"use client";

import { RunnerEventProvider } from "@/contexts/RunnerEventContext";
import { ActiveRunsContent } from "./_components";

export default function ActiveRunsPage() {
  return (
    <RunnerEventProvider>
      <ActiveRunsContent />
    </RunnerEventProvider>
  );
}
