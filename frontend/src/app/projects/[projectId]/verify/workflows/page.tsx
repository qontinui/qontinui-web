"use client";

/**
 * Verify Workflows Page
 *
 * Displays a list of workflows for verification.
 * Allows users to select a workflow to visualize its state transitions step-by-step.
 */

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAutomation } from "@/contexts/automation-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Play,
  Search,
  FileText,
  ArrowRight,
  FolderOpen,
} from "lucide-react";
import type { Workflow } from "@/lib/action-schema/action-types";

function WorkflowsList() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const { workflows } = useAutomation();
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredWorkflows, setFilteredWorkflows] = useState<Workflow[]>([]);

  useEffect(() => {
    if (!workflows) return;

    const query = searchQuery.toLowerCase().trim();
    if (!query) {
      setFilteredWorkflows(workflows);
      return;
    }

    const filtered = workflows.filter(
      (workflow) =>
        workflow.name.toLowerCase().includes(query) ||
        workflow.description?.toLowerCase().includes(query) ||
        workflow.category?.toLowerCase().includes(query)
    );
    setFilteredWorkflows(filtered);
  }, [searchQuery, workflows]);

  const handleWorkflowSelect = (workflowId: string) => {
    router.push(`/projects/${projectId}/verify/workflows/${workflowId}`);
  };

  const groupedWorkflows = filteredWorkflows.reduce(
    (acc, workflow) => {
      const category = workflow.category || "Uncategorized";
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(workflow);
      return acc;
    },
    {} as Record<string, Workflow[]>
  );

  if (!workflows || workflows.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-4">
        <Card className="bg-[#1A1A1B]/30 border-gray-800/50 border-dashed backdrop-blur-sm max-w-md">
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 bg-[#00D9FF]/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-[#00D9FF]" />
            </div>
            <h4 className="text-xl font-semibold mb-2 text-gray-300">
              No workflows found
            </h4>
            <p className="text-gray-500 mb-6">
              Create workflows in the automation builder to verify their state
              transitions.
            </p>
            <Button
              onClick={() => router.push("/automation-builder")}
              className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
            >
              Go to Automation Builder
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-200">
            Verify Workflow States
          </h2>
          <p className="text-gray-500 mt-1">
            Select a workflow to visualize its state transitions step-by-step
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-500" />
        <Input
          placeholder="Search workflows..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 bg-[#1A1A1B]/50 border-gray-800 text-gray-200 placeholder:text-gray-500"
        />
      </div>

      {filteredWorkflows.length === 0 ? (
        <Card className="bg-[#1A1A1B]/30 border-gray-800/50">
          <CardContent className="p-8 text-center">
            <p className="text-gray-500">
              No workflows match your search query.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedWorkflows).map(
            ([category, categoryWorkflows]) => (
              <div key={category}>
                <div className="flex items-center gap-2 mb-3">
                  <FolderOpen className="h-4 w-4 text-[#00D9FF]" />
                  <h3 className="text-lg font-semibold text-gray-300">
                    {category}
                  </h3>
                  <span className="text-sm text-gray-500">
                    ({categoryWorkflows.length})
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categoryWorkflows.map((workflow) => (
                    <Card
                      key={workflow.id}
                      className="bg-[#1A1A1B]/50 border-gray-800 hover:border-[#00D9FF]/50 transition-all cursor-pointer group"
                      onClick={() => handleWorkflowSelect(workflow.id)}
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-gray-200 text-base truncate">
                              {workflow.name}
                            </CardTitle>
                            {workflow.description && (
                              <CardDescription className="text-gray-500 text-sm mt-1 line-clamp-2">
                                {workflow.description}
                              </CardDescription>
                            )}
                          </div>
                          <ArrowRight className="h-5 w-5 text-gray-500 group-hover:text-[#00D9FF] transition-colors flex-shrink-0 ml-2" />
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center gap-4 text-sm text-gray-500">
                          <div className="flex items-center gap-1">
                            <Play className="h-3 w-3" />
                            <span>{workflow.actions.length} actions</span>
                          </div>
                          {workflow.metadata?.viewMode && (
                            <div className="text-xs bg-gray-800 px-2 py-1 rounded">
                              {workflow.metadata.viewMode}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function VerifyWorkflowsPage() {
  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-[400px]">
            <Loader2 className="h-8 w-8 animate-spin text-[#00D9FF]" />
          </div>
        }
      >
        <WorkflowsList />
      </Suspense>
    </div>
  );
}
