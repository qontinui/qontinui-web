"use client"

import React from "react"

import { useState, useCallback, useRef, useEffect } from "react"
import { flushSync } from "react-dom"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Square, Trash2, Settings, ArrowRight, MapPin, Map, Type, Network } from "lucide-react"
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
import { TransitionNode } from "@/components/transition-node"
import { TransitionEdge } from "@/components/transition-edge"
import {
  useAutomation,
  type State,
  type StateRegion,
  type StateLocation,
  type StateString,
  type StateImage,
  type Pattern,
  type Transition,
  type OutgoingTransition,
  type IncomingTransition,
} from "@/contexts/automation-context"
import { StateUpdateCoordinator } from "@/contexts/automation-context/state-update-coordinator"
import { ImageSelector } from "@/components/image-selector"
import { OutgoingTransitionBuilder } from "@/components/outgoing-transition-builder"
import { IncomingTransitionBuilder } from "@/components/incoming-transition-builder"
import { StatePropertiesPanel } from "@/components/state-properties-panel"
import { TransitionPropertiesPanel } from "@/components/transition-properties-panel"
import { getLayoutedElements } from "@/lib/layout-utils"

const nodeTypes: NodeTypes = {
  stateNode: StateNode,
  transitionNode: TransitionNode,
}

const edgeTypes = {
  transitionEdge: TransitionEdge,
}

