'use client'

/**
 * Interactive Screenshot Workflow Diagram
 *
 * Visual representation of screenshot capture, processing, and pattern matching workflow
 */

import { useState } from 'react'

interface WorkflowNode {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  color: string
  type: 'capture' | 'storage' | 'processing' | 'analysis' | 'ui'
  description: string
}

interface WorkflowConnection {
  from: string
  to: string
  label?: string
  dashed?: boolean
}

const nodes: WorkflowNode[] = [
  // Capture Layer
  {
    id: 'user-upload',
    name: 'User Upload',
    x: 30,
    y: 40,
    width: 140,
    height: 70,
    color: '#3B82F6',
    type: 'capture',
    description: 'ScreenshotUploader.tsx - Manual upload via UI (5 tabs: Upload, Project, Snapshots, Direct, Auto)',
  },
  {
    id: 'automation-ws',
    name: 'Automation WS',
    x: 190,
    y: 40,
    width: 140,
    height: 70,
    color: '#3B82F6',
    type: 'capture',
    description: 'WebSocket /api/v1/ws/automation/runner - Desktop runner captures and stores screenshots to S3/PostgreSQL',
  },
  {
    id: 'snapshot-import',
    name: 'Snapshot Import',
    x: 350,
    y: 40,
    width: 140,
    height: 70,
    color: '#3B82F6',
    type: 'capture',
    description: '/api/integration-testing/snapshots - Import from snapshot runs (read-only)',
  },

  // Validation Layer
  {
    id: 'mime-validation',
    name: 'MIME Validation',
    x: 30,
    y: 150,
    width: 130,
    height: 60,
    color: '#F59E0B',
    type: 'analysis',
    description: 'images.py:53-71 - PNG, JPEG, GIF, WebP validation',
  },
  {
    id: 'magic-bytes',
    name: 'Magic Bytes',
    x: 180,
    y: 150,
    width: 130,
    height: 60,
    color: '#F59E0B',
    type: 'analysis',
    description: 'images.py:74-109 - File header verification',
  },
  {
    id: 'quota-check',
    name: 'Quota Check',
    x: 330,
    y: 150,
    width: 130,
    height: 60,
    color: '#F59E0B',
    type: 'analysis',
    description: 'storage_service.py - Free:25MB, Hobby:200MB, Pro:2GB',
  },

  // Storage Layer
  {
    id: 's3-storage',
    name: 'S3/MinIO',
    x: 30,
    y: 250,
    width: 120,
    height: 70,
    color: '#10B981',
    type: 'storage',
    description: 'object_storage.py - Stores originals + 3 thumbnail sizes (256px thumb, 1024px medium, 2048px large)',
  },
  {
    id: 'postgres-db',
    name: 'PostgreSQL',
    x: 170,
    y: 250,
    width: 120,
    height: 70,
    color: '#10B981',
    type: 'storage',
    description: 'automation_screenshots, screenshots, annotations, storage_usage tables with thumbnail metadata',
  },
  {
    id: 'indexeddb',
    name: 'IndexedDB',
    x: 310,
    y: 250,
    width: 120,
    height: 70,
    color: '#10B981',
    type: 'storage',
    description: 'screenshot-db.ts - Browser-side temporary storage with base64 data URLs',
  },
  {
    id: 'presigned-url',
    name: 'Presigned URLs',
    x: 450,
    y: 250,
    width: 120,
    height: 70,
    color: '#10B981',
    type: 'storage',
    description: '7-day expiration, generated on-demand from S3 keys for all image sizes',
  },

  // Processing Layer
  {
    id: 'thumbnail-generator',
    name: 'Thumbnail Generator',
    x: 30,
    y: 360,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'processing',
    description: 'image_service.py:generate_thumbnails() - Creates 256px, 1024px, 2048px thumbnails via Pillow',
  },
  {
    id: 'image-optimizer',
    name: 'Image Optimizer',
    x: 180,
    y: 360,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'processing',
    description: 'image_service.py:optimize_image() - Prepares images for WebP conversion',
  },
  {
    id: 'webp-conversion',
    name: 'WebP Conversion',
    x: 330,
    y: 360,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'processing',
    description: 'image_service.py - WebP conversion with quality=85, method=6 for optimal compression',
  },
  {
    id: 'arq-queue',
    name: 'ARQ Background Queue',
    x: 480,
    y: 360,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'processing',
    description: 'worker.py - Redis-backed async task queue for background thumbnail generation',
  },
  {
    id: 'pattern-extraction',
    name: 'Pattern Extract',
    x: 30,
    y: 455,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'processing',
    description: 'pattern_optimization_service.py:63-110 - Extract regions from screenshots',
  },
  {
    id: 'region-annotation',
    name: 'Region Annotate',
    x: 180,
    y: 455,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'processing',
    description: 'ScreenshotCanvas + RegionSelector - Manual UI annotation tools',
  },
  {
    id: 'state-clustering',
    name: 'State Clustering',
    x: 330,
    y: 455,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'processing',
    description: 'state_discovery_service.py - Timestamp-based automatic state detection',
  },

  // Analysis Layer
  {
    id: 'pattern-matching',
    name: 'Pattern Match',
    x: 30,
    y: 550,
    width: 130,
    height: 65,
    color: '#F59E0B',
    type: 'analysis',
    description: 'qontinui-api:8001 /find, /find_all - OpenCV template matching',
  },
  {
    id: 'pattern-optimize',
    name: 'Pattern Optimize',
    x: 180,
    y: 550,
    width: 130,
    height: 65,
    color: '#F59E0B',
    type: 'analysis',
    description: 'backend:8000 /optimize-pattern - Similarity matrix, statistics, strategy evaluation',
  },
  {
    id: 'ml-detection',
    name: 'ML Detection',
    x: 330,
    y: 550,
    width: 130,
    height: 65,
    color: '#F59E0B',
    type: 'analysis',
    description: 'analyzer_results, detected_elements, fused_elements - Multi-analyzer fusion',
  },

  // UI Layer
  {
    id: 'image-library',
    name: 'Image Library',
    x: 30,
    y: 645,
    width: 130,
    height: 65,
    color: '#EC4899',
    type: 'ui',
    description: 'EnhancedImageLibrary.tsx - Uses thumb (256px) URLs for fast grid rendering with lazy loading',
  },
  {
    id: 'screenshot-canvas',
    name: 'Canvas Editor',
    x: 180,
    y: 645,
    width: 130,
    height: 65,
    color: '#EC4899',
    type: 'ui',
    description: 'ScreenshotCanvas.tsx - Progressive loading: medium (1024px) → large (2048px) → original',
  },
  {
    id: 'pattern-optimizer-ui',
    name: 'Pattern Optimizer',
    x: 330,
    y: 645,
    width: 130,
    height: 65,
    color: '#EC4899',
    type: 'ui',
    description: 'PatternOptimizationTab.tsx - Region selection, analysis panel, results display',
  },
]

