"use client"

import { type EdgeProps, getBezierPath, EdgeLabelRenderer } from "@xyflow/react"
import { Badge } from "@/components/ui/badge"

interface TransitionEdgeData {
  transition: {
    id: string
    fromState: string
    activateStates: string[]
    deactivateStates: string[]
    process: string
    staysVisible: boolean
  }
  isMultiTarget?: boolean
  targetIndex?: number
  totalTargets?: number
}

export function TransitionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<TransitionEdgeData>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const { transition, isMultiTarget, targetIndex, totalTargets } = data || {
    transition: { process: "", staysVisible: false },
    isMultiTarget: false,
    targetIndex: 0,
    totalTargets: 1
  }

  return (
    <>
      {/* Invisible wider path for easier clicking */}
      <path
        style={{
          stroke: "transparent",
          strokeWidth: 20,
          fill: "none",
          pointerEvents: "stroke",
          cursor: "pointer",
        }}
        d={edgePath}
      />
      <path
        id={id}
        style={{
          stroke: selected ? "#00D9FF" : "#BD00FF",
          strokeWidth: selected ? 3 : 2,
          fill: "none",
          pointerEvents: "stroke",
          cursor: "pointer",
        }}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd="url(#react-flow__arrowclosed)"
      />

      {/* Don't show any badges on edges since we're using transition nodes for all transitions */}
    </>
  )
}
