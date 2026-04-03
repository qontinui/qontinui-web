"use client";

/**
 * Unified State Machine Viewer
 *
 * Displays state machine results from any discovery source:
 * - Playwright web extraction
 * - UI Bridge exploration
 * - Video recording analysis
 * - Vision-based extraction
 *
 * Shows:
 * - State list with element counts
 * - Transition graph
 * - Co-occurrence matrix
 * - Individual state details with images
 */

import {
  StateDiscoveryResult,
  DiscoveredState,
  StateTransition,
  StateImage,
} from "@/types/state-machine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Layers, ArrowRight, Grid3X3, Info, Workflow } from "lucide-react";
import { useStateMachineViewer } from "./_hooks/useStateMachineViewer";
import { SummaryHeader } from "./_components/SummaryHeader";
import { StateListItem } from "./_components/StateListItem";
import { StateDetails } from "./_components/StateDetails";
import { TransitionListItem } from "./_components/TransitionListItem";
import { CooccurrenceMatrix } from "./_components/CooccurrenceMatrix";
import { StateMachineGraph } from "./_components/StateMachineGraph";

interface StateMachineViewerProps {
  result: StateDiscoveryResult;
  onStateSelect?: (state: DiscoveredState) => void;
  onTransitionSelect?: (transition: StateTransition) => void;
  onImageSelect?: (image: StateImage) => void;
  className?: string;
}

export function StateMachineViewer({
  result,
  onStateSelect,
  onTransitionSelect,
  onImageSelect,
  className = "",
}: StateMachineViewerProps) {
  const {
    selectedStateId,
    expandedStates,
    stateMap,
    imageMap,
    selectedState,
    getOutgoingTransitions,
    getIncomingTransitions,
    toggleExpanded,
    handleStateClick,
  } = useStateMachineViewer(result);

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <SummaryHeader result={result} />

      <Tabs defaultValue="graph" className="flex-1">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="graph" className="flex items-center gap-2">
            <Workflow className="h-4 w-4" />
            Graph
          </TabsTrigger>
          <TabsTrigger value="states" className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            States
          </TabsTrigger>
          <TabsTrigger value="transitions" className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4" />
            Transitions
          </TabsTrigger>
          <TabsTrigger value="matrix" className="flex items-center gap-2">
            <Grid3X3 className="h-4 w-4" />
            Co-occurrence
          </TabsTrigger>
        </TabsList>

        {/* Graph Tab */}
        <TabsContent value="graph" className="mt-4">
          <Card className="bg-surface-raised/60 border-border-subtle">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                State Transition Graph
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <StateMachineGraph
                states={result.states}
                transitions={result.transitions}
                onStateClick={(stateId) => {
                  const state = stateMap.get(stateId);
                  if (state) onStateSelect?.(state);
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* States Tab */}
        <TabsContent value="states" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Card className="bg-surface-raised/60 border-border-subtle">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  Discovered States ({result.states.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[400px]">
                  <div className="p-4 space-y-2">
                    {result.states.map((state) => (
                      <StateListItem
                        key={state.id}
                        state={state}
                        imageMap={imageMap}
                        isSelected={state.id === selectedStateId}
                        isExpanded={expandedStates.has(state.id)}
                        outgoingTransitions={getOutgoingTransitions(state.id)}
                        incomingTransitions={getIncomingTransitions(state.id)}
                        stateMap={stateMap}
                        onClick={() => handleStateClick(state, onStateSelect)}
                        onToggleExpand={() => toggleExpanded(state.id)}
                        onImageClick={onImageSelect}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="bg-surface-raised/60 border-border-subtle">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  State Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedState ? (
                  <StateDetails
                    state={selectedState}
                    imageMap={imageMap}
                    transitions={[
                      ...getOutgoingTransitions(selectedState.id),
                      ...getIncomingTransitions(selectedState.id),
                    ]}
                    stateMap={stateMap}
                    onImageClick={onImageSelect}
                    onTransitionClick={onTransitionSelect}
                  />
                ) : (
                  <div className="h-[350px] flex items-center justify-center text-text-muted">
                    <div className="text-center">
                      <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>Select a state to view details</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Transitions Tab */}
        <TabsContent value="transitions" className="mt-4">
          <Card className="bg-surface-raised/60 border-border-subtle">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                State Transitions ({result.transitions.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {result.transitions.length === 0 ? (
                    <div className="text-center text-text-muted py-8">
                      No transitions discovered
                    </div>
                  ) : (
                    result.transitions.map((transition) => (
                      <TransitionListItem
                        key={transition.id}
                        transition={transition}
                        stateMap={stateMap}
                        imageMap={imageMap}
                        onClick={() => onTransitionSelect?.(transition)}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Co-occurrence Matrix Tab */}
        <TabsContent value="matrix" className="mt-4">
          <Card className="bg-surface-raised/60 border-border-subtle">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Element Co-occurrence Matrix
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CooccurrenceMatrix
                elementToRenders={result.elementToRenders}
                states={result.states}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default StateMachineViewer;
