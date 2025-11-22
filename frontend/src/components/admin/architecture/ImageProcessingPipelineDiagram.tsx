'use client'

/**
 * Interactive Image Processing Pipeline Diagram
 *
 * Comprehensive visualization of the complete image processing pipeline across
 * frontend, backend, and qontinui-api with validation, storage, optimization,
 * computer vision, and delivery
 */

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'

interface PipelineNode {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  color: string
  type: 'upload' | 'validation' | 'storage' | 'processing' | 'cv' | 'delivery' | 'client'
  description: string
  service: 'frontend' | 'backend' | 'qontinui-api' | 'infrastructure'
}

interface PipelineConnection {
  from: string
  to: string
  label?: string
  dashed?: boolean
}

const nodes: PipelineNode[] = [
  // Upload Layer (Row 1)
  {
    id: 'user-upload',
    name: 'User Upload',
    x: 40,
    y: 30,
    width: 130,
    height: 60,
    color: '#3B82F6',
    type: 'upload',
    service: 'frontend',
    description: 'ScreenshotUploader.tsx - Drag & drop, file picker. Accepts image/* up to 50MB. Multi-file support with duplicate detection via SHA-256 hashing.',
  },
  {
    id: 'automation-capture',
    name: 'Automation',
    x: 190,
    y: 30,
    width: 130,
    height: 60,
    color: '#3B82F6',
    type: 'upload',
    service: 'backend',
    description: 'WebSocket /ws/automation/runner - qontinui-runner captures screenshots during automation execution. Direct S3 upload with PostgreSQL metadata tracking.',
  },
  {
    id: 'api-upload',
    name: 'API Upload',
    x: 340,
    y: 30,
    width: 130,
    height: 60,
    color: '#3B82F6',
    type: 'upload',
    service: 'qontinui-api',
    description: 'POST /api/state-discovery/upload - Base64 or multipart uploads for state discovery and pattern analysis. In-memory processing with optional persistence.',
  },
  {
    id: 'snapshot-import',
    name: 'Snapshot Import',
    x: 490,
    y: 30,
    width: 130,
    height: 60,
    color: '#3B82F6',
    type: 'upload',
    service: 'backend',
    description: 'Snapshot runs - Import from integration testing snapshots. Read-only access to historical automation screenshots.',
  },

  // Validation Layer (Row 2)
  {
    id: 'client-validation',
    name: 'Client Check',
    x: 40,
    y: 120,
    width: 110,
    height: 55,
    color: '#F59E0B',
    type: 'validation',
    service: 'frontend',
    description: 'imageUtils.ts - Pre-upload validation: min 10x10px dimensions, image/* MIME type, SHA-256 duplicate detection, size limits.',
  },
  {
    id: 'mime-validation',
    name: 'MIME Validate',
    x: 170,
    y: 120,
    width: 110,
    height: 55,
    color: '#F59E0B',
    type: 'validation',
    service: 'backend',
    description: 'images.py:53-71 - Server-side MIME validation: PNG, JPEG, JPG, GIF, WebP. Rejects unsupported formats.',
  },
  {
    id: 'magic-bytes',
    name: 'Magic Bytes',
    x: 300,
    y: 120,
    width: 110,
    height: 55,
    color: '#F59E0B',
    type: 'validation',
    service: 'backend',
    description: 'images.py:74-109 - File signature verification prevents spoofing. Validates: PNG (\\x89PNG), JPEG (\\xFF\\xD8\\xFF), GIF (GIF), WebP (RIFF+WEBP).',
  },
  {
    id: 'quota-check',
    name: 'Quota Check',
    x: 430,
    y: 120,
    width: 110,
    height: 55,
    color: '#F59E0B',
    type: 'validation',
    service: 'backend',
    description: 'storage_service.py - Tier limits: Free 25MB, Hobby 200MB, Pro 2GB. Estimates 30% overhead for thumbnails. Raises StorageQuotaExceeded.',
  },

  // Storage Layer (Row 3)
  {
    id: 's3-storage',
    name: 'S3/MinIO',
    x: 40,
    y: 205,
    width: 100,
    height: 60,
    color: '#10B981',
    type: 'storage',
    service: 'infrastructure',
    description: 'object_storage.py - Multi-backend: AWS S3 (prod), MinIO (dev), local filesystem (test). Path: images/{user_id}/{project_id}/. Boto3 with retry logic.',
  },
  {
    id: 'postgres-metadata',
    name: 'PostgreSQL',
    x: 160,
    y: 205,
    width: 100,
    height: 60,
    color: '#10B981',
    type: 'storage',
    service: 'infrastructure',
    description: 'Tables: automation_screenshots, screenshots, annotations, storage_usage. Tracks S3 keys, sizes, variants, timestamps, processing status.',
  },
  {
    id: 'redis-cache',
    name: 'Redis',
    x: 280,
    y: 205,
    width: 100,
    height: 60,
    color: '#10B981',
    type: 'storage',
    service: 'infrastructure',
    description: 'ARQ task queue for async processing. Pattern cache for qontinui-api. WebSocket pub/sub for real-time status updates. Rate limiting store.',
  },
  {
    id: 'indexeddb',
    name: 'IndexedDB',
    x: 400,
    y: 205,
    width: 100,
    height: 60,
    color: '#10B981',
    type: 'storage',
    service: 'frontend',
    description: 'screenshot-db.ts - Browser-side offline storage. Base64 image caching. Sync queue for offline uploads. Enables offline-first architecture.',
  },
  {
    id: 'presigned-urls',
    name: 'Presigned URLs',
    x: 520,
    y: 205,
    width: 100,
    height: 60,
    color: '#10B981',
    type: 'storage',
    service: 'backend',
    description: 'POST /{project_id}/images/{s3_key}/refresh-url - 7-day expiration. Secure access without credentials. Generated on-demand, auto-refresh on expiry.',
  },

  // Backend Processing Layer (Row 4)
  {
    id: 'arq-queue',
    name: 'ARQ Queue',
    x: 40,
    y: 295,
    width: 95,
    height: 55,
    color: '#8B5CF6',
    type: 'processing',
    service: 'backend',
    description: 'tasks.py - Redis-backed async queue. Background task: process_uploaded_image. Enqueued immediately after upload. Returns job ID for tracking.',
  },
  {
    id: 'thumbnail-gen',
    name: 'Thumbnails',
    x: 155,
    y: 295,
    width: 95,
    height: 55,
    color: '#8B5CF6',
    type: 'processing',
    service: 'backend',
    description: 'image_processing_service.py - Generates 3 sizes: thumb (256x256), medium (1024x1024), large (2048x2048). LANCZOS resampling. Maintains aspect ratio.',
  },
  {
    id: 'webp-convert',
    name: 'WebP Convert',
    x: 270,
    y: 295,
    width: 95,
    height: 55,
    color: '#8B5CF6',
    type: 'processing',
    service: 'backend',
    description: 'optimize_image() - WebP quality=85, method=6 (best compression). RGBA→RGB with white background. ~70% size reduction vs PNG.',
  },
  {
    id: 'exif-handling',
    name: 'EXIF Orient',
    x: 385,
    y: 295,
    width: 95,
    height: 55,
    color: '#8B5CF6',
    type: 'processing',
    service: 'backend',
    description: 'ImageOps.exif_transpose() - Auto-rotates based on EXIF orientation tag. Prevents sideways/upside-down images from phone cameras.',
  },
  {
    id: 'avatar-resize',
    name: 'Avatar Resize',
    x: 500,
    y: 295,
    width: 95,
    height: 55,
    color: '#8B5CF6',
    type: 'processing',
    service: 'backend',
    description: 'avatar_service.py - Resizes to 200x200 square. Centers on white canvas. RGBA→RGB. JPEG quality=85 with optimize=True.',
  },

  // qontinui-api CV Preprocessing (Row 5)
  {
    id: 'opencv-preprocess',
    name: 'OpenCV Prep',
    x: 40,
    y: 380,
    width: 100,
    height: 55,
    color: '#7C3AED',
    type: 'cv',
    service: 'qontinui-api',
    description: 'main.py - Convert PIL→numpy→BGR. Grayscale conversion. Edge detection (Canny). Morphological operations (erosion, dilation) for noise removal.',
  },
  {
    id: 'region-crop',
    name: 'Region Crop',
    x: 160,
    y: 380,
    width: 100,
    height: 55,
    color: '#7C3AED',
    type: 'cv',
    service: 'qontinui-api',
    description: 'state_discovery_api.py - Crop screenshots to specific regions before analysis. Validates bounds. Reduces computation for focused analysis.',
  },
  {
    id: 'pixel-stability',
    name: 'Pixel Stability',
    x: 280,
    y: 380,
    width: 100,
    height: 55,
    color: '#7C3AED',
    type: 'cv',
    service: 'qontinui-api',
    description: 'PixelStabilityMatrixAnalyzer - Multi-screenshot variance analysis. Coefficient of variation per pixel. Confidence maps. Stability threshold 0.98.',
  },
  {
    id: 'mask-generation',
    name: 'Mask Generate',
    x: 400,
    y: 380,
    width: 100,
    height: 55,
    color: '#7C3AED',
    type: 'cv',
    service: 'qontinui-api',
    description: 'masked_patterns_api.py - Binary masks from confidence threshold. Erosion/dilation for cleanup. Multiple color averaging strategies (mean/median/weighted/mode).',
  },
  {
    id: 'deduplication',
    name: 'Deduplicate',
    x: 520,
    y: 380,
    width: 100,
    height: 55,
    color: '#7C3AED',
    type: 'cv',
    service: 'qontinui-api',
    description: 'state_discovery_api.py - SHA-256 hash-based duplicate detection. Prevents redundant storage and analysis. Returns duplicate info on upload.',
  },

  // Computer Vision Analysis (Row 6)
  {
    id: 'template-matching',
    name: 'Template Match',
    x: 40,
    y: 465,
    width: 110,
    height: 55,
    color: '#DC2626',
    type: 'cv',
    service: 'qontinui-api',
    description: '/find, /find_all - OpenCV TM_CCOEFF_NORMED. NMS with 0.3 IoU threshold. Similarity filtering. Multi-scale matching. Used by qontinui library.',
  },
  {
    id: 'state-discovery',
    name: 'State Discovery',
    x: 170,
    y: 465,
    width: 110,
    height: 55,
    color: '#DC2626',
    type: 'cv',
    service: 'qontinui-api',
    description: '/api/state-discovery/* - Pixel stability matrix. Rectangle decomposition. Co-occurrence analysis. WebSocket progress streaming. Min region 20x20, max 500x500.',
  },
  {
    id: 'semantic-analysis',
    name: 'Semantic OCR',
    x: 300,
    y: 465,
    width: 110,
    height: 55,
    color: '#DC2626',
    type: 'cv',
    service: 'qontinui-api',
    description: '/api/semantic/objects - Element detection: buttons, inputs, labels, images. EasyOCR text extraction. CLIP-based descriptions (40+ candidates). Contour filtering.',
  },
  {
    id: 'pattern-optimize',
    name: 'Pattern Optimize',
    x: 430,
    y: 465,
    width: 110,
    height: 55,
    color: '#DC2626',
    type: 'cv',
    service: 'backend',
    description: '/optimize-pattern - Multi-pattern strategy testing. Consensus via similarity matrix. Feature-based ORB matching. Differential analysis with negatives.',
  },

  // Client-Side Processing (Row 7)
  {
    id: 'canvas-extract',
    name: 'Canvas Extract',
    x: 40,
    y: 550,
    width: 100,
    height: 55,
    color: '#EC4899',
    type: 'client',
    service: 'frontend',
    description: 'imageUtils.ts - HTML5 Canvas API for region extraction. Crop, border removal, background removal. Returns base64 PNG data URLs.',
  },
  {
    id: 'progressive-load',
    name: 'Progressive Load',
    x: 160,
    y: 550,
    width: 100,
    height: 55,
    color: '#EC4899',
    type: 'client',
    service: 'frontend',
    description: 'ProgressiveImage.tsx - Zoom-aware quality: <2x thumb, 2x-4x medium, >4x large/original. Prevents re-downloading. Tracks loaded variants.',
  },
  {
    id: 'lazy-loading',
    name: 'Lazy Loading',
    x: 280,
    y: 550,
    width: 100,
    height: 55,
    color: '#EC4899',
    type: 'client',
    service: 'frontend',
    description: 'LazyImage.tsx - Intersection Observer API. 100px preload margin. Placeholder animations. Viewport-based loading for grid views.',
  },
  {
    id: 'object-urls',
    name: 'Object URLs',
    x: 400,
    y: 550,
    width: 100,
    height: 55,
    color: '#EC4899',
    type: 'client',
    service: 'frontend',
    description: 'URL.createObjectURL() for File objects. Cleanup on unmount prevents memory leaks. useEffect return functions handle revocation.',
  },
  {
    id: 'sha256-hash',
    name: 'SHA-256 Hash',
    x: 520,
    y: 550,
    width: 100,
    height: 55,
    color: '#EC4899',
    type: 'client',
    service: 'frontend',
    description: 'imageUtils.ts:calculateImageHash() - Web Crypto API for client-side duplicate detection. File signature: name_size_modified + content hash.',
  },

  // Delivery & Display (Row 8)
  {
    id: 'image-library',
    name: 'Image Library',
    x: 40,
    y: 635,
    width: 110,
    height: 55,
    color: '#059669',
    type: 'delivery',
    service: 'frontend',
    description: 'EnhancedImageLibrary.tsx - Grid view with thumb (256px) URLs. Lazy loading. Infinite scroll. Click for lightbox with progressive upgrade to high-res.',
  },
  {
    id: 'canvas-editor',
    name: 'Canvas Editor',
    x: 170,
    y: 635,
    width: 110,
    height: 55,
    color: '#059669',
    type: 'delivery',
    service: 'frontend',
    description: 'ScreenshotCanvas.tsx - Zoom 0.1x-50x, pan with right-click. Progressive: medium→large→original. Region/location annotations. Coordinate transforms.',
  },
  {
    id: 'react-query',
    name: 'React Query',
    x: 300,
    y: 635,
    width: 110,
    height: 55,
    color: '#059669',
    type: 'delivery',
    service: 'frontend',
    description: '@tanstack/react-query - Server state caching. Auto-refresh presigned URLs. Optimistic updates. Background refetch. Stale-while-revalidate pattern.',
  },
  {
    id: 'websocket-status',
    name: 'WebSocket Status',
    x: 430,
    y: 635,
    width: 110,
    height: 55,
    color: '#059669',
    type: 'delivery',
    service: 'backend',
    description: 'websocket_manager.py - Real-time processing status updates. Redis pub/sub broadcast. ConnectionManager tracks active connections. Status: processing/completed/failed.',
  },
]

