"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download } from "lucide-react";
import { useTestRun } from "@/hooks/useTesting";
import { RequireProject } from "@/components/require-project";
import { ApiConfig } from "@/services/api-config";
import { useTestRunWebSocket } from "./_hooks/useTestRunWebSocket";
import { RunSummaryCard } from "./_components/RunSummaryCard";
import { TimelineTab } from "./_components/TimelineTab";
import { CoverageTab } from "./_components/CoverageTab";
import { DeficienciesTab } from "./_components/DeficienciesTab";
import { ScreenshotDialog } from "./_components/ScreenshotDialog";

export default function TestRunDetailPage() {
  const params = useParams();
  const runId = params.runId as string;

  const { data: run, isLoading, refetch } = useTestRun(runId);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const liveStatus = useTestRunWebSocket(runId, run?.status, refetch);

  const handleExport = () => {
    if (!run) return;
    const url = `${ApiConfig.getBaseUrl()}/api/v1/testing/runs/${runId}/export?format=json`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!run) {
    return (
      <RequireProject pageName="Test Run Details">
        <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
          <div className="text-red-400">Test run not found</div>
        </div>
      </RequireProject>
    );
  }

  const displayStatus = liveStatus || run.status;

  return (
    <RequireProject pageName="Test Run Details">
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold text-foreground">
            Test Run Details
          </h1>
          <Button onClick={handleExport} variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            <RunSummaryCard run={run} displayStatus={displayStatus} />

            <Tabs defaultValue="timeline" className="w-full">
              <TabsList>
                <TabsTrigger value="timeline">Step Timeline</TabsTrigger>
                <TabsTrigger value="coverage">Coverage</TabsTrigger>
                <TabsTrigger value="deficiencies">
                  Deficiencies ({run.deficiencies_found})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="timeline">
                <TimelineTab
                  transitions={run.transitions}
                  onImageSelect={setSelectedImage}
                />
              </TabsContent>

              <TabsContent value="coverage">
                <CoverageTab stateCoverage={run.state_coverage} />
              </TabsContent>

              <TabsContent value="deficiencies">
                <DeficienciesTab
                  deficiencies={run.deficiencies}
                  onImageSelect={setSelectedImage}
                />
              </TabsContent>
            </Tabs>
          </div>
        </main>

        <ScreenshotDialog
          selectedImage={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      </div>
    </RequireProject>
  );
}