const connections: WorkflowConnection[] = [
  // Capture to Validation
  { from: 'user-upload', to: 'mime-validation', label: 'validate' },
  { from: 'user-upload', to: 'magic-bytes', label: 'verify' },
  { from: 'user-upload', to: 'quota-check', label: 'check' },

  // Validation to Processing (new thumbnail flow)
  { from: 'mime-validation', to: 'thumbnail-generator', label: 'pass' },
  { from: 'magic-bytes', to: 'thumbnail-generator', label: 'pass' },
  { from: 'quota-check', to: 'thumbnail-generator', label: 'pass' },

  // Thumbnail generation flow
  { from: 'user-upload', to: 'thumbnail-generator', label: 'upload' },
  { from: 'thumbnail-generator', to: 's3-storage', label: 'store' },

  // Image optimization flow
  { from: 'user-upload', to: 'image-optimizer', label: 'optimize' },
  { from: 'image-optimizer', to: 'webp-conversion', label: 'convert' },
  { from: 'webp-conversion', to: 's3-storage', label: 'store' },

  // Background processing flow
  { from: 's3-storage', to: 'arq-queue', label: 'enqueue' },
  { from: 'arq-queue', to: 'thumbnail-generator', label: 'process', dashed: true },
  { from: 'arq-queue', to: 'postgres-db', label: 'update metadata' },

  // Capture to Storage (direct paths)
  { from: 'automation-ws', to: 'postgres-db', label: 'metadata' }, // NOW fully implemented
  { from: 'snapshot-import', to: 'postgres-db', label: 'read-only' },
  { from: 'user-upload', to: 'indexeddb', label: 'cache' },

  // Storage Layer Internal
  { from: 's3-storage', to: 'postgres-db', label: 'metadata' },
  { from: 's3-storage', to: 'presigned-url', label: 'generate' },
  { from: 'postgres-db', to: 'presigned-url', label: 's3_key' },

  // Storage to Processing
  { from: 'presigned-url', to: 'pattern-extraction', label: 'fetch' },
  { from: 'indexeddb', to: 'pattern-extraction', label: 'base64' },
  { from: 'presigned-url', to: 'region-annotation', label: 'load' },
  { from: 'postgres-db', to: 'state-clustering', label: 'timestamps' },

  // Processing to Analysis
  { from: 'pattern-extraction', to: 'pattern-matching', label: 'templates' },
  { from: 'pattern-extraction', to: 'pattern-optimize', label: 'regions' },
  { from: 'region-annotation', to: 'ml-detection', label: 'annotations' },
  { from: 'state-clustering', to: 'pattern-matching', label: 'states' },

  // Analysis to UI
  { from: 'presigned-url', to: 'image-library', label: 'thumb URLs' },
  { from: 'presigned-url', to: 'screenshot-canvas', label: 'progressive' },
  { from: 'pattern-matching', to: 'screenshot-canvas', label: 'results' },
  { from: 'pattern-optimize', to: 'pattern-optimizer-ui', label: 'metrics' },
  { from: 'ml-detection', to: 'screenshot-canvas', label: 'detections' },

  // UI to Storage (feedback loops)
  { from: 'image-library', to: 'indexeddb', label: 'manage', dashed: true },
  { from: 'screenshot-canvas', to: 'postgres-db', label: 'save', dashed: true },
  { from: 'pattern-optimizer-ui', to: 'pattern-extraction', label: 'refine', dashed: true },
]

