"use client";

import { useState, useMemo, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Layers,
  Box,
  FileText,
  Footprints,
  Search,
  ChevronDown,
  ChevronRight,
  GitBranch,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import type {
  UIBridgeJobStatus,
  UIBridgeRawResults,
  UIBridgeDiscoveredState,
  UIBridgeDiscoveredElement,
  UIBridgeExplorationStep,
  UIBridgeRenderLog,
  SuggestedTransition,
} from "@/hooks/useUIBridgeExploration";
import { buildTransitionsFromSteps } from "@/lib/ui-bridge/transition-builder";
import { TransitionPreviewPanel } from "@/components/ui-bridge";

interface UIBridgeResultsViewProps {
  job: UIBridgeJobStatus;
  results?: UIBridgeRawResults | null;
  onAcceptTransition?: (transition: SuggestedTransition) => void;
  onAcceptAllTransitions?: (transitions: SuggestedTransition[]) => void;
}

function MetricsCard({ results }: { results: UIBridgeRawResults }) {
  const statesCount = results.state_discovery?.states.length || 0;
  const elementsCount = results.state_discovery?.unique_element_count || 0;

  return (
    <Card className="border-teal-500/30 bg-teal-500/5">
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-medium text-teal-400">
          Exploration Metrics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-2xl font-bold">{results.elements_discovered}</p>
            <p className="text-xs text-muted-foreground">Elements Found</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold text-green-500">
              {results.elements_explored}
            </p>
            <p className="text-xs text-muted-foreground">Explored</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold text-blue-500">
              {results.render_log_count}
            </p>
            <p className="text-xs text-muted-foreground">Render Logs</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold text-purple-500">{statesCount}</p>
            <p className="text-xs text-muted-foreground">States Discovered</p>
          </div>
        </div>

        {results.state_discovery && (
          <>
            <div className="my-4 border-t border-border" />
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Unique Elements</span>
                <span className="font-medium">{elementsCount}</span>
              </div>
              <Progress
                value={
                  results.elements_discovered > 0
                    ? (results.elements_explored /
                        results.elements_discovered) *
                      100
                    : 0
                }
                className="h-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="text-green-500">
                  {results.elements_explored} explored
                </span>
                <span className="text-yellow-500">
                  {results.elements_discovered - results.elements_explored}{" "}
                  remaining
                </span>
              </div>
            </div>
          </>
        )}

        {results.errors.length > 0 && (
          <div className="mt-4 flex items-center gap-2 text-red-500">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">
              {results.errors.length} errors encountered
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatesTable({ states }: { states: UIBridgeDiscoveredState[] }) {
  const [search, setSearch] = useState("");

  const filteredStates = useMemo(() => {
    if (!search) return states;
    const searchLower = search.toLowerCase();
    return states.filter(
      (s) =>
        s.name.toLowerCase().includes(searchLower) ||
        s.id.toLowerCase().includes(searchLower)
    );
  }, [states, search]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search states..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <ScrollArea className="h-[400px] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-24">Images</TableHead>
              <TableHead className="w-32">Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredStates.map((state) => (
              <TableRow key={state.id}>
                <TableCell>
                  <div className="space-y-1">
                    <p className="font-medium">{state.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {state.id}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {state.state_image_ids.length}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress
                      value={state.confidence * 100}
                      className="h-2 w-16"
                    />
                    <span className="text-sm">
                      {(state.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <p className="text-xs text-muted-foreground text-center">
        Showing {filteredStates.length} of {states.length} states
      </p>
    </div>
  );
}

function ElementsTable({
  elements,
}: {
  elements: UIBridgeDiscoveredElement[];
}) {
  const [search, setSearch] = useState("");

  const filteredElements = useMemo(() => {
    if (!search) return elements;
    const searchLower = search.toLowerCase();
    return elements.filter(
      (e) =>
        e.name.toLowerCase().includes(searchLower) ||
        e.id.toLowerCase().includes(searchLower) ||
        e.type.toLowerCase().includes(searchLower) ||
        e.tag_name?.toLowerCase().includes(searchLower) ||
        e.text_content?.toLowerCase().includes(searchLower)
    );
  }, [elements, search]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search elements..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <ScrollArea className="h-[400px] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Element</TableHead>
              <TableHead className="w-24">Type</TableHead>
              <TableHead className="w-24">Tag</TableHead>
              <TableHead className="w-24">Renders</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredElements.map((element) => (
              <TableRow key={element.id}>
                <TableCell>
                  <div className="space-y-1">
                    <p className="font-medium truncate max-w-[300px]">
                      {element.name || element.text_content || element.id}
                    </p>
                    {element.component_name && (
                      <p className="text-xs text-muted-foreground font-mono">
                        {element.component_name}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{element.type}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-mono">
                    {element.tag_name || "unknown"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{element.render_ids.length}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <p className="text-xs text-muted-foreground text-center">
        Showing {filteredElements.length} of {elements.length} elements
      </p>
    </div>
  );
}

function RenderLogsList({ logs }: { logs: UIBridgeRenderLog[] }) {
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const toggleLog = (id: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-2">
        {logs.map((log, idx) => (
          <Collapsible
            key={log.id}
            open={expandedLogs.has(log.id)}
            onOpenChange={() => toggleLog(log.id)}
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between font-normal h-auto py-2"
              >
                <div className="flex items-center gap-2 text-left">
                  {expandedLogs.has(log.id) ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="font-mono text-sm">#{idx + 1}</span>
                  <span className="truncate max-w-[300px]">{log.url}</span>
                </div>
                <Badge variant="secondary">{log.elements_count} elements</Badge>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pl-6 space-y-1">
              <div className="p-2 rounded-md bg-muted/50 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">ID:</span>
                  <span className="font-mono text-xs">{log.id}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Timestamp:</span>
                  <span className="text-xs">{log.timestamp}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Elements:</span>
                  <span className="text-xs">{log.elements_count}</span>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </ScrollArea>
  );
}

function StepsTable({ steps }: { steps: UIBridgeExplorationStep[] }) {
  return (
    <ScrollArea className="h-[400px] rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Element</TableHead>
            <TableHead className="w-24">Action</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead className="w-24">State Changed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {steps.map((step, idx) => (
            <TableRow key={step.step_id}>
              <TableCell className="font-mono text-muted-foreground">
                {idx + 1}
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <p className="font-mono text-sm truncate max-w-[250px]">
                    {step.element_id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Depth: {step.depth}
                  </p>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{step.action}</Badge>
              </TableCell>
              <TableCell>
                {step.success ? (
                  <Badge variant="default" className="bg-green-500">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Success
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <XCircle className="h-3 w-3 mr-1" />
                    Failed
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                {step.state_changed ? (
                  <Badge variant="default" className="bg-blue-500">
                    Yes
                  </Badge>
                ) : (
                  <Badge variant="outline">No</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

function ErrorsList({ errors }: { errors: string[] }) {
  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-2">
        {errors.map((error, i) => (
          <div
            key={i}
            className="p-2 rounded-md bg-red-500/10 border border-red-500/30"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

export function UIBridgeResultsView({
  job,
  results,
  onAcceptTransition,
  onAcceptAllTransitions,
}: UIBridgeResultsViewProps) {
  // Build suggested transitions from steps
  const transitionBuildResult = useMemo(() => {
    if (!results?.steps?.length) {
      return { transitions: [], stateHashes: new Map(), unmappedSteps: [] };
    }
    return buildTransitionsFromSteps(
      results.steps,
      results.state_discovery?.states
    );
  }, [results?.steps, results?.state_discovery?.states]);

  const suggestedTransitions = transitionBuildResult.transitions;

  // Check if we have enhanced step data for transition discovery
  const hasEnhancedStepData = useMemo(() => {
    if (!results?.steps?.length) return false;
    // Check if the first step has the enhanced fields
    const firstStep = results.steps[0];
    return (
      firstStep?.action_result !== undefined ||
      firstStep?.snapshot_before_hash !== undefined
    );
  }, [results?.steps]);

  // Handlers for transition acceptance
  const handleAcceptTransition = useCallback(
    (transition: SuggestedTransition) => {
      onAcceptTransition?.(transition);
    },
    [onAcceptTransition]
  );

  const handleAcceptAllTransitions = useCallback(
    (transitions: SuggestedTransition[]) => {
      onAcceptAllTransitions?.(transitions);
    },
    [onAcceptAllTransitions]
  );

  // Handle case where job is not yet available
  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No job data available</p>
      </div>
    );
  }

  // Show progress when job is running
  if (job.status === "running" || job.status === "pending") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
        <p className="text-muted-foreground">
          {job.progress_message || `Exploration ${job.status}...`}
        </p>
        {job.progress_percent !== undefined && (
          <Progress value={job.progress_percent} className="w-64" />
        )}
        {job.elements_discovered !== undefined && (
          <div className="text-sm text-muted-foreground">
            {job.elements_explored || 0} / {job.elements_discovered} elements
            explored
          </div>
        )}
      </div>
    );
  }

  if (!results) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No results available</p>
      </div>
    );
  }

  const states = results.state_discovery?.states || [];
  const elements = results.state_discovery?.elements || [];
  const renderLogs = results.render_logs || [];
  const steps = results.steps || [];
  const errors = results.errors || [];

  return (
    <div className="space-y-4">
      {/* Metrics Summary */}
      <MetricsCard results={results} />

      {/* Results Tabs */}
      <Tabs defaultValue="states" className="w-full">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="states" className="flex items-center gap-1">
            <Layers className="h-4 w-4" />
            States
            <Badge variant="secondary" className="ml-1">
              {states.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="transitions" className="flex items-center gap-1">
            <GitBranch className="h-4 w-4" />
            Transitions
            {suggestedTransitions.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {suggestedTransitions.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="elements" className="flex items-center gap-1">
            <Box className="h-4 w-4" />
            Elements
            <Badge variant="secondary" className="ml-1">
              {elements.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="renders" className="flex items-center gap-1">
            <FileText className="h-4 w-4" />
            Logs
            <Badge variant="secondary" className="ml-1">
              {renderLogs.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="steps" className="flex items-center gap-1">
            <Footprints className="h-4 w-4" />
            Steps
            <Badge variant="secondary" className="ml-1">
              {steps.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="errors" className="flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            Errors
            {errors.length > 0 && (
              <Badge variant="destructive" className="ml-1">
                {errors.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="states" className="mt-4">
          {states.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Layers className="h-12 w-12 mb-4" />
              <p>No states discovered</p>
              <p className="text-sm">
                State discovery runs after exploration completes
              </p>
            </div>
          ) : (
            <StatesTable states={states} />
          )}
        </TabsContent>

        <TabsContent value="transitions" className="mt-4">
          {hasEnhancedStepData ? (
            <TransitionPreviewPanel
              suggestedTransitions={suggestedTransitions}
              discoveredStates={states}
              onAccept={handleAcceptTransition}
              onAcceptAll={handleAcceptAllTransitions}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <GitBranch className="h-12 w-12 mb-4" />
              <p>Transition discovery requires updated runner</p>
              <p className="text-sm">
                Please update qontinui-runner to enable transition discovery
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="elements" className="mt-4">
          {elements.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Box className="h-12 w-12 mb-4" />
              <p>No elements discovered</p>
            </div>
          ) : (
            <ElementsTable elements={elements} />
          )}
        </TabsContent>

        <TabsContent value="renders" className="mt-4">
          {renderLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <FileText className="h-12 w-12 mb-4" />
              <p>No render logs captured</p>
            </div>
          ) : (
            <RenderLogsList logs={renderLogs} />
          )}
        </TabsContent>

        <TabsContent value="steps" className="mt-4">
          {steps.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Footprints className="h-12 w-12 mb-4" />
              <p>No exploration steps recorded</p>
            </div>
          ) : (
            <StepsTable steps={steps} />
          )}
        </TabsContent>

        <TabsContent value="errors" className="mt-4">
          {errors.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mb-4 text-green-500" />
              <p>No errors encountered during exploration</p>
            </div>
          ) : (
            <ErrorsList errors={errors} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