export function StateStructure() {
  const {
    states,
    addState,
    updateState,
    updateStateWithIdChange,
    deleteState,
    transitions,
    addTransition,
    updateTransition,
    deleteTransition,
    processes,
    images,
    updateImageUsage,
    removeImageUsage,
  } = useAutomation()

  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)

  // Track pending ID changes to prevent panel from disappearing
  const pendingIdChangeRef = useRef<{ oldId: string; newId: string } | null>(null)

  // Track counts to trigger auto-layout when items are added
  const prevCountsRef = useRef({ stateCount: 0, transitionCount: 0 })

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // Helper function to find an empty space for a new node
  const findEmptyPosition = useCallback(() => {
    const nodeWidth = 200
    const nodeHeight = 100
    const spacing = 50
    const gridCols = 5

    // Get all occupied positions
    const occupiedPositions = [
      ...states.map(s => s.position),
      ...transitions
        .filter((t): t is OutgoingTransition =>
          t.type === "OutgoingTransition" &&
          Array.isArray(t.activateStates) &&
          t.activateStates.length > 1
        )
        .map(t => t.position)
        .filter(Boolean)
    ]

    // Try to find an empty grid position
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < gridCols; col++) {
        const x = col * (nodeWidth + spacing) + 100
        const y = row * (nodeHeight + spacing) + 100

        // Check if this position overlaps with any existing node
        const isOccupied = occupiedPositions.some(pos =>
          pos &&
          Math.abs(pos.x - x) < nodeWidth &&
          Math.abs(pos.y - y) < nodeHeight
        )

        if (!isOccupied) {
          return { x, y }
        }
      }
    }

    // Fallback to random position if grid is full
    return {
      x: Math.random() * 400 + 100,
      y: Math.random() * 300 + 100
    }
  }, [states, transitions])

  // Handle node position changes
  const handleNodesChange = useCallback(
    (changes: any) => {
      // Call the original handler
      onNodesChange(changes)

      // Update positions when nodes are dragged
      changes.forEach((change: any) => {
        if (change.type === 'position' && change.position) {
          // Check if it's a state node
          const state = states.find(s => s.id === change.id)
          if (state) {
            updateState({
              ...state,
              position: change.position
            })
          } else if (change.id.startsWith('transition-node-')) {
            // It's a transition node, extract the transition ID
            const transitionId = change.id.replace('transition-node-', '')
            const transition = transitions.find(t => t.id === transitionId)
            if (transition) {
              updateTransition({
                ...transition,
                position: change.position
              })
            }
          }
        }
      })
    },
    [onNodesChange, states, updateState, transitions, updateTransition]
  )

  React.useEffect(() => {
    // Check which states have IncomingTransitions
    const statesWithIncomingTransitions = new Set(
      transitions
        .filter((t): t is IncomingTransition => t.type === "IncomingTransition")
        .map((t) => t.toState)
    )

    // Create state nodes
    const stateNodes: Node[] = states.map((state) => ({
      id: state.id,
      type: "stateNode",
      position: state.position,
      data: {
        state: { ...state }, // Spread to create new reference for React to detect changes
        images,
        hasIncomingTransitions: statesWithIncomingTransitions.has(state.id),
      },
    }))

    // Create transition nodes and edges
    const transitionNodes: Node[] = []
    const newEdges: Edge[] = []

    transitions
      .filter((t): t is OutgoingTransition => t.type === "OutgoingTransition")
      .forEach((transition) => {
        // Ensure activateStates is an array before accessing it
        const activateStates = Array.isArray(transition.activateStates) ? transition.activateStates : []
        const isMultiTarget = activateStates.length > 1
        const transitionNodeId = `transition-node-${transition.id}`
        const sourceState = states.find(s => s.id === transition.fromState)

        if (sourceState && activateStates.length > 0) {
          // Create a transition node for all transitions (both single and multi-target)
            // Use saved position or try to position below the source state
            let position = transition.position

            if (!position) {
              // Try to place it below the source state
              const proposedPosition = {
                x: sourceState.position.x,
                y: sourceState.position.y + 150
              }

              // Check if this position is occupied
              const isOccupied = [...states, ...transitions.filter(t => t.position)]
                .some(item => {
                  const pos = 'position' in item ? item.position : item.position
                  return pos &&
                    Math.abs(pos.x - proposedPosition.x) < 150 &&
                    Math.abs(pos.y - proposedPosition.y) < 80
                })

              if (!isOccupied) {
                position = proposedPosition
              } else {
                // Find an empty position
                position = {
                  x: sourceState.position.x + 200,
                  y: sourceState.position.y
                }
              }

              // Save the position for next time
              updateTransition({
                ...transition,
                position: position
              })
            }

            const transitionNode: Node = {
              id: transitionNodeId,
              type: "transitionNode",
              position: position,
              data: {
                transition,
                label: isMultiTarget ? `→ ${activateStates.length} states` : `→`,
                isSingleTarget: !isMultiTarget
              },
            }
            transitionNodes.push(transitionNode)

            // Create edge from source state to transition node
            newEdges.push({
              id: `${transition.id}-source`,
              source: transition.fromState,
              target: transitionNodeId,
              type: "transitionEdge",
              data: { transition, isMultiTarget: true },
              style: { stroke: "#BD00FF", strokeWidth: 2 },
            })

            // Create edges from transition node to each target state
            activateStates.forEach((targetState, index) => {
              newEdges.push({
                id: `${transition.id}-target-${index}`,
                source: transitionNodeId,
                target: targetState,
                type: "transitionEdge",
                data: { transition, isMultiTarget: isMultiTarget },
                style: {
                  stroke: "#00D9FF",
                  strokeWidth: 2,
                  strokeDasharray: "5 5"
                },
                animated: true
              })
            })
        }
      })

    const newNodes = [...stateNodes, ...transitionNodes]

    setNodes(newNodes)
    setEdges(newEdges)
  }, [states, transitions, images, setNodes, setEdges])

  const handleAddState = () => {
    const newState = StateUpdateCoordinator.createDefaultState(states, findEmptyPosition())
    addState(newState)
    // Auto-layout is handled by useEffect watching states.length
  }

  const handleDeleteState = (stateId: string) => {
    deleteState(stateId)
    if (selectedNode === stateId) setSelectedNode(null)
  }

  const applyAutoLayout = useCallback(() => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      {
        direction: 'TB',
        nodeWidth: 200,
        nodeHeight: 150,
        nodeSep: 80,
        rankSep: 120,
      }
    )

    // Update positions in the state
    layoutedNodes.forEach((node) => {
      const state = states.find(s => s.id === node.id)
      if (state) {
        updateState({
          ...state,
          position: node.position
        })
      } else if (node.id.startsWith('transition-node-')) {
        const transitionId = node.id.replace('transition-node-', '')
        const transition = transitions.find(t => t.id === transitionId)
        if (transition) {
          updateTransition({
            ...transition,
            position: node.position
          })
        }
      }
    })
  }, [nodes, edges, states, transitions, updateState, updateTransition])

  // Auto-layout when states or transitions are added
  React.useEffect(() => {
    const currentCounts = {
      stateCount: states.length,
      transitionCount: transitions.length
    }

    if (currentCounts.stateCount > prevCountsRef.current.stateCount ||
        currentCounts.transitionCount > prevCountsRef.current.transitionCount) {
      // Delay to ensure nodes/edges are rendered
      setTimeout(() => {
        applyAutoLayout()
      }, 150)
    }

    prevCountsRef.current = currentCounts
  }, [states.length, transitions.length, applyAutoLayout])

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return

      const newTransition: OutgoingTransition = {
        id: `transition-${Date.now()}`,
        type: "OutgoingTransition",
        fromState: params.source,
        activateStates: [params.target], // Target state is just the first in activateStates
        staysVisible: false,
        deactivateStates: [],
        process: "",
      }

      addTransition(newTransition)
    },
    [addTransition],
  )

  const updateSelectedState = (updates: Partial<State>) => {
    if (!selectedNode) return

    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    // Use coordinator to prepare the update
    const updateResult = StateUpdateCoordinator.prepareStateUpdate(
      currentState,
      updates,
      states,
      transitions
    )

    if (updateResult.idChanged && updateResult.oldId && updateResult.newId) {
      // Track the pending ID change
      pendingIdChangeRef.current = {
        oldId: updateResult.oldId,
        newId: updateResult.newId
      }

      // Update selectedNode to the new ID
      setSelectedNode(updateResult.newId)

      // Update the state with the new ID
      updateStateWithIdChange(updateResult.oldId, updateResult.updatedState)

      // Update all affected transitions (can be async)
      const updatedTransitions = StateUpdateCoordinator.calculateUpdatedTransitions(
        transitions,
        updateResult.oldId,
        updateResult.newId
      )

      // Apply transition updates
      updatedTransitions.forEach(transition => {
        const originalTransition = transitions.find(t => t.id === transition.id)
        if (originalTransition && JSON.stringify(originalTransition) !== JSON.stringify(transition)) {
          updateTransition(transition)
        }
      })

      return
    }

    // Simple update without ID change
    updateState(updateResult.updatedState)
  }

  const updateSelectedTransition = (updates: Partial<Transition>) => {
    if (!selectedEdge) return

    // Extract the transition ID from the edge ID (remove the "-index" suffix)
    const currentTransition = transitions.find((t) => selectedEdge.startsWith(t.id))
    if (!currentTransition) return

    const updatedTransition = { ...currentTransition, ...updates }
    updateTransition(updatedTransition)
  }

  // StateImage management
  const addStateImage = () => {
    if (!selectedNode) return

    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    // Create a default pattern for the new StateImage
    const newPattern: Pattern = {
      id: `pattern_${Date.now()}`,
      image: "",
      searchRegions: [],
      fixed: false
    }

    const newStateImage: StateImage = {
      id: `stateimage-${Date.now()}`,
      name: `StateImage_${(currentState.stateImages?.length || 0) + 1}`,
      patterns: [newPattern],
      shared: false,
      source: 'upload', // Mark this as an uploaded image
      probability: 1.0 // Default: always appears in mock tests
    }
    const updatedStateImages = [...(currentState.stateImages || []), newStateImage]
    updateSelectedState({ stateImages: updatedStateImages })
  }

  const updateStateImage = (index: number, updates: Partial<StateImage>) => {
    if (!selectedNode) return

    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState || !currentState.stateImages) return

    const updatedStateImages = [...currentState.stateImages]
    updatedStateImages[index] = { ...updatedStateImages[index], ...updates }
    updateSelectedState({ stateImages: updatedStateImages })
  }

  const removeStateImage = (index: number) => {
    if (!selectedNode) return

    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState || !currentState.stateImages) return

    const updatedStateImages = currentState.stateImages.filter((_, i) => i !== index)
    updateSelectedState({ stateImages: updatedStateImages })
  }

  // Region management
  const addRegion = () => {
    if (!selectedNode) return
    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    const regions = currentState.regions || []
    const newRegion: StateRegion = {
      id: `region-${Date.now()}`,
      name: `Region ${regions.length + 1}`,
      x: 0,
      y: 0,
      width: 100,
      height: 100
    }
    updateSelectedState({ regions: [...regions, newRegion] })
  }

  const updateRegion = (index: number, field: keyof StateRegion, value: any) => {
    if (!selectedNode) return
    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    const regions = currentState.regions || []
    const updatedRegions = [...regions]
    updatedRegions[index] = { ...updatedRegions[index], [field]: value }
    updateSelectedState({ regions: updatedRegions })
  }

  const removeRegion = (index: number) => {
    if (!selectedNode) return
    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    const regions = currentState.regions || []
    const updatedRegions = regions.filter((_, i) => i !== index)
    updateSelectedState({ regions: updatedRegions })
  }

  // Location management
  const addLocation = () => {
    if (!selectedNode) return
    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    const locations = currentState.locations || []
    const newLocation: StateLocation = {
      id: `location-${Date.now()}`,
      name: `Location ${locations.length + 1}`,
      x: 0,
      y: 0,
      fixed: true,         // Default to absolute positioning
      anchor: false,       // Not an anchor by default
      offsetX: 0,
      offsetY: 0
    }
    updateSelectedState({ locations: [...locations, newLocation] })
  }

  const updateLocation = (index: number, field: keyof StateLocation, value: any) => {
    if (!selectedNode) return
    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    const locations = currentState.locations || []
    const updatedLocations = [...locations]
    updatedLocations[index] = { ...updatedLocations[index], [field]: value }
    updateSelectedState({ locations: updatedLocations })
  }

  const removeLocation = (index: number) => {
    if (!selectedNode) return
    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    const locations = currentState.locations || []
    const updatedLocations = locations.filter((_, i) => i !== index)
    updateSelectedState({ locations: updatedLocations })
  }

  // String management
  const addString = () => {
    if (!selectedNode) return
    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    const strings = currentState.strings || []
    const newString: StateString = {
      id: `string-${Date.now()}`,
      name: `String ${strings.length + 1}`,
      value: "",
      inputText: true  // DEFAULT: Input Text is checked
    }
    updateSelectedState({ strings: [...strings, newString] })
  }

  const updateString = (index: number, field: keyof StateString, value: any) => {
    if (!selectedNode) return
    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    const strings = currentState.strings || []
    const updatedStrings = [...strings]
    updatedStrings[index] = { ...updatedStrings[index], [field]: value }
    updateSelectedState({ strings: updatedStrings })
  }

  const removeString = (index: number) => {
    if (!selectedNode) return
    const currentState = states.find((s) => s.id === selectedNode)
    if (!currentState) return

    const strings = currentState.strings || []
    const updatedStrings = strings.filter((_, i) => i !== index)
    updateSelectedState({ strings: updatedStrings })
  }

  // Find selected state - use a fallback strategy to handle ID changes during typing
  const selectedState = React.useMemo(() => {
    if (!selectedNode) return null

    // First try to find by exact ID match
    const exactMatch = states.find((s) => s.id === selectedNode)
    if (exactMatch) {
      // Clear pending ID change if we found the state
      pendingIdChangeRef.current = null
      return exactMatch
    }

    // If not found and we have a pending ID change, look for the old ID
    if (pendingIdChangeRef.current) {
      const { oldId, newId } = pendingIdChangeRef.current

      // If selectedNode matches the newId but we can't find it yet,
      // try to find the oldId temporarily
      if (selectedNode === newId) {
        const oldState = states.find((s) => s.id === oldId)
        if (oldState) {
          return oldState
        }
      }
    }

    return null
  }, [selectedNode, states])

  // Extract the transition ID from the edge ID or direct transition ID
  const selectedTransition = selectedEdge
    ? transitions.find((t) => {
        // Handle direct transition IDs (from clicking transition nodes)
        if (t.id === selectedEdge) return true
        // Handle edge IDs with suffixes
        return selectedEdge.startsWith(t.id + '-')
      })
    : null

  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <div className="w-80 border-r border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
        <div className="space-y-4">
          <Button onClick={handleAddState} className="w-full bg-[#BD00FF] hover:bg-[#BD00FF]/80 text-white">
            <Plus className="w-4 h-4 mr-2" />
            Add State
          </Button>

          <Button onClick={applyAutoLayout} className="w-full bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black">
            <Network className="w-4 h-4 mr-2" />
            Auto Layout
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
                    className={`flex items-center gap-2 p-2 rounded transition-colors cursor-pointer ${
                      selectedNode === state.id
                        ? "bg-[#BD00FF]/20 border border-[#BD00FF]"
                        : "hover:bg-gray-700"
                    }`}
                    onClick={() => {
                      setSelectedNode(state.id)
                      setSelectedEdge(null)
                    }}
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

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Transitions</h3>
            <OutgoingTransitionBuilder />
            <IncomingTransitionBuilder />
          </div>
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
              if (node.type === 'transitionNode') {
                // For transition nodes, select the transition instead of the node
                const transitionId = node.id.replace('transition-node-', '')
                setSelectedEdge(transitionId)
                setSelectedNode(null)
              } else {
                setSelectedNode(node.id)
                setSelectedEdge(null)
              }
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
          <StatePropertiesPanel
            state={selectedState}
            allStates={states}
            images={images}
            updateState={updateSelectedState}
            addStateImage={addStateImage}
            updateStateImage={updateStateImage}
            removeStateImage={removeStateImage}
            addRegion={addRegion}
            updateRegion={updateRegion}
            removeRegion={removeRegion}
            addLocation={addLocation}
            updateLocation={updateLocation}
            removeLocation={removeLocation}
            addString={addString}
            updateString={updateString}
            removeString={removeString}
          />
        ) : selectedTransition ? (
          <TransitionPropertiesPanel
            transition={selectedTransition}
            states={states}
            processes={processes}
            updateTransition={updateSelectedTransition}
            deleteTransition={(transitionId) => {
              deleteTransition(transitionId)
              setSelectedEdge(null)
            }}
          />
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