export function ScreenshotWorkflowDiagram() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  const getNodeColor = (type: WorkflowNode['type']) => {
    switch (type) {
      case 'capture': return { main: '#3B82F6', hover: '#2563EB' }
      case 'storage': return { main: '#10B981', hover: '#059669' }
      case 'processing': return { main: '#8B5CF6', hover: '#7C3AED' }
      case 'analysis': return { main: '#F59E0B', hover: '#D97706' }
      case 'ui': return { main: '#EC4899', hover: '#DB2777' }
    }
  }

  const isConnectionHighlighted = (conn: WorkflowConnection) => {
    if (!hoveredNode && !selectedNode) return false
    const activeNode = hoveredNode || selectedNode
    return conn.from === activeNode || conn.to === activeNode
  }

  const isNodeDimmed = (nodeId: string) => {
    const active = hoveredNode || selectedNode
    if (!active || active === nodeId) return false

    const relatedNodes = connections
      .filter(c => c.from === active || c.to === active)
      .flatMap(c => [c.from, c.to])

    return !relatedNodes.includes(nodeId)
  }

  return (
    <div className="w-full h-full min-h-[800px] flex flex-col">
      {/* Legend */}
      <div className="mb-4">
        <div className="flex flex-wrap gap-4 text-sm mb-2">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#3B82F6' }} />
            <span>Capture</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#F59E0B' }} />
            <span>Validation/Analysis</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#10B981' }} />
            <span>Storage</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#8B5CF6' }} />
            <span>Processing</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#EC4899' }} />
            <span>UI Components</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Based on actual implementation - Includes file paths and API endpoints. Dashed lines indicate background processes or feedback loops.
        </p>
        <p className="text-xs text-green-600 font-semibold mt-1">
          All improvements implemented - thumbnails (256px/1024px/2048px), WebP optimization (quality=85, method=6), background processing (ARQ), and progressive/lazy loading
        </p>
      </div>

      {/* SVG Diagram */}
      <div className="flex-1 flex items-center justify-center">
        <svg viewBox="0 0 640 750" className="w-full h-full max-h-[800px]">
          <defs>
            <filter id="shadow">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.3" />
            </filter>
            <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
              <polygon points="0 0, 10 3, 0 6" fill="#64748B" />
            </marker>
            <marker id="arrowhead-active" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
              <polygon points="0 0, 10 3, 0 6" fill="#3B82F6" />
            </marker>
          </defs>

          {/* Connections */}
          <g>
            {connections.map((conn, idx) => {
              const fromNode = nodes.find(n => n.id === conn.from)
              const toNode = nodes.find(n => n.id === conn.to)
              if (!fromNode || !toNode) return null

              const isHighlighted = isConnectionHighlighted(conn)
              const fromX = fromNode.x + fromNode.width / 2
              const fromY = fromNode.y + fromNode.height
              const toX = toNode.x + toNode.width / 2
              const toY = toNode.y

              return (
                <g key={idx}>
                  <line
                    x1={fromX}
                    y1={fromY}
                    x2={toX}
                    y2={toY}
                    stroke={isHighlighted ? '#3B82F6' : '#64748B'}
                    strokeWidth={isHighlighted ? 3 : 2}
                    strokeDasharray={conn.dashed ? '5,5' : undefined}
                    markerEnd={isHighlighted ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
                    opacity={hoveredNode && !isHighlighted ? 0.3 : 1}
                  />
                  {conn.label && (
                    <text
                      x={(fromX + toX) / 2}
                      y={(fromY + toY) / 2}
                      fill={isHighlighted ? '#3B82F6' : '#64748B'}
                      fontSize="11"
                      textAnchor="middle"
                      opacity={hoveredNode && !isHighlighted ? 0.3 : 1}
                    >
                      {conn.label}
                    </text>
                  )}
                </g>
              )
            })}
          </g>

          {/* Nodes */}
          <g>
            {nodes.map((node) => {
              const colors = getNodeColor(node.type)
              const isSelected = selectedNode === node.id
              const isHovered = hoveredNode === node.id
              const isDimmed = isNodeDimmed(node.id)

              return (
                <g
                  key={node.id}
                  onClick={() => setSelectedNode(node.id === selectedNode ? null : node.id)}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  className="cursor-pointer"
                  style={{ opacity: isDimmed ? 0.3 : 1 }}
                >
                  {(isSelected || isHovered) && (
                    <rect
                      x={node.x - 4}
                      y={node.y - 4}
                      width={node.width + 8}
                      height={node.height + 8}
                      rx="10"
                      fill="none"
                      stroke={colors.main}
                      strokeWidth="3"
                      opacity="0.5"
                    />
                  )}
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    rx="6"
                    fill={isHovered ? colors.hover : colors.main}
                    filter="url(#shadow)"
                  />
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + node.height / 2 - 5}
                    fill="white"
                    fontSize="14"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {node.name}
                  </text>
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + node.height / 2 + 12}
                    fill="white"
                    fontSize="10"
                    opacity="0.8"
                    textAnchor="middle"
                  >
                    {node.type}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      {/* Selected Node Details */}
      {selectedNode && (
        <div className="mt-4 p-4 bg-muted rounded-lg">
          <h3 className="font-semibold mb-2">{nodes.find(n => n.id === selectedNode)?.name}</h3>
          <p className="text-sm text-muted-foreground">
            {nodes.find(n => n.id === selectedNode)?.description}
          </p>
        </div>
      )}
    </div>
  )
}
