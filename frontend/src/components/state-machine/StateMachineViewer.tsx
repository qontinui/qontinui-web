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

import { useState, useMemo } from "react";
import {
  StateDiscoveryResult,
  DiscoveredState,
  StateTransition,
  StateImage,
  SOURCE_TYPE_LABELS,
  SOURCE_TYPE_COLORS,
} from "@/types/state-machine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Layers,
  ArrowRight,
  Grid3X3,
  ChevronRight,
  ChevronDown,
  Image as ImageIcon,
  MousePointer,
  Percent,
  Box,
  Info,
} from "lucide-react";

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
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set());

  // Build lookup maps
  const stateMap = useMemo(() => {
    const map = new Map<string, DiscoveredState>();
    result.states.forEach((s) => map.set(s.id, s));
    return map;
  }, [result.states]);

  const imageMap = useMemo(() => {
    const map = new Map<string, StateImage>();
    result.images.forEach((img) => map.set(img.id, img));
    return map;
  }, [result.images]);

  // Get transitions for a state
  const getOutgoingTransitions = (stateId: string) =>
    result.transitions.filter((t) => t.fromStateId === stateId);

  const getIncomingTransitions = (stateId: string) =>
    result.transitions.filter((t) => t.toStateId === stateId);

  // Toggle state expansion
  const toggleExpanded = (stateId: string) => {
    setExpandedStates((prev) => {
      const next = new Set(prev);
      if (next.has(stateId)) {
        next.delete(stateId);
      } else {
        next.add(stateId);
      }
      return next;
    });
  };

  // Handle state selection
  const handleStateClick = (state: DiscoveredState) => {
    setSelectedStateId(state.id);
    onStateSelect?.(state);
  };

  const selectedState = selectedStateId ? stateMap.get(selectedStateId) : null;

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Header with summary */}
      <Card className="bg-surface-raised/60 border-border-subtle">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg">{result.name}</CardTitle>
              <Badge
                variant="outline"
                className={SOURCE_TYPE_COLORS[result.sourceType]}
              >
                {SOURCE_TYPE_LABELS[result.sourceType]}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                      <Percent className="h-4 w-4" />
                      <span>{Math.round(result.confidence * 100)}%</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Overall confidence score</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          {result.description && (
            <p className="text-sm text-text-muted mt-1">{result.description}</p>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            <StatCard
              icon={<Layers className="h-4 w-4" />}
              label="States"
              value={result.stateCount}
            />
            <StatCard
              icon={<ImageIcon className="h-4 w-4" />}
              label="Images"
              value={result.imageCount}
            />
            <StatCard
              icon={<ArrowRight className="h-4 w-4" />}
              label="Transitions"
              value={result.transitionCount}
            />
            <StatCard
              icon={<Box className="h-4 w-4" />}
              label="Elements"
              value={result.uniqueElementCount}
            />
          </div>
        </CardContent>
      </Card>

      {/* Main content tabs */}
      <Tabs defaultValue="states" className="flex-1">
        <TabsList className="grid w-full grid-cols-3">
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

        {/* States Tab */}
        <TabsContent value="states" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            {/* State list */}
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
                        onClick={() => handleStateClick(state)}
                        onToggleExpand={() => toggleExpanded(state.id)}
                        onImageClick={onImageSelect}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* State details */}
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

// =============================================================================
// Sub-components
// =============================================================================

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
}

function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-default/50">
      <div className="text-brand-primary">{icon}</div>
      <div>
        <div className="text-xl font-semibold">{value}</div>
        <div className="text-xs text-text-muted">{label}</div>
      </div>
    </div>
  );
}

interface StateListItemProps {
  state: DiscoveredState;
  imageMap: Map<string, StateImage>;
  isSelected: boolean;
  isExpanded: boolean;
  outgoingTransitions: StateTransition[];
  incomingTransitions: StateTransition[];
  stateMap: Map<string, DiscoveredState>;
  onClick: () => void;
  onToggleExpand: () => void;
  onImageClick?: (image: StateImage) => void;
}

