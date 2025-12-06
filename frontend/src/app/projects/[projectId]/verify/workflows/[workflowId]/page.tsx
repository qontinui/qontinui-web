"use client";

/**
 * Workflow Verification Page
 *
 * Visualizes the active states at each step of a workflow.
 * Shows which states are active at the current step and allows stepping through the workflow.
 */

import { Suspense, useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAutomation } from "@/contexts/automation-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { WorkflowStepList } from "@/components/verify/WorkflowStepList";
import { ActiveStatesVisualizer } from "@/components/verify/ActiveStatesVisualizer";
import { ActiveStatesChecklist } from "@/components/verify/ActiveStatesChecklist";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { State } from "@/contexts/automation-context";

/**
 * Determine which states are active at a given workflow step
 * This is a simplified version - in a real implementation, you would:
 * 1. Parse the workflow actions to find GO_TO_STATE actions
 * 2. Track state activations/deactivations based on transition definitions
 * 3. Maintain the set of currently active states as the workflow progresses
 */
function getActiveStatesAtStep(
  workflow: Workflow,
  step: number,
  states: State[]
): string[] {
  if (!workflow || !states || step < 0 || step >= workflow.actions.length) {
    return [];
  }

  const activeStateIds = new Set<string>();

  // Analyze all actions up to and including the current step
  for (let i = 0; i <= step; i++) {
    const action = workflow.actions[i];
    if (!action) continue;

    // Handle GO_TO_STATE actions
    if (action.type === "GO_TO_STATE" && "stateIds" in action.config) {
      // Add the target states
      action.config.stateIds.forEach((stateId) => activeStateIds.add(stateId));
    }

    // Handle FIND with stateImage target (implies the state is active)
    if (
      action.type === "FIND" &&
      "target" in action.config &&
      typeof action.config.target === "object" &&
      action.config.target?.type === "stateImage" &&
      action.config.target?.stateId
    ) {
      activeStateIds.add(action.config.target.stateId);
    }
  }

  // If no states found, return initial states
  if (activeStateIds.size === 0) {
    const initialStates = states.filter((s) => s.initial).map((s) => s.id);
    return initialStates;
  }

  return Array.from(activeStateIds);
}

function WorkflowVerification() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const workflowId = params.workflowId as string;

  const { workflows, states } = useAutomation();
  const [currentStep, setCurrentStep] = useState(0);

  const workflow = useMemo(
    () => workflows?.find((w) => w.id === workflowId),
    [workflows, workflowId]
  );

  const activeStateIds = useMemo(
    () => getActiveStatesAtStep(workflow!, currentStep, states || []),
    [workflow, currentStep, states]
  );

  const activeStates = useMemo(
    () => states?.filter((s) => activeStateIds.includes(s.id)) || [],
    [states, activeStateIds]
  );

  // Calculate canvas size based on state positions
  const canvasSize = useMemo(() => {
    if (!states || states.length === 0) {
      return { width: 1920, height: 1080 };
    }

    const maxX = Math.max(...states.map((s) => s.position.x)) + 400;
    const maxY = Math.max(...states.map((s) => s.position.y)) + 400;

    return {
      width: Math.max(maxX, 1920),
      height: Math.max(maxY, 1080),
    };
  }, [states]);

  useEffect(() => {
    // Reset to step 0 when workflow changes
    setCurrentStep(0);
  }, [workflowId]);

  if (!workflow) {
    return (
      <div className="container mx-auto p-6 max-w-7xl">
        <Card className="bg-[#1A1A1B]/30 border-gray-800/50">
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h4 className="text-xl font-semibold mb-2 text-gray-300">
              Workflow not found
            </h4>
            <p className="text-gray-500 mb-6">
              The requested workflow could not be found.
            </p>
            <Button
              onClick={() =>
                router.push(`/projects/${projectId}/verify/workflows`)
              }
              className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Workflows
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!workflow.actions || workflow.actions.length === 0) {
    return (
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="mb-6">
          <Button
            onClick={() =>
              router.push(`/projects/${projectId}/verify/workflows`)
            }
            variant="ghost"
            className="text-gray-400 hover:text-gray-200"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Workflows
          </Button>
        </div>
        <Card className="bg-[#1A1A1B]/30 border-gray-800/50">
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-yellow-500" />
            </div>
            <h4 className="text-xl font-semibold mb-2 text-gray-300">
              No actions in workflow
            </h4>
            <p className="text-gray-500">
              This workflow has no actions to visualize.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleStepSelect = (step: number) => {
    setCurrentStep(Math.max(0, Math.min(step, workflow.actions.length - 1)));
  };

  const handlePreviousStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleNextStep = () => {
    if (currentStep < workflow.actions.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-[1800px]">
      {/* Header */}
      <div className="mb-6">
        <Button
          onClick={() => router.push(`/projects/${projectId}/verify/workflows`)}
          variant="ghost"
          className="text-gray-400 hover:text-gray-200 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Workflows
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-200">
              {workflow.name}
            </h1>
            {workflow.description && (
              <p className="text-gray-500 mt-1">{workflow.description}</p>
            )}
          </div>

          <div className="text-right">
            <div className="text-sm text-gray-500">Step</div>
            <div className="text-2xl font-bold text-[#00D9FF]">
              {currentStep + 1} / {workflow.actions.length}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Sidebar - Workflow Steps */}
        <div className="col-span-12 lg:col-span-3">
          <Card className="bg-[#1A1A1B]/50 border-gray-800 sticky top-6">
            <CardHeader>
              <CardTitle className="text-gray-200 text-base">
                Workflow Steps
              </CardTitle>
            </CardHeader>
            <CardContent>
              <WorkflowStepList
                workflow={workflow}
                currentStep={currentStep}
                onStepSelect={handleStepSelect}
              />
            </CardContent>
          </Card>
        </div>

        {/* Center - Active States Visualization */}
        <div className="col-span-12 lg:col-span-6">
          <Card className="bg-[#1A1A1B]/50 border-gray-800">
            <CardHeader>
              <CardTitle className="text-gray-200 text-base">
                Active States Visualization
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ActiveStatesVisualizer
                activeStates={activeStates}
                canvasSize={canvasSize}
                showStateLabels={true}
              />
            </CardContent>
          </Card>

          {/* Navigation Controls */}
          <div className="flex items-center justify-between mt-4">
            <Button
              onClick={handlePreviousStep}
              disabled={currentStep === 0}
              variant="outline"
              className="bg-[#1A1A1B]/50 border-gray-800 text-gray-200 hover:bg-[#1A1A1B] hover:text-[#00D9FF]"
            >
              <ChevronLeft className="w-4 h-4 mr-2" />
              Previous Step
            </Button>

            <Button
              onClick={handleNextStep}
              disabled={currentStep === workflow.actions.length - 1}
              variant="outline"
              className="bg-[#1A1A1B]/50 border-gray-800 text-gray-200 hover:bg-[#1A1A1B] hover:text-[#00D9FF]"
            >
              Next Step
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>

        {/* Right Sidebar - Active States Checklist */}
        <div className="col-span-12 lg:col-span-3">
          <Card className="bg-[#1A1A1B]/50 border-gray-800 sticky top-6">
            <CardHeader>
              <CardTitle className="text-gray-200 text-base">
                Active States ({activeStateIds.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ActiveStatesChecklist
                allStates={states || []}
                activeStateIds={activeStateIds}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function WorkflowVerificationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-[#00D9FF]" />
        </div>
      }
    >
      <WorkflowVerification />
    </Suspense>
  );
}
