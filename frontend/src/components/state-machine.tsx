"use client"

import React from "react"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Square, Trash2, Settings, ArrowRight } from "lucide-react"
import {
  ReactFlow,
  type Node,
  type Edge,
  type Connection,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  type NodeTypes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { StateNode } from "@/components/state-node"
import { TransitionEdge } from "@/components/transition-edge"
import { useAutomation } from "@/contexts/automation-context"
import { ImageSelector } from "@/components/image-selector"
import { TransitionBuilder } from "@/components/transition-builder"

interface State {
  id: string
  name: string
  description: string
  initial?: boolean  // Whether this state is expected to be active at start
  identifyingImages: Array<{ image: string; threshold: number }>
  position: { x: number; y: number }
}

// Import transition types from context
type TransitionType = "OutgoingTransition" | "IncomingTransition"

interface BaseTransition {
  id: string
  type: TransitionType
  processes: string[]
  timeout: number
  retryCount: number
}

interface OutgoingTransition extends BaseTransition {
  type: "OutgoingTransition"
  fromState: string
  toState: string
  staysVisible: boolean
  activateStates: string[]
  deactivateStates: string[]
}

interface IncomingTransition extends BaseTransition {
  type: "IncomingTransition"
  toState: string
}

type Transition = OutgoingTransition | IncomingTransition

const nodeTypes: NodeTypes = {
  stateNode: StateNode,
}

const edgeTypes = {
  transitionEdge: TransitionEdge,
}

export function StateMachine() {
  const {
    states,
    addState,
    updateState,
    deleteState,
    transitions,
    addTransition,
    updateTransition,
    processes,
    images,
    updateImageUsage,
    removeImageUsage,
  } = useAutomation()

  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // Handle node position changes
  const handleNodesChange = useCallback(
    (changes: any) => {
      // Call the original handler
      onNodesChange(changes)
      
      // Update state positions when nodes are dragged
      changes.forEach((change: any) => {
        if (change.type === 'position' && change.position) {
          const state = states.find(s => s.id === change.id)
          if (state) {
            updateState({
              ...state,
              position: change.position
            })
          }
        }
      })
    },
    [onNodesChange, states, updateState]
  )

  React.useEffect(() => {
    // Check which states have IncomingTransitions
    const statesWithIncomingTransitions = new Set(
      transitions
        .filter((t): t is IncomingTransition => t.type === "IncomingTransition")
        .map((t) => t.toState)
    )

    const newNodes: Node[] = states.map((state) => ({
      id: state.id,
      type: "stateNode",
      position: state.position,
      data: {
        state,
        images,
        hasIncomingTransitions: statesWithIncomingTransitions.has(state.id),
      },
    }))

    const newEdges: Edge[] = transitions
      .filter((t): t is OutgoingTransition => t.type === "OutgoingTransition")
      .map((transition) => ({
        id: transition.id,
        source: transition.fromState,
        target: transition.toState,
        type: "transitionEdge",
        data: { transition },
        style: { stroke: "#BD00FF", strokeWidth: 2 },
      }))

    setNodes(newNodes)
    setEdges(newEdges)
  }, [states, transitions, images, setNodes, setEdges])

  const handleAddState = () => {
    const newState: State = {
      id: `state-${Date.now()}`,
      name: "New State",
      description: "",
      identifyingImages: [],
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
    }

    addState(newState)
  }

  const handleDeleteState = (stateId: string) => {
    deleteState(stateId)
    if (selectedNode === stateId) setSelectedNode(null)
  }


  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return

      const newTransition: OutgoingTransition = {
        id: `transition-${Date.now()}`,
        type: "OutgoingTransition",
        fromState: params.source,
        toState: params.target,
        staysVisible: false,
        activateStates: [],
        deactivateStates: [],
        processes: [],
        timeout: 5000,
        retryCount: 3,
      }

      addTransition(newTransition)
    },
    [addTransition],
  )

  const updateSelectedState = (updates: Partial<State>) => {
    if (!selectedNode) return

    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    const updatedState = { ...currentState, ...updates }
    updateState(updatedState)
  }

  const updateSelectedTransition = (updates: Partial<Transition>) => {
    if (!selectedEdge) return

    const currentTransition = transitions.find((t) => t.id === selectedEdge)
    if (!currentTransition) return

    const updatedTransition = { ...currentTransition, ...updates }
    updateTransition(updatedTransition)
  }

  const addIdentifyingImage = () => {
    if (!selectedNode) return

    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    const updatedImages = [...currentState.identifyingImages, { image: "", threshold: 0.8 }]
    updateSelectedState({ identifyingImages: updatedImages })
  }

  const updateIdentifyingImage = (index: number, field: "image" | "threshold", value: any) => {
    if (!selectedNode) return

    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    const updatedImages = [...currentState.identifyingImages]

    // Handle image usage tracking
    if (field === "image") {
      const oldImage = updatedImages[index].image
      if (oldImage) {
        removeImageUsage(oldImage, selectedNode)
      }
      if (value) {
        updateImageUsage(value, { type: "state", id: selectedNode, name: currentState.name })
      }
    }

    updatedImages[index] = { ...updatedImages[index], [field]: value }
    updateSelectedState({ identifyingImages: updatedImages })
  }

  const removeIdentifyingImage = (index: number) => {
    if (!selectedNode) return

    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    const imageToRemove = currentState.identifyingImages[index]
    if (imageToRemove.image) {
      removeImageUsage(imageToRemove.image, selectedNode)
    }

    const updatedImages = currentState.identifyingImages.filter((_, i) => i !== index)
    updateSelectedState({ identifyingImages: updatedImages })
  }

  const selectedState = selectedNode ? states.find((s) => s.id === selectedNode) : null
  const selectedTransition = selectedEdge ? transitions.find((t) => t.id === selectedEdge) : null

  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <div className="w-80 border-r border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
        <div className="space-y-4">
          <Button onClick={handleAddState} className="w-full bg-[#BD00FF] hover:bg-[#BD00FF]/80 text-white">
            <Plus className="w-4 h-4 mr-2" />
            Add State
          </Button>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide">States</h3>
            {states.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Square className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No states yet</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {states.map((state) => (
                  <div
                    key={state.id}
                    className="flex items-center gap-2 p-2 rounded transition-colors hover:bg-gray-700"
                  >
                    <span className="text-sm flex-1 truncate">{state.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-gray-400 hover:text-red-400"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteState(state.id)
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <TransitionBuilder />
        </div>
      </div>

      {/* Main Canvas */}
      <div className="flex-1 relative bg-[#0A0A0B] min-h-0">
        <div className="absolute inset-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, node) => {
              setSelectedNode(node.id)
              setSelectedEdge(null)
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdge(edge.id)
              setSelectedNode(null)
            }}
            onPaneClick={() => {
              setSelectedNode(null)
              setSelectedEdge(null)
            }}
            fitView
            className="bg-[#0A0A0B]"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
            <Controls className="bg-[#27272A] border-gray-700 [&>button]:bg-[#27272A] [&>button]:border-gray-700 [&>button]:text-white [&>button:hover]:bg-gray-600" />
          </ReactFlow>
        </div>
      </div>

      {/* Right Panel */}
      <div className="w-96 border-l border-gray-800 bg-[#27272A]/50 overflow-y-auto p-4">
        {selectedState ? (
          <Card className="border-gray-700 bg-[#27272A] h-full flex flex-col">
            <CardHeader className="pb-3 flex-shrink-0">
              <CardTitle className="text-sm font-medium text-[#00D9FF]">State Properties</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-4 overflow-hidden p-6">
              <div className="space-y-2 flex-shrink-0">
                <Label className="text-xs text-gray-400">State Name</Label>
                <Input
                  value={selectedState.name}
                  onChange={(e) => updateSelectedState({ name: e.target.value })}
                  className="bg-transparent border-gray-700"
                />
              </div>

              <div className="space-y-2 flex-shrink-0">
                <Label className="text-xs text-gray-400">Description</Label>
                <Textarea
                  value={selectedState.description}
                  onChange={(e) => updateSelectedState({ description: e.target.value })}
                  className="bg-transparent border-gray-700"
                  rows={3}
                />
              </div>

              <div className="flex items-center space-x-2 flex-shrink-0">
                <Checkbox
                  id="initial-state"
                  checked={selectedState.initial || false}
                  onCheckedChange={(checked) => updateSelectedState({ initial: checked as boolean })}
                  className="border-gray-600 data-[state=checked]:bg-[#00D9FF] data-[state=checked]:border-[#00D9FF]"
                />
                <Label
                  htmlFor="initial-state"
                  className="text-xs text-gray-400 cursor-pointer"
                >
                  Initial State (Expected to be active at automation start)
                </Label>
              </div>

              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs text-gray-400">Identifying Images</Label>
                  <Button variant="ghost" size="sm" onClick={addIdentifyingImage}>
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>

                {selectedState.identifyingImages.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center border border-dashed border-gray-600 rounded">
                    <p className="text-sm text-gray-500">No images configured</p>
                  </div>
                ) : (
                  <div className="flex-1 space-y-2 overflow-y-auto pr-2">
                    {selectedState.identifyingImages.map((imgConfig, index) => (
                      <div key={index} className="space-y-2 p-2 bg-gray-800 rounded">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <ImageSelector
                              selectedImage={imgConfig.image || null}
                              onSelectImage={(imageId) => updateIdentifyingImage(index, "image", imageId)}
                              images={images}
                              placeholder="Select image"
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                            onClick={() => removeIdentifyingImage(index)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <Label className="text-gray-400">Match Threshold:</Label>
                          <Input
                            type="number"
                            min="0.1"
                            max="1.0"
                            step="0.1"
                            value={imgConfig.threshold}
                            onChange={(e) =>
                              updateIdentifyingImage(index, "threshold", Number.parseFloat(e.target.value))
                            }
                            className="w-20 h-7 bg-transparent border-gray-700 text-xs"
                          />
                          <span className="text-gray-500">({(imgConfig.threshold * 100).toFixed(0)}%)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ) : selectedTransition ? (
          <Card className="border-gray-700 bg-[#27272A] h-full flex flex-col">
            <CardHeader className="pb-3 flex-shrink-0">
              <CardTitle className="text-sm font-medium text-[#BD00FF]">Transition Properties</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 space-y-4 overflow-y-auto p-6">
              <div className="space-y-2">
                <Label className="text-xs text-gray-400">Type</Label>
                <div className="p-2 bg-gray-800 rounded text-sm">
                  {selectedTransition.type === "OutgoingTransition" ? (
                    <span className="text-[#BD00FF]">OutgoingTransition</span>
                  ) : (
                    <span className="text-[#00FF88]">IncomingTransition</span>
                  )}
                </div>
              </div>

              {selectedTransition.type === "OutgoingTransition" ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-400">From State</Label>
                    <div className="p-2 bg-gray-800 rounded text-sm">
                      {states.find((s) => s.id === selectedTransition.fromState)?.name || "Unknown State"}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-gray-400">To State</Label>
                    <div className="p-2 bg-gray-800 rounded text-sm">
                      {states.find((s) => s.id === selectedTransition.toState)?.name || "Unknown State"}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="stays_visible"
                      checked={selectedTransition.staysVisible}
                      onCheckedChange={(checked) => updateSelectedTransition({ staysVisible: !!checked })}
                    />
                    <Label htmlFor="stays_visible" className="text-xs text-gray-400">
                      Origin stays visible
                    </Label>
                  </div>

                  {selectedTransition.activateStates.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-400">Activate States</Label>
                      <div className="p-2 bg-gray-800 rounded text-sm space-y-1">
                        {selectedTransition.activateStates.map((stateId) => (
                          <div key={stateId}>
                            {states.find((s) => s.id === stateId)?.name || "Unknown State"}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedTransition.deactivateStates.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-400">Deactivate States</Label>
                      <div className="p-2 bg-gray-800 rounded text-sm space-y-1">
                        {selectedTransition.deactivateStates.map((stateId) => (
                          <div key={stateId}>
                            {states.find((s) => s.id === stateId)?.name || "Unknown State"}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">State (executes when entering)</Label>
                  <div className="p-2 bg-gray-800 rounded text-sm">
                    {states.find((s) => s.id === selectedTransition.toState)?.name || "Unknown State"}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-gray-400">Processes</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // Toggle all processes selection UI
                      const allSelected = selectedTransition.processes.length === processes.length
                      updateSelectedTransition({ 
                        processes: allSelected ? [] : processes.map(p => p.id)
                      })
                    }}
                    className="text-xs"
                  >
                    {selectedTransition.processes.length === processes.length ? 'Clear All' : 'Select All'}
                  </Button>
                </div>
                {processes.length === 0 ? (
                  <div className="text-center py-4 text-gray-500 border border-dashed border-gray-600 rounded">
                    <p className="text-sm">No processes available</p>
                    <p className="text-xs mt-1">Create processes in the Process Builder tab</p>
                  </div>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {processes.map((process) => {
                      const isSelected = selectedTransition.processes.includes(process.id)
                      return (
                        <div
                          key={process.id}
                          className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-[#BD00FF]/20 border border-[#BD00FF]"
                              : "bg-gray-800 border border-gray-700 hover:border-gray-600"
                          }`}
                          onClick={() => {
                            const newProcesses = isSelected
                              ? selectedTransition.processes.filter(id => id !== process.id)
                              : [...selectedTransition.processes, process.id]
                            updateSelectedTransition({ processes: newProcesses })
                          }}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => {}}
                            className="pointer-events-none"
                          />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{process.name}</p>
                            {process.description && (
                              <p className="text-xs text-gray-400">{process.description}</p>
                            )}
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            {process.actions.length} actions
                          </Badge>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-gray-400">Success Timeout (ms)</Label>
                <Input
                  type="number"
                  value={selectedTransition.timeout}
                  onChange={(e) => updateSelectedTransition({ timeout: Number.parseInt(e.target.value) })}
                  className="bg-transparent border-gray-700"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-gray-400">Retry Count</Label>
                <Input
                  type="number"
                  value={selectedTransition.retryCount}
                  onChange={(e) => updateSelectedTransition({ retryCount: Number.parseInt(e.target.value) })}
                  className="bg-transparent border-gray-700"
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <Settings className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Select a state or transition</p>
              <p className="text-sm">to configure properties</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
