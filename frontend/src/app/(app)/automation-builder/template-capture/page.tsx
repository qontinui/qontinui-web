"use client";

/**
 * Template Capture Page
 *
 * Click-to-template system for automatically detecting element boundaries.
 * Allows users to:
 * - Start/stop click capture sessions via the runner
 * - Review detected template candidates
 * - Adjust boundaries and approve/reject templates
 * - Import approved templates into state machines
 * - Manage application detection profiles
 */

import { useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequireProject } from "@/components/require-project";
import {
  CaptureSessionPanel,
  TemplateReviewPanel,
  ApplicationProfileManager,
} from "@/components/template-capture";
import { useProject } from "@/hooks/automation/useProject";
import { toast } from "sonner";

export default function TemplateCapturePanel() {
  const { projectId } = useProject();
  const [activeTab, setActiveTab] = useState("capture");
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);

  const handleCaptureComplete = useCallback(
    (sessionId: string, candidatesCount: number) => {
      setLastSessionId(sessionId);
      if (candidatesCount > 0) {
        toast.success(`Captured ${candidatesCount} template candidates`, {
          description: "Switch to the Review tab to approve or adjust them.",
          action: {
            label: "Review",
            onClick: () => setActiveTab("review"),
          },
        });
        // Auto-switch to review tab
        setActiveTab("review");
      } else {
        toast.info("No click events detected", {
          description: "Try clicking on more UI elements during capture.",
        });
      }
    },
    []
  );

  const handleCandidateApproved = useCallback((_id: string) => {
    toast.success("Template approved", {
      description: "Click on it to import into a state machine.",
    });
  }, []);

  const handleCandidateRejected = useCallback((_id: string) => {
    toast.info("Template rejected");
  }, []);

  const handleCandidateImported = useCallback(
    (_id: string, _stateId: string) => {
      toast.success("Template imported to state machine");
    },
    []
  );

  return (
    <RequireProject pageName="Template Capture">
      <div className="h-full flex flex-col">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col"
        >
          <div className="border-b px-4">
            <TabsList>
              <TabsTrigger value="capture">Capture</TabsTrigger>
              <TabsTrigger value="review">Review Templates</TabsTrigger>
              <TabsTrigger value="profiles">App Profiles</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="capture" className="flex-1 p-4 overflow-auto">
            <div className="max-w-2xl mx-auto">
              <CaptureSessionPanel onCaptureComplete={handleCaptureComplete} />
            </div>
          </TabsContent>

          <TabsContent value="review" className="flex-1 overflow-hidden">
            <TemplateReviewPanel
              projectId={projectId || undefined}
              sessionId={lastSessionId || undefined}
              onCandidateApproved={handleCandidateApproved}
              onCandidateRejected={handleCandidateRejected}
              onCandidateImported={handleCandidateImported}
              className="h-full"
            />
          </TabsContent>

          <TabsContent value="profiles" className="flex-1 p-4 overflow-auto">
            <div className="max-w-3xl mx-auto">
              <ApplicationProfileManager />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </RequireProject>
  );
}
