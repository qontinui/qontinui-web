"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RunnerMonitor, SessionHistory } from "@/components/runner";
import { Activity, History } from "lucide-react";

export default function RunnerPage() {
  const [activeTab, setActiveTab] = useState("monitor");

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Monitor</h1>
      </header>

      <div className="flex-1 min-h-0 px-6 py-4">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="h-full flex flex-col"
        >
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="monitor" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Live Monitor
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Session History
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 mt-4">
            <TabsContent value="monitor" className="h-full mt-0">
              <RunnerMonitor />
            </TabsContent>

            <TabsContent value="history" className="h-full mt-0">
              <SessionHistory />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
