"use client"

import { type EdgeProps, getBezierPath, EdgeLabelRenderer } from "@xyflow/react"
import { Badge } from "@/components/ui/badge"

interface TransitionEdgeData {
  transition: {
    id: string
    fromStates: string[]
    toStates: string[]
    processes: string[]
    staysVisible: boolean
  }
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

  const { transition } = data || { transition: { processes: [], staysVisible: false } }

  return (
    <>
      <path
        id={id}
        style={{
          stroke: selected ? "#00D9FF" : "#BD00FF",
          strokeWidth: selected ? 3 : 2,
          fill: "none",
        }}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd="url(#react-flow__arrowclosed)"
      />

      {transition.processes.length > 0 && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 10,
              pointerEvents: "all",
            }}
            className="nodrag nopan"
          >
            <Badge className="bg-[#BD00FF] text-white text-xs px-2 py-1">
              {transition.processes.length} process{transition.processes.length !== 1 ? "es" : ""}
            </Badge>
          </div>
        </EdgeLabelRenderer>
      )}

      {transition.staysVisible && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${sourceX}px,${sourceY - 20}px)`,
              fontSize: 10,
              pointerEvents: "all",
            }}
            className="nodrag nopan"
          >
            <Badge className="bg-[#00FF88] text-black text-xs px-2 py-1">Stays Visible</Badge>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
