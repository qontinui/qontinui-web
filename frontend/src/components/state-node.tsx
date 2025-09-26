"use client"

import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ImageIcon, Target, Play } from "lucide-react"

interface ImageAsset {
  id: string
  name: string
  url: string
  size: number
  uploadedAt: Date
  usageCount: number
}

interface StateNodeData {
  state: {
    id: string
    name: string
    description: string
    initial?: boolean
    identifyingImages: Array<{ image: string }>
  }
  images?: ImageAsset[]
  hasIncomingTransitions?: boolean
  isSelected: boolean
  onSelect: (id: string, selected: boolean) => void
}

export function StateNode({ data, selected }: NodeProps<StateNodeData>) {
  const { state, images = [], hasIncomingTransitions = false } = data

  return (
    <div className="min-w-[200px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-[#00D9FF]" />

      <Card
        className={`transition-all cursor-pointer ${
          selected
            ? "border-[#00D9FF] bg-[#00D9FF]/10 shadow-lg shadow-[#00D9FF]/20"
            : "border-gray-600 bg-[#27272A] hover:border-gray-500"
        }`}
      >
        <CardContent className="p-4">
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-center relative">
                <h3 className="font-semibold text-white text-xl text-center">{state.name}</h3>
                {hasIncomingTransitions && (
                  <Badge className="absolute -top-2 -right-2 bg-[#00FF88] text-black text-xs px-1.5 py-0.5" title="Has IncomingTransitions">
                    <Target className="w-3 h-3" />
                  </Badge>
                )}
                {state.initial && (
                  <Badge className="absolute -top-2 -left-2 bg-[#FFD700] text-black text-xs px-1.5 py-0.5" title="Initial State">
                    <Play className="w-3 h-3" />
                  </Badge>
                )}
              </div>
              {state.description && <p className="text-xs text-gray-400 mt-2 text-center line-clamp-2">{state.description}</p>}
            </div>

            {/* Identifying Images Thumbnail Grid */}
            {state.identifyingImages.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <ImageIcon className="w-3 h-3 text-gray-400" />
                  <span className="text-xs text-gray-400">Identifying Images ({state.identifyingImages.length})</span>
                </div>

                <div className="grid grid-cols-3 gap-1 max-w-[150px]">
                  {state.identifyingImages.slice(0, 6).map((imgConfig, i) => {
                    const imageData = images.find(img => img.id === imgConfig.image)
                    return (
                      <div
                        key={i}
                        className="w-12 h-12 bg-gray-700 rounded border border-gray-600 flex items-center justify-center relative overflow-hidden"
                      >
                        {imageData ? (
                          <img
                            src={imageData.url}
                            alt={imageData.name}
                            className="w-full h-full object-contain p-0.5"
                          />
                        ) : (
                          <ImageIcon className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                    )
                  })}
                  {/* Show +N indicator if more than 6 images */}
                  {state.identifyingImages.length > 6 && (
                    <div className="w-12 h-12 bg-gray-700 rounded border border-gray-600 flex items-center justify-center">
                      <span className="text-xs text-gray-400">+{state.identifyingImages.length - 6}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-[#BD00FF]" />
    </div>
  )
}
