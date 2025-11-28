"use client";

/**
 * Verify Individual States Page
 *
 * Purpose: Allow users to verify how individual states look by showing StateImages
 * at their configured fixed positions. Uses ONLY state structure position data.
 *
 * Features:
 * - List of all states in project (left sidebar)
 * - State visualization canvas (main area)
 * - State metadata panel (right sidebar)
 */

import { useState, useMemo, Suspense } from "react";
import { useAutomation } from "@/contexts/automation-context";
import { RequireProject } from "@/components/require-project";
import { StateVisualizer } from "@/components/verify/StateVisualizer";
import { StateList } from "@/components/verify/StateList";
import { StateMetadataPanel } from "@/components/verify/StateMetadataPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Eye } from "lucide-react";

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-[#00D9FF]" />
    </div>
  );
}

function VerifyStatesContent() {
  const { states, transitions } = useAutomation();
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [highlightElementId, setHighlightElementId] = useState<
    string | undefined
  >();
  const [showPositions, setShowPositions] = useState(false);

  // Get the selected state
  const selectedState = useMemo(() => {
    if (!selectedStateId) return null;
    return states.find((s) => s.id === selectedStateId) || null;
  }, [states, selectedStateId]);

  // Calculate transition counts for selected state
  const transitionCounts = useMemo(() => {
    if (!selectedState) return { incoming: 0, outgoing: 0 };

    const outgoing = transitions.filter(
      (t) => t.type === "OutgoingTransition" && t.fromState === selectedState.id
    ).length;

    const incoming = transitions.filter(
      (t) =>
        (t.type === "IncomingTransition" && t.toState === selectedState.id) ||
        (t.type === "OutgoingTransition" && t.toState === selectedState.id)
    ).length;

    return { incoming, outgoing };
  }, [selectedState, transitions]);

  // Auto-select first state if none selected
  useMemo(() => {
    if (!selectedStateId && states.length > 0) {
      setSelectedStateId(states[0].id);
    }
  }, [states, selectedStateId]);

  return (
    <div className="container mx-auto py-8 h-[calc(100vh-4rem)] flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Eye className="h-8 w-8" />
          Verify Individual States
        </h1>
        <p className="text-muted-foreground">
          Visualize how states look with their elements positioned at configured
          fixed positions
        </p>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-12 gap-6 min-h-0">
        {/* Left Sidebar - State List */}
        <div className="col-span-3 flex flex-col min-h-0">
          <StateList
            states={states}
            selectedStateId={selectedStateId}
            onSelectState={setSelectedStateId}
          />
        </div>

        {/* Main Canvas Area */}
        <div className="col-span-6 flex flex-col min-h-0">
          <Card className="flex-1 flex flex-col min-h-0">
            <CardContent className="flex-1 min-h-0 p-6">
              {selectedState ? (
                <StateVisualizer
                  state={selectedState}
                  canvasSize={{ width: 1920, height: 1080 }}
                  showPositions={showPositions}
                  highlightElement={highlightElementId}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-muted-foreground">
                    <Eye className="mx-auto h-12 w-12 mb-2 opacity-50" />
                    <p>No state selected</p>
                    <p className="text-xs mt-1">
                      {states.length === 0
                        ? "Create states to visualize them"
                        : "Select a state from the list"}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Sidebar - State Metadata */}
        <div className="col-span-3 flex flex-col min-h-0">
          <StateMetadataPanel
            state={selectedState}
            transitionCounts={transitionCounts}
            showPositions={showPositions}
            onTogglePositions={() => setShowPositions(!showPositions)}
            highlightElementId={highlightElementId}
            onHighlightElement={setHighlightElementId}
          />
        </div>
      </div>
    </div>
  );
}

export default function VerifyStatesPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <RequireProject pageName="Verify States">
        <VerifyStatesContent />
      </RequireProject>
    </Suspense>
  );
}
