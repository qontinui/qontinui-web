"use client"

import React from "react"
import { useImageStats } from "@/hooks/use-image-stats"
import { Loader2 } from "lucide-react"

interface ImageStatsDisplayProps {
  imageDataUrl: string | null
  className?: string
}

export function ImageStatsDisplay({ imageDataUrl, className = "" }: ImageStatsDisplayProps) {
  const stats = useImageStats(imageDataUrl)

  if (!imageDataUrl) {
    return (
      <div className={`text-xs text-gray-500 ${className}`}>
        No image selected
      </div>
    )
  }

  if (!stats || stats.isLoading) {
    return (
      <div className={`flex items-center gap-1 text-xs text-gray-400 ${className}`}>
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Loading...</span>
      </div>
    )
  }

  return (
    <div className={`text-xs leading-tight ${className}`}>
      <div className="font-mono text-gray-300">{stats.width} × {stats.height}</div>
      {stats.transparencyPercent > 0 && (
        <div className="text-[#00D9FF]">
          {stats.transparencyPercent}% transparent
        </div>
      )}
    </div>
  )
}
