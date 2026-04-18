"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequireProject } from "@/components/require-project";
import {
  RefreshCw,
  Terminal,
  Bug,
  ClipboardCheck,
  FileText,
} from "lucide-react";
import { useTaskDetail } from "./_hooks/useTaskDetail";
import { useExpandableSet } from "./_hooks/useExpandableSet";
import { TaskHeader } from "./_components/TaskHeader";
import { SessionsTab } from "./_components/SessionsTab";
import { FindingsTab } from "./_components/FindingsTab";
import { OutputTab } from "./_components/OutputTab";
import VerificationResultsTab from "./VerificationResultsTab";

export default function AITaskDetailPage() {
  const {
    user,
    authLoading,
    taskId,
    task,
    isLoading,
    error,
    refetch,
    handleFindingStatusChange,
  } = useTaskDetail();

  const [activeTab, setActiveTab] = useState("sessions");
  const sessions = useExpandableSet();
  const findings = useExpandableSet();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <RequireProject pageName="AI Task Details">
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold">AI Task Details</h1>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              <div className="flex items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" />
                Loading task details...
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-400">
              Error loading task: {(error as Error).message}
            </div>
          ) : !task ? (
            <div className="text-center py-12 text-muted-foreground">
              Task not found
            </div>
          ) : (
            <div className="space-y-0">
              <TaskHeader task={task} />

              <div className="px-6 py-4">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList>
                    <TabsTrigger value="sessions">
                      <Terminal className="w-4 h-4 mr-2" />
                      Sessions ({task.sessions?.length || 0})
                    </TabsTrigger>
                    <TabsTrigger value="findings">
                      <Bug className="w-4 h-4 mr-2" />
                      Findings ({task.findings?.length || 0})
                    </TabsTrigger>
                    <TabsTrigger value="verification">
                      <ClipboardCheck className="w-4 h-4 mr-2" />
                      Verification
                    </TabsTrigger>
                    {task.outputSummary && (
                      <TabsTrigger value="output">
                        <FileText className="w-4 h-4 mr-2" />
                        Output
                      </TabsTrigger>
                    )}
                  </TabsList>

                  <TabsContent value="sessions" className="mt-4">
                    <SessionsTab
                      sessions={task.sessions}
                      isExpanded={sessions.isExpanded}
                      onToggle={sessions.toggle}
                    />
                  </TabsContent>

                  <TabsContent value="findings" className="mt-4">
                    <FindingsTab
                      findings={task.findings}
                      isExpanded={findings.isExpanded}
                      onToggle={findings.toggle}
                      onStatusChange={handleFindingStatusChange}
                    />
                  </TabsContent>

                  <TabsContent value="verification" className="mt-4">
                    <VerificationResultsTab taskId={taskId} />
                  </TabsContent>

                  {task.outputSummary && (
                    <TabsContent value="output" className="mt-4">
                      <OutputTab outputSummary={task.outputSummary!} />
                    </TabsContent>
                  )}
                </Tabs>
              </div>
            </div>
          )}
        </div>
      </div>
    </RequireProject>
  );
}