function StateListItem({
  state,
  imageMap,
  isSelected,
  isExpanded,
  outgoingTransitions,
  incomingTransitions: _incomingTransitions,
  stateMap: _stateMap,
  onClick,
  onToggleExpand,
  onImageClick,
}: StateListItemProps) {
  const images = state.imageIds
    .map((id) => imageMap.get(id))
    .filter((img): img is StateImage => img !== undefined);

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
      <div
        className={`rounded-lg border transition-colors ${
          isSelected
            ? "border-brand-primary bg-brand-primary/10"
            : "border-border-subtle bg-surface-default/50 hover:bg-surface-default"
        }`}
      >
        <div
          className="flex items-center gap-2 p-3 cursor-pointer"
          onClick={onClick}
        >
          <CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{state.name}</div>
            <div className="text-xs text-text-muted flex items-center gap-2">
              <span>{images.length} images</span>
              <span>|</span>
              <span>{state.elementIds.length} elements</span>
              {outgoingTransitions.length > 0 && (
                <>
                  <span>|</span>
                  <span>{outgoingTransitions.length} outgoing</span>
                </>
              )}
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            {Math.round(state.confidence * 100)}%
          </Badge>
        </div>

        <CollapsibleContent>
          <div className="px-3 pb-3 border-t border-border-subtle pt-2 mt-1">
            {state.description && (
              <p className="text-sm text-text-muted mb-2">{state.description}</p>
            )}
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.slice(0, 6).map((img) => (
                  <div
                    key={img.id}
                    className="w-12 h-12 rounded bg-surface-default border border-border-subtle flex items-center justify-center cursor-pointer hover:border-brand-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onImageClick?.(img);
                    }}
                    title={img.label || img.id}
                  >
                    <ImageIcon className="h-5 w-5 text-text-muted" />
                  </div>
                ))}
                {images.length > 6 && (
                  <div className="w-12 h-12 rounded bg-surface-default border border-border-subtle flex items-center justify-center text-xs text-text-muted">
                    +{images.length - 6}
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface StateDetailsProps {
  state: DiscoveredState;
  imageMap: Map<string, StateImage>;
  transitions: StateTransition[];
  stateMap: Map<string, DiscoveredState>;
  onImageClick?: (image: StateImage) => void;
  onTransitionClick?: (transition: StateTransition) => void;
}

function StateDetails({
  state,
  imageMap,
  transitions,
  stateMap,
  onImageClick,
  onTransitionClick,
}: StateDetailsProps) {
  const images = state.imageIds
    .map((id) => imageMap.get(id))
    .filter((img): img is StateImage => img !== undefined);

  return (
    <ScrollArea className="h-[350px]">
      <div className="space-y-4">
        <div>
          <h4 className="font-medium text-lg">{state.name}</h4>
          {state.description && (
            <p className="text-sm text-text-muted mt-1">{state.description}</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="p-2 rounded bg-surface-default/50">
            <div className="text-text-muted text-xs">Images</div>
            <div className="font-medium">{images.length}</div>
          </div>
          <div className="p-2 rounded bg-surface-default/50">
            <div className="text-text-muted text-xs">Elements</div>
            <div className="font-medium">{state.elementIds.length}</div>
          </div>
          <div className="p-2 rounded bg-surface-default/50">
            <div className="text-text-muted text-xs">Confidence</div>
            <div className="font-medium">{Math.round(state.confidence * 100)}%</div>
          </div>
        </div>

        {images.length > 0 && (
          <div>
            <h5 className="text-sm font-medium mb-2">Images</h5>
            <div className="grid grid-cols-4 gap-2">
              {images.map((img) => (
                <div
                  key={img.id}
                  className="aspect-square rounded bg-surface-default border border-border-subtle flex flex-col items-center justify-center cursor-pointer hover:border-brand-primary p-2"
                  onClick={() => onImageClick?.(img)}
                >
                  <ImageIcon className="h-6 w-6 text-text-muted mb-1" />
                  <span className="text-[10px] text-text-muted truncate w-full text-center">
                    {img.label || img.elementType || img.id}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {transitions.length > 0 && (
          <div>
            <h5 className="text-sm font-medium mb-2">Transitions</h5>
            <div className="space-y-1">
              {transitions.map((t) => {
                const fromState = stateMap.get(t.fromStateId);
                const toState = stateMap.get(t.toStateId);
                const isOutgoing = t.fromStateId === state.id;
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 text-sm p-2 rounded bg-surface-default/50 cursor-pointer hover:bg-surface-default"
                    onClick={() => onTransitionClick?.(t)}
                  >
                    <span className={isOutgoing ? "text-brand-primary" : "text-text-muted"}>
                      {fromState?.name || t.fromStateId}
                    </span>
                    <ArrowRight className="h-3 w-3 text-text-muted" />
                    <span className={!isOutgoing ? "text-brand-primary" : "text-text-muted"}>
                      {toState?.name || t.toStateId}
                    </span>
                    {t.trigger && (
                      <Badge variant="outline" className="text-xs ml-auto">
                        {t.trigger.type}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {state.elementIds.length > 0 && (
          <div>
            <h5 className="text-sm font-medium mb-2">Element IDs</h5>
            <div className="flex flex-wrap gap-1">
              {state.elementIds.slice(0, 10).map((id) => (
                <Badge key={id} variant="outline" className="text-xs font-mono">
                  {id}
                </Badge>
              ))}
              {state.elementIds.length > 10 && (
                <Badge variant="outline" className="text-xs">
                  +{state.elementIds.length - 10} more
                </Badge>
              )}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

interface TransitionListItemProps {
  transition: StateTransition;
  stateMap: Map<string, DiscoveredState>;
  imageMap: Map<string, StateImage>;
  onClick?: () => void;
}

function TransitionListItem({
  transition,
  stateMap,
  imageMap,
  onClick,
}: TransitionListItemProps) {
  const fromState = stateMap.get(transition.fromStateId);
  const toState = stateMap.get(transition.toStateId);
  // triggerImage available for future use (e.g., showing thumbnail)
  const _triggerImage = transition.trigger?.imageId
    ? imageMap.get(transition.trigger.imageId)
    : undefined;
  void _triggerImage; // Suppress unused variable warning

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle bg-surface-default/50 hover:bg-surface-default cursor-pointer"
      onClick={onClick}
    >
      <div className="flex-1 flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1">
          <div className="flex-1 text-right">
            <span className="font-medium">{fromState?.name || transition.fromStateId}</span>
          </div>
          <ArrowRight className="h-4 w-4 text-text-muted flex-shrink-0" />
          <div className="flex-1">
            <span className="font-medium">{toState?.name || transition.toStateId}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {transition.trigger && (
          <Badge variant="outline" className="flex items-center gap-1">
            <MousePointer className="h-3 w-3" />
            {transition.trigger.type}
          </Badge>
        )}
        <Badge variant="outline" className="text-xs">
          {Math.round(transition.confidence * 100)}%
        </Badge>
      </div>
    </div>
  );
}

interface CooccurrenceMatrixProps {
  elementToRenders: Record<string, string[]>;
  states: DiscoveredState[];
}

function CooccurrenceMatrix({ elementToRenders, states: _states }: CooccurrenceMatrixProps) {
  // Get elements that appear in at least 2 renders (interesting for co-occurrence)
  const elements = Object.entries(elementToRenders)
    .filter(([, renders]) => renders.length >= 2)
    .slice(0, 20); // Limit for display

  if (elements.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center text-text-muted">
        <div className="text-center">
          <Grid3X3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No co-occurrence data available</p>
        </div>
      </div>
    );
  }

  // Calculate co-occurrence between elements
  const calculateCooccurrence = (el1Renders: string[], el2Renders: string[]) => {
    const intersection = el1Renders.filter((r) => el2Renders.includes(r));
    const union = [...new Set([...el1Renders, ...el2Renders])];
    return union.length > 0 ? intersection.length / union.length : 0;
  };

  return (
    <div className="overflow-x-auto">
      <div className="text-sm text-text-muted mb-4">
        Showing top {elements.length} elements by render count. Higher values indicate elements that frequently appear together.
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="p-1 text-left font-medium"></th>
            {elements.map(([id]) => (
              <th
                key={id}
                className="p-1 text-center font-medium max-w-[60px] truncate"
                title={id}
              >
                {id.slice(0, 8)}...
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {elements.map(([id1, renders1]) => (
            <tr key={id1}>
              <td className="p-1 font-medium truncate max-w-[100px]" title={id1}>
                {id1.slice(0, 12)}...
              </td>
              {elements.map(([id2, renders2]) => {
                const cooc = calculateCooccurrence(renders1, renders2);
                return (
                  <td
                    key={id2}
                    className="p-1 text-center"
                    style={{
                      backgroundColor:
                        id1 === id2
                          ? "transparent"
                          : `rgba(155, 89, 182, ${cooc * 0.5})`,
                    }}
                    title={`${id1} + ${id2}: ${Math.round(cooc * 100)}%`}
                  >
                    {id1 === id2 ? "-" : Math.round(cooc * 100)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default StateMachineViewer;
