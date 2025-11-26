'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  Check,
  X,
  AlertCircle,
  Download,
  Save,
  Eye,
  Trash2,
  CheckSquare,
  Square,
} from 'lucide-react';
import { recordingService } from '@/services/service-factory';
import { getConfidenceLevel, getConfidenceColor } from '@/types/recording';
import type {
  DiscoveredStateStructure,
  DiscoveredState,
  DiscoveredTransition,
  AcceptanceRequest,
} from '@/types/recording';

interface StateStructureReviewProps {
  recordingId: string;
}

export function StateStructureReview({ recordingId }: StateStructureReviewProps) {
  const router = useRouter();

  const [structure, setStructure] = useState<DiscoveredStateStructure | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedStateIds, setSelectedStateIds] = useState<Set<string>>(new Set());
  const [selectedTransitionIds, setSelectedTransitionIds] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<DiscoveredState | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<DiscoveredTransition | null>(null);
  const [accepting, setAccepting] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Load state structure
  useEffect(() => {
    loadStateStructure();
  }, [recordingId]);

  const loadStateStructure = async () => {
    try {
      setLoading(true);
      const data = await recordingService.getStateStructure(recordingId);
      setStructure(data);

      // Convert to React Flow format
      const flowNodes = createFlowNodes(data.states);
      const flowEdges = createFlowEdges(data.transitions, data.states);

      setNodes(flowNodes);
      setEdges(flowEdges);

      // Select all by default
      setSelectedStateIds(new Set(data.states.map(s => s.id)));
      setSelectedTransitionIds(new Set(data.transitions.map(t => t.id)));
    } catch (error: any) {
      console.error('Failed to load state structure:', error);
      toast.error('Failed to load state structure');
    } finally {
      setLoading(false);
    }
  };

  const createFlowNodes = (states: DiscoveredState[]): Node[] => {
    return states.map((state, index) => {
      const confidenceLevel = getConfidenceLevel(state.confidence);
      const isApproved = state.user_approved;

      return {
        id: state.id,
        type: 'default',
        position: state.position_x && state.position_y
          ? { x: state.position_x, y: state.position_y }
          : { x: (index % 5) * 250, y: Math.floor(index / 5) * 150 },
        data: {
          label: (
            <div className="flex flex-col items-center p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">{state.name}</span>
                {isApproved && <Check className="h-4 w-4 text-green-600" />}
              </div>
              <div className="flex gap-1">
                <Badge
                  variant="outline"
                  className={`text-xs ${getConfidenceColor(confidenceLevel)}`}
                >
                  {Math.round((state.confidence || 0) * 100)}%
                </Badge>
                {state.is_initial && (
                  <Badge variant="outline" className="text-xs">
                    Initial
                  </Badge>
                )}
                {state.is_error_state && (
                  <Badge variant="outline" className="text-xs text-red-600">
                    Error
                  </Badge>
                )}
              </div>
            </div>
          ),
        },
        style: {
          background: selectedStateIds.has(state.id) ? '#e0f2fe' : 'white',
          border: `2px solid ${
            isApproved
              ? '#10b981'
              : confidenceLevel === 'high'
              ? '#3b82f6'
              : confidenceLevel === 'medium'
              ? '#f59e0b'
              : '#ef4444'
          }`,
          borderRadius: '8px',
          padding: '10px',
        },
      };
    });
  };

  const createFlowEdges = (
    transitions: DiscoveredTransition[],
    states: DiscoveredState[]
  ): Edge[] => {
    return transitions
      .filter(t => t.to_state_id) // Only show transitions with target
      .map((transition) => {
        const confidenceLevel = getConfidenceLevel(transition.confidence);
        const isApproved = transition.user_approved;

        return {
          id: transition.id,
          source: transition.from_state_id,
          target: transition.to_state_id!,
          type: 'default',
          animated: selectedTransitionIds.has(transition.id),
          style: {
            stroke: isApproved
              ? '#10b981'
              : confidenceLevel === 'high'
              ? '#3b82f6'
              : confidenceLevel === 'medium'
              ? '#f59e0b'
              : '#ef4444',
            strokeWidth: selectedTransitionIds.has(transition.id) ? 2 : 1,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isApproved
              ? '#10b981'
              : confidenceLevel === 'high'
              ? '#3b82f6'
              : confidenceLevel === 'medium'
              ? '#f59e0b'
              : '#ef4444',
          },
          label: transition.trigger_type,
          labelStyle: { fontSize: 10, fill: '#666' },
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: 'white', fillOpacity: 0.8 },
        };
      });
  };

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const state = structure?.states.find((s) => s.id === node.id);
      if (state) {
        setSelectedNode(state);
        setSelectedEdge(null);
      }
    },
    [structure]
  );

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const transition = structure?.transitions.find((t) => t.id === edge.id);
      if (transition) {
        setSelectedEdge(transition);
        setSelectedNode(null);
      }
    },
    [structure]
  );

  const toggleStateSelection = (stateId: string) => {
    setSelectedStateIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(stateId)) {
        newSet.delete(stateId);
      } else {
        newSet.add(stateId);
      }
      return newSet;
    });
  };

  const toggleTransitionSelection = (transitionId: string) => {
    setSelectedTransitionIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(transitionId)) {
        newSet.delete(transitionId);
      } else {
        newSet.add(transitionId);
      }
      return newSet;
    });
  };

  const handleAcceptSelected = async () => {
    if (selectedStateIds.size === 0) {
      toast.error('Please select at least one state to accept');
      return;
    }

    setAccepting(true);

    try {
      const request: AcceptanceRequest = {
        action: 'accept_selected',
        selected_state_ids: Array.from(selectedStateIds),
        selected_transition_ids: Array.from(selectedTransitionIds),
      };

      const response = await recordingService.acceptStateStructure(recordingId, request);

      toast.success(
        `Created ${response.created_states.length} states and ${response.created_transitions.length} transitions`
      );

      // Redirect to project after 2 seconds
      setTimeout(() => {
        const projectId = structure?.states[0]?.recording_id; // Simplified - would need project mapping
        router.push(`/dashboard`);
      }, 2000);
    } catch (error: any) {
      console.error('Failed to accept structure:', error);
      toast.error(error.message || 'Failed to accept structure');
    } finally {
      setAccepting(false);
    }
  };

  const handleAcceptAll = async () => {
    setAccepting(true);

    try {
      const request: AcceptanceRequest = {
        action: 'accept',
      };

      const response = await recordingService.acceptStateStructure(recordingId, request);

      toast.success(
        `Created ${response.created_states.length} states and ${response.created_transitions.length} transitions`
      );

      setTimeout(() => {
        router.push(`/dashboard`);
      }, 2000);
    } catch (error: any) {
      console.error('Failed to accept structure:', error);
      toast.error(error.message || 'Failed to accept structure');
    } finally {
      setAccepting(false);
    }
  };

  const handleDiscard = async () => {
    if (!confirm('Are you sure you want to discard this state structure?')) {
      return;
    }

    try {
      const request: AcceptanceRequest = {
        action: 'discard',
      };

      await recordingService.acceptStateStructure(recordingId, request);
      toast.success('State structure discarded');
      router.push('/recordings');
    } catch (error: any) {
      console.error('Failed to discard structure:', error);
      toast.error('Failed to discard structure');
    }
  };

  if (loading || !structure) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="h-8 w-8 animate-spin border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading state structure...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4">
      {/* Canvas */}
      <div className="flex-1 border rounded-lg overflow-hidden bg-white">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          fitView
        >
          <Background />
          <Controls />
          <Panel position="top-left" className="bg-white p-4 rounded-lg shadow-lg">
            <div className="space-y-2">
              <h3 className="font-semibold">Legend</h3>
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 border-2 border-blue-500 rounded" />
                <span>High Confidence</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 border-2 border-yellow-500 rounded" />
                <span>Medium Confidence</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 border-2 border-red-500 rounded" />
                <span>Low Confidence</span>
              </div>
            </div>
          </Panel>
          <Panel position="top-right" className="space-x-2">
            <Button onClick={handleAcceptAll} disabled={accepting} size="sm">
              <Check className="mr-2 h-4 w-4" />
              Accept All
            </Button>
            <Button
              onClick={handleAcceptSelected}
              disabled={accepting || selectedStateIds.size === 0}
              variant="outline"
              size="sm"
            >
              <CheckSquare className="mr-2 h-4 w-4" />
              Accept Selected ({selectedStateIds.size})
            </Button>
            <Button onClick={handleDiscard} variant="destructive" size="sm">
              <Trash2 className="mr-2 h-4 w-4" />
              Discard
            </Button>
          </Panel>
        </ReactFlow>
      </div>

      {/* Details Panel */}
      <div className="w-full lg:w-96 space-y-4">
        {/* Stats Card */}
        <Card>
          <CardHeader>
            <CardTitle>Structure Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Total States</p>
                <p className="text-2xl font-bold">{structure.stats.total_states}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Transitions</p>
                <p className="text-2xl font-bold">{structure.stats.total_transitions}</p>
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">High Confidence</span>
                <Badge variant="outline" className="text-green-600">
                  {structure.stats.high_confidence_states}
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Medium Confidence</span>
                <Badge variant="outline" className="text-yellow-600">
                  {structure.stats.medium_confidence_states}
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Low Confidence</span>
                <Badge variant="outline" className="text-red-600">
                  {structure.stats.low_confidence_states}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Selected Item Details */}
        {selectedNode && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>State: {selectedNode.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleStateSelection(selectedNode.id)}
                >
                  {selectedStateIds.has(selectedNode.id) ? (
                    <CheckSquare className="h-4 w-4" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedNode.description && (
                <p className="text-sm text-muted-foreground">{selectedNode.description}</p>
              )}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Confidence</span>
                  <Badge className={getConfidenceColor(getConfidenceLevel(selectedNode.confidence))}>
                    {Math.round((selectedNode.confidence || 0) * 100)}%
                  </Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Frames</span>
                  <span>{selectedNode.frame_count}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Images</span>
                  <span>{selectedNode.state_images.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Regions</span>
                  <span>{selectedNode.regions.length}</span>
                </div>
              </div>
              {selectedNode.is_initial && (
                <Badge variant="outline">Initial State</Badge>
              )}
              {selectedNode.is_error_state && (
                <Badge variant="outline" className="text-red-600">
                  Error State
                </Badge>
              )}
            </CardContent>
          </Card>
        )}

        {selectedEdge && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Transition</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleTransitionSelection(selectedEdge.id)}
                >
                  {selectedTransitionIds.has(selectedEdge.id) ? (
                    <CheckSquare className="h-4 w-4" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedEdge.trigger_description && (
                <p className="text-sm text-muted-foreground">
                  {selectedEdge.trigger_description}
                </p>
              )}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Trigger</span>
                  <Badge variant="outline">{selectedEdge.trigger_type || 'Unknown'}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Confidence</span>
                  <Badge className={getConfidenceColor(getConfidenceLevel(selectedEdge.confidence))}>
                    {Math.round((selectedEdge.confidence || 0) * 100)}%
                  </Badge>
                </div>
                {selectedEdge.latency_ms && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Latency</span>
                    <span>{selectedEdge.latency_ms}ms</span>
                  </div>
                )}
                {selectedEdge.workflow_name && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Workflow</span>
                    <span>{selectedEdge.workflow_name}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