const connections: PipelineConnection[] = [
  // Upload to Validation
  { from: 'user-upload', to: 'client-validation', label: 'pre-check' },
  { from: 'user-upload', to: 'mime-validation', label: 'upload' },
  { from: 'automation-capture', to: 'mime-validation', label: 'capture' },
  { from: 'api-upload', to: 'opencv-preprocess', label: 'base64' },
  { from: 'snapshot-import', to: 'postgres-metadata', label: 'metadata' },

  // Validation Chain
  { from: 'client-validation', to: 'mime-validation', label: 'pass' },
  { from: 'mime-validation', to: 'magic-bytes', label: 'verify' },
  { from: 'magic-bytes', to: 'quota-check', label: 'check' },

  // Validation to Storage
  { from: 'quota-check', to: 's3-storage', label: 'store original' },
  { from: 's3-storage', to: 'postgres-metadata', label: 'metadata' },
  { from: 's3-storage', to: 'arq-queue', label: 'enqueue' },
  { from: 'user-upload', to: 'indexeddb', label: 'cache' },

  // Storage to Processing
  { from: 'arq-queue', to: 'thumbnail-gen', label: 'process' },
  { from: 'thumbnail-gen', to: 'webp-convert', label: 'optimize' },
  { from: 'thumbnail-gen', to: 'exif-handling', label: 'orient' },
  { from: 'webp-convert', to: 's3-storage', label: 'store variants' },
  { from: 'exif-handling', to: 's3-storage', label: 'store rotated' },
  { from: 'user-upload', to: 'avatar-resize', label: 'avatar', dashed: true },
  { from: 'avatar-resize', to: 's3-storage', label: 'store' },

  // Storage to CV Preprocessing
  { from: 's3-storage', to: 'presigned-urls', label: 'generate' },
  { from: 'postgres-metadata', to: 'redis-cache', label: 'pub/sub' },
  { from: 'presigned-urls', to: 'opencv-preprocess', label: 'fetch' },
  { from: 'indexeddb', to: 'opencv-preprocess', label: 'offline' },

  // CV Preprocessing
  { from: 'opencv-preprocess', to: 'region-crop', label: 'decode' },
  { from: 'region-crop', to: 'pixel-stability', label: 'crop' },
  { from: 'pixel-stability', to: 'mask-generation', label: 'variance' },
  { from: 'api-upload', to: 'deduplication', label: 'hash' },

  // CV Analysis
  { from: 'mask-generation', to: 'template-matching', label: 'patterns' },
  { from: 'region-crop', to: 'state-discovery', label: 'screenshots' },
  { from: 'opencv-preprocess', to: 'semantic-analysis', label: 'image' },
  { from: 'mask-generation', to: 'pattern-optimize', label: 'regions' },

  // Analysis to Client
  { from: 'template-matching', to: 'canvas-extract', label: 'coords' },
  { from: 'state-discovery', to: 'canvas-editor', label: 'states' },
  { from: 'semantic-analysis', to: 'canvas-editor', label: 'elements' },
  { from: 'pattern-optimize', to: 'canvas-editor', label: 'metrics' },

  // Client Processing
  { from: 'user-upload', to: 'sha256-hash', label: 'detect dupes' },
  { from: 'sha256-hash', to: 'client-validation', label: 'validate', dashed: true },
  { from: 'canvas-extract', to: 'object-urls', label: 'File objects' },

  // Delivery
  { from: 'presigned-urls', to: 'progressive-load', label: 'variants' },
  { from: 'progressive-load', to: 'lazy-loading', label: 'optimize' },
  { from: 'lazy-loading', to: 'image-library', label: 'render' },
  { from: 'progressive-load', to: 'canvas-editor', label: 'zoom aware' },
  { from: 'presigned-urls', to: 'react-query', label: 'cache' },
  { from: 'redis-cache', to: 'websocket-status', label: 'broadcast' },
  { from: 'websocket-status', to: 'react-query', label: 'invalidate', dashed: true },

  // Feedback Loops
  { from: 'canvas-editor', to: 'postgres-metadata', label: 'annotations', dashed: true },
  { from: 'canvas-extract', to: 'api-upload', label: 'analyze', dashed: true },
  { from: 'react-query', to: 'presigned-urls', label: 'refresh', dashed: true },
]

