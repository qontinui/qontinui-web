"use client";

import { useState } from "react";
import { useRunningTaskRuns } from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Database, Brain, ShieldCheck, Wrench } from "lucide-react";
import {
  KnowledgeTab,
  VerificationTab,
  McpCallsTab,
  RunListPanel,
} from "./_components";

export default function AiDataPage() {
  const { data: runs, isLoading, isOffline } = useRunningTaskRuns();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const effectiveRunId =
    selectedRunId ?? (runs && runs.length > 0 ? String(runs[0]!.id) : null);

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">AI Data View</h1>
      </header>

      {isOffline && (
        <RunnerPartialState message="Runner offline — live data unavailable" />
      )}

      <div className="flex flex-1 min-h-0">
        <RunListPanel
          runs={runs}
          isLoading={isLoading}
          effectiveRunId={effectiveRunId}
          onSelectRun={setSelectedRunId}
        />

        <div className="flex-1 min-w-0">
          {effectiveRunId == null ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <Database className="size-12 mx-auto mb-4 opacity-30" />
                <p className="text-sm">
                  Select a run from the left panel to view its AI data.
                </p>
              </div>
            </div>
          ) : (
            <Tabs defaultValue="knowledge" className="h-full flex flex-col">
              <div className="border-b border-border px-6">
                <TabsList className="bg-transparent h-12">
                  <TabsTrigger
                    value="knowledge"
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5"
                  >
                    <Brain className="size-4" />
                    Knowledge
                  </TabsTrigger>
                  <TabsTrigger
                    value="verification"
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5"
                  >
                    <ShieldCheck className="size-4" />
                    Verification
                  </TabsTrigger>
                  <TabsTrigger
                    value="mcp-calls"
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5"
                  >
                    <Wrench className="size-4" />
                    MCP Calls
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="flex-1 overflow-auto">
                <TabsContent value="knowledge" className="mt-0 p-6">
                  <KnowledgeTab runId={effectiveRunId} />
                </TabsContent>

                <TabsContent value="verification" className="mt-0 p-6">
                  <VerificationTab runId={effectiveRunId} />
                </TabsContent>

                <TabsContent value="mcp-calls" className="mt-0 p-6">
                  <McpCallsTab runId={effectiveRunId} />
                </TabsContent>
              </div>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
