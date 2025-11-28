"use client";

import { useState } from "react";
import { useExtractionStore } from "@/stores/extraction-store";
import { ExtractionConfigPanel } from "./ExtractionConfigPanel";
import { ExtractionProgress } from "./ExtractionProgress";
import { LivePreview } from "./LivePreview";
import { StateList } from "./StateList";
import { ExportPanel } from "./ExportPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function WebExtractionPage() {
  const status = useExtractionStore((state) => state.status);
  const stats = useExtractionStore((state) => state.stats);
  const [activeTab, setActiveTab] = useState("config");

  // Switch to preview tab when extraction starts
  const handleExtractionStart = () => {
    setActiveTab("preview");
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Web Extraction</h1>
          <p className="text-muted-foreground">
            Extract GUI elements and states from web applications
          </p>
        </div>
        {status === "running" && (
          <ExtractionProgress
            pagesVisited={stats.pagesVisited}
            statesFound={stats.statesFound}
            elementsFound={stats.elementsFound}
          />
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="preview" disabled={status === "idle"}>
            Live Preview
          </TabsTrigger>
          <TabsTrigger value="states" disabled={stats.statesFound === 0}>
            States ({stats.statesFound})
          </TabsTrigger>
          <TabsTrigger value="export" disabled={status !== "complete"}>
            Export
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-6">
          <ExtractionConfigPanel onStart={handleExtractionStart} />
        </TabsContent>

        <TabsContent value="preview" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Live Preview</CardTitle>
                  <CardDescription>
                    View detected elements and states in real-time
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <LivePreview />
                </CardContent>
              </Card>
            </div>
            <div>
              <StateList />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="states" className="mt-6">
          <StateList expanded />
        </TabsContent>

        <TabsContent value="export" className="mt-6">
          <ExportPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
