"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { useExportTestRun, useTestRun } from "@/hooks/useTesting";
import { RequireProject } from "@/components/require-project";
import { RunSummaryCard } from "./_components/RunSummaryCard";
import { TimelineTab } from "./_components/TimelineTab";
import { CoverageTab } from "./_components/CoverageTab";
import { DeficienciesTab } from "./_components/DeficienciesTab";
import { ScreenshotDialog } from "./_components/ScreenshotDialog";

export default function TestRunDetailPage() {
  const params = useParams();
  const runId = params.runId as string;

  const { data: run, isLoading } = useTestRun(runId);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const exportTestRun = useExportTestRun();

  const handleExport = async () => {
    if (!run) return;
    try {
      await exportTestRun.mutateAsync({ id: runId, format: "json" });
    } catch (error) {
      toast.error(
        `Export failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
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

  return (
    <RequireProject pageName="Test Run Details">
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold text-foreground">
            Test Run Details
          </h1>
          <Button
            onClick={handleExport}
            variant="outline"
            size="sm"
            disabled={exportTestRun.isPending}
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            <RunSummaryCard run={run} displayStatus={run.status} />

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