export function ImageProcessingPipelineDiagram() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  const getNodeColor = (type: PipelineNode['type']) => {
    switch (type) {
      case 'upload': return { main: '#3B82F6', hover: '#2563EB', label: 'Upload' }
      case 'validation': return { main: '#F59E0B', hover: '#D97706', label: 'Validation' }
      case 'storage': return { main: '#10B981', hover: '#059669', label: 'Storage' }
      case 'processing': return { main: '#8B5CF6', hover: '#7C3AED', label: 'Processing' }
      case 'cv': return { main: '#7C3AED', hover: '#6D28D9', label: 'Computer Vision' }
      case 'client': return { main: '#EC4899', hover: '#DB2777', label: 'Client' }
      case 'delivery': return { main: '#059669', hover: '#047857', label: 'Delivery' }
    }
  }

  const getServiceColor = (service: PipelineNode['service']) => {
    switch (service) {
      case 'frontend': return '#3B82F6'
      case 'backend': return '#10B981'
      case 'qontinui-api': return '#8B5CF6'
      case 'infrastructure': return '#64748B'
    }
  }

  const isConnectionHighlighted = (conn: PipelineConnection) => {
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
    <div className="w-full h-full min-h-[900px] flex flex-col">
      {/* Legends */}
      <div className="mb-4 space-y-3">
        {/* Type Legend */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Pipeline Stages</h4>
          <div className="flex flex-wrap gap-3 text-xs">
            {(['upload', 'validation', 'storage', 'processing', 'cv', 'client', 'delivery'] as const).map((type) => {
              const colors = getNodeColor(type)
              return (
                <div key={type} className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: colors.main }} />
                  <span>{colors.label}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Service Legend */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Services</h4>
          <div className="flex flex-wrap gap-3 text-xs">
            <Badge variant="outline" style={{ borderColor: '#3B82F6', color: '#3B82F6' }}>Frontend</Badge>
            <Badge variant="outline" style={{ borderColor: '#10B981', color: '#10B981' }}>Backend (port 8000)</Badge>
            <Badge variant="outline" style={{ borderColor: '#8B5CF6', color: '#8B5CF6' }}>qontinui-api (port 8001)</Badge>
            <Badge variant="outline" style={{ borderColor: '#64748B', color: '#64748B' }}>Infrastructure</Badge>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Complete image processing pipeline from upload through validation, storage, optimization, computer vision analysis, and delivery.
          Includes file paths, API endpoints, and implementation details. Dashed lines indicate async/background processes or feedback loops.
        </p>
      </div>

      {/* SVG Diagram */}
      <div className="flex-1 flex items-center justify-center">
        <svg viewBox="0 0 660 730" className="w-full h-full max-h-[900px]">
          <defs>
            <filter id="shadow-pipeline">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.3" />
            </filter>
            <marker id="arrowhead-pipeline" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
              <polygon points="0 0, 10 3, 0 6" fill="#64748B" />
            </marker>
            <marker id="arrowhead-pipeline-active" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
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
                    stroke={isHighlighted ? '#3B82F6' : '#94A3B8'}
                    strokeWidth={isHighlighted ? 2.5 : 1.5}
                    strokeDasharray={conn.dashed ? '4,4' : undefined}
                    markerEnd={isHighlighted ? 'url(#arrowhead-pipeline-active)' : 'url(#arrowhead-pipeline)'}
                    opacity={hoveredNode && !isHighlighted ? 0.2 : 0.6}
                  />
                  {conn.label && (
                    <text
                      x={(fromX + toX) / 2}
                      y={(fromY + toY) / 2 - 2}
                      fill={isHighlighted ? '#3B82F6' : '#64748B'}
                      fontSize="9"
                      textAnchor="middle"
                      opacity={hoveredNode && !isHighlighted ? 0.2 : 0.7}
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
              const serviceColor = getServiceColor(node.service)
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
                  style={{ opacity: isDimmed ? 0.25 : 1 }}
                >
                  {(isSelected || isHovered) && (
                    <rect
                      x={node.x - 4}
                      y={node.y - 4}
                      width={node.width + 8}
                      height={node.height + 8}
                      rx="8"
                      fill="none"
                      stroke={colors.main}
                      strokeWidth="2.5"
                      opacity="0.6"
                    />
                  )}
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    rx="5"
                    fill={isHovered ? colors.hover : colors.main}
                    filter="url(#shadow-pipeline)"
                  />
                  {/* Service indicator bar */}
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height="3"
                    rx="5"
                    fill={serviceColor}
                    opacity="0.8"
                  />
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + node.height / 2 + 2}
                    fill="white"
                    fontSize="12"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {node.name}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      {/* Selected Node Details */}
      {selectedNode && (
        <div className="mt-4 p-4 bg-muted rounded-lg border">
          <div className="flex items-start justify-between mb-2">
            <h3 className="font-semibold text-lg">{nodes.find(n => n.id === selectedNode)?.name}</h3>
            <Badge variant="outline" style={{
              borderColor: getServiceColor(nodes.find(n => n.id === selectedNode)?.service || 'frontend'),
              color: getServiceColor(nodes.find(n => n.id === selectedNode)?.service || 'frontend')
            }}>
              {nodes.find(n => n.id === selectedNode)?.service}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {nodes.find(n => n.id === selectedNode)?.description}
          </p>
        </div>
      )}

      {/* Quick Stats */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="p-3 bg-muted rounded-lg">
          <div className="font-semibold text-lg">{nodes.filter(n => n.service === 'frontend').length}</div>
          <div className="text-muted-foreground">Frontend Nodes</div>
        </div>
        <div className="p-3 bg-muted rounded-lg">
          <div className="font-semibold text-lg">{nodes.filter(n => n.service === 'backend').length}</div>
          <div className="text-muted-foreground">Backend Nodes</div>
        </div>
        <div className="p-3 bg-muted rounded-lg">
          <div className="font-semibold text-lg">{nodes.filter(n => n.service === 'qontinui-api').length}</div>
          <div className="text-muted-foreground">CV API Nodes</div>
        </div>
        <div className="p-3 bg-muted rounded-lg">
          <div className="font-semibold text-lg">{connections.length}</div>
          <div className="text-muted-foreground">Data Flows</div>
        </div>
      </div>
    </div>
  )
}
