"use client";

import { useState, useMemo, useCallback } from "react";
import {
  GitBranch,
  Table2,
  Network,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type {
  SuggestedTransition,
  UIBridgeDiscoveredState,
} from "@/hooks/useUIBridgeExploration";
import { getConfidenceDistribution, getUniqueStates } from "@/lib/ui-bridge/transition-builder";
import { TransitionTable } from "./TransitionTable";
import { TransitionGraph } from "./TransitionGraph";

interface TransitionPreviewPanelProps {
  suggestedTransitions: SuggestedTransition[];
  discoveredStates?: UIBridgeDiscoveredState[];
  onAccept?: (transition: SuggestedTransition) => void;
  onReject?: (transition: SuggestedTransition) => void;
  onAcceptAll?: (transitions: SuggestedTransition[]) => void;
}

export function TransitionPreviewPanel({
  suggestedTransitions,
  discoveredStates,
  onAccept,
  onReject,
  onAcceptAll,
}: TransitionPreviewPanelProps) {
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [selectedTransition, setSelectedTransition] = useState<SuggestedTransition | null>(null);

  // Calculate metrics
  const metrics = useMemo(() => {
    const distribution = getConfidenceDistribution(suggestedTransitions);
    const uniqueStates = getUniqueStates(suggestedTransitions);
    return {
      totalTransitions: suggestedTransitions.length,
      uniqueStates: uniqueStates.size,
      accepted: acceptedIds.size,
      rejected: rejectedIds.size,
      pending: suggestedTransitions.length - acceptedIds.size - rejectedIds.size,
      ...distribution,
    };
  }, [suggestedTransitions, acceptedIds, rejectedIds]);

  const handleAccept = useCallback(
    (transition: SuggestedTransition) => {
      setAcceptedIds((prev) => new Set([...prev, transition.id]));
      setRejectedIds((prev) => {
        const next = new Set(prev);
        next.delete(transition.id);
        return next;
      });
      onAccept?.(transition);
    },
    [onAccept]
  );

  const handleReject = useCallback(
    (transition: SuggestedTransition) => {
      setRejectedIds((prev) => new Set([...prev, transition.id]));
      setAcceptedIds((prev) => {
        const next = new Set(prev);
        next.delete(transition.id);
        return next;
      });
      onReject?.(transition);
    },
    [onReject]
  );

  const handleAcceptAll = useCallback(() => {
    const pendingTransitions = suggestedTransitions.filter(
      (t) => !acceptedIds.has(t.id) && !rejectedIds.has(t.id)
    );
    setAcceptedIds(
      (prev) => new Set([...prev, ...pendingTransitions.map((t) => t.id)])
    );
    onAcceptAll?.(pendingTransitions);
  }, [suggestedTransitions, acceptedIds, rejectedIds, onAcceptAll]);

  const handleAcceptHighConfidence = useCallback(() => {
    const highConfidenceTransitions = suggestedTransitions.filter(
      (t) => t.confidence >= 0.7 && !acceptedIds.has(t.id) && !rejectedIds.has(t.id)
    );
    setAcceptedIds(
      (prev) => new Set([...prev, ...highConfidenceTransitions.map((t) => t.id)])
    );
    onAcceptAll?.(highConfidenceTransitions);
  }, [suggestedTransitions, acceptedIds, rejectedIds, onAcceptAll]);

  const handleReset = useCallback(() => {
    setAcceptedIds(new Set());
    setRejectedIds(new Set());
  }, []);

  if (suggestedTransitions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <GitBranch className="h-12 w-12 mb-4" />
        <p>No transitions discovered</p>
        <p className="text-sm">
          Transitions are discovered when exploration causes state changes
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Card */}
      <Card className="border-teal-500/30 bg-teal-500/5">
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-teal-400">
              Discovered Transitions
            </CardTitle>
            <div className="flex items-center gap-2">
              {metrics.pending > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAcceptHighConfidence}
                    className="text-xs"
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Accept High Confidence
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleAcceptAll}
                    className="text-xs bg-teal-600 hover:bg-teal-700"
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Accept All ({metrics.pending})
                  </Button>
                </>
              )}
              {(acceptedIds.size > 0 || rejectedIds.size > 0) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="text-xs"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="space-y-1">
              <p className="text-2xl font-bold">{metrics.totalTransitions}</p>
              <p className="text-xs text-muted-foreground">Total Transitions</p>
            </div>
            <div className="space-y-1">
              <p className="text-2xl font-bold text-blue-500">
                {metrics.uniqueStates}
              </p>
              <p className="text-xs text-muted-foreground">Unique States</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-green-500">{metrics.high}</p>
                <Badge variant="default" className="bg-green-500 text-xs">
                  High
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">Confidence &gt;70%</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-yellow-500">{metrics.medium}</p>
                <Badge variant="secondary" className="text-xs">
                  Medium
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">Confidence 40-70%</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-red-500">{metrics.low}</p>
                <Badge variant="outline" className="text-xs">
                  Low
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">Confidence &lt;40%</p>
            </div>
          </div>

          {/* Progress indicators */}
          {(acceptedIds.size > 0 || rejectedIds.size > 0) && (
            <>
              <div className="my-4 border-t border-border" />
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-green-500">{metrics.accepted} accepted</span>
                </div>
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-red-500">{metrics.rejected} rejected</span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <span className="text-yellow-500">{metrics.pending} pending</span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* View Tabs */}
      <Tabs defaultValue="table" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="table" className="flex items-center gap-1">
            <Table2 className="h-4 w-4" />
            Table View
          </TabsTrigger>
          <TabsTrigger value="graph" className="flex items-center gap-1">
            <Network className="h-4 w-4" />
            Graph View
          </TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="mt-4">
          <TransitionTable
            transitions={suggestedTransitions}
            onAccept={handleAccept}
            onReject={handleReject}
            acceptedIds={acceptedIds}
            rejectedIds={rejectedIds}
          />
        </TabsContent>

        <TabsContent value="graph" className="mt-4">
          <TransitionGraph
            transitions={suggestedTransitions}
            discoveredStates={discoveredStates}
            onTransitionSelect={setSelectedTransition}
            acceptedIds={acceptedIds}
            rejectedIds={rejectedIds}
          />

          {/* Selected transition details */}
          {selectedTransition && (
            <Card className="mt-4">
              <CardHeader className="py-2">
                <CardTitle className="text-sm">Selected Transition</CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">From</p>
                    <p className="font-mono text-xs">
                      {selectedTransition.fromStateName || selectedTransition.fromStateHash}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">To</p>
                    <p className="font-mono text-xs">
                      {selectedTransition.toStateName || selectedTransition.toStateHash}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Trigger</p>
                    <p className="font-mono text-xs">{selectedTransition.triggerElementId}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Confidence</p>
                    <p>{(selectedTransition.confidence * 100).toFixed(0)}%</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  {!acceptedIds.has(selectedTransition.id) &&
                    !rejectedIds.has(selectedTransition.id) && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-500 border-green-500 hover:bg-green-500/10"
                          onClick={() => handleAccept(selectedTransition)}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-500 border-red-500 hover:bg-red-500/10"
                          onClick={() => handleReject(selectedTransition)}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                      </>
                    )}
                  {acceptedIds.has(selectedTransition.id) && (
                    <Badge variant="default" className="bg-green-500">
                      Accepted
                    </Badge>
                  )}
                  {rejectedIds.has(selectedTransition.id) && (
                    <Badge variant="destructive">Rejected</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
