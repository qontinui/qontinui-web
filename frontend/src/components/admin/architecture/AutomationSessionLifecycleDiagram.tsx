'use client'

/**
 * Interactive Automation Session Lifecycle Diagram
 *
 * Visual representation of the complete automation session lifecycle from
 * initiation to completion, including all system components and data flows.
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
  type: 'ui' | 'backend' | 'api' | 'storage' | 'realtime' | 'desktop'
  description: string
}

interface WorkflowConnection {
  from: string
  to: string
  label?: string
  dashed?: boolean
}

const nodes: WorkflowNode[] = [
  // ========== LAYER 1: User Interaction ==========
  {
    id: 'frontend-ui',
    name: 'Frontend UI',
    x: 50,
    y: 30,
    width: 130,
    height: 65,
    color: '#EC4899',
    type: 'ui',
    description: 'frontend/src/components/ExecutionDebugger - User initiates workflow execution via Play button. ExecutionStore manages state.',
  },
  {
    id: 'desktop-runner',
    name: 'Desktop Runner',
    x: 200,
    y: 30,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'desktop',
    description: 'External desktop client connects to backend WebSocket with JWT or Runner Token authentication',
  },

  // ========== LAYER 2: API Gateway ==========
  {
    id: 'backend-rest',
    name: 'Backend REST',
    x: 50,
    y: 130,
    width: 130,
    height: 65,
    color: '#3B82F6',
    type: 'backend',
    description: 'backend/app/api/v1/endpoints/automation.py - REST API for session queries, history, timeline, image recognition reports',
  },
  {
    id: 'backend-ws',
    name: 'Backend WebSocket',
    x: 200,
    y: 130,
    width: 130,
    height: 65,
    color: '#3B82F6',
    type: 'backend',
    description: 'backend/app/api/v1/endpoints/automation_ws.py - /api/v1/ws/automation/runner endpoint for streaming logs, screenshots, input events',
  },

  // ========== LAYER 3: Session Management ==========
  {
    id: 'session-creation',
    name: 'Session Creation',
    x: 50,
    y: 230,
    width: 130,
    height: 65,
    color: '#F59E0B',
    type: 'backend',
    description: 'AutomationSession created with status=active, runner_version, OS, hostname, configuration_snapshot stored in DB',
  },
  {
    id: 'auth-validation',
    name: 'Auth Validation',
    x: 200,
    y: 230,
    width: 130,
    height: 65,
    color: '#F59E0B',
    type: 'backend',
    description: 'authenticate_runner() validates JWT/Runner Token, checks automation_streaming_enabled, validates monthly session limit',
  },

  // ========== LAYER 4: Real-Time Streaming ==========
  {
    id: 'log-stream',
    name: 'Log Streaming',
    x: 20,
    y: 330,
    width: 110,
    height: 65,
    color: '#8B5CF6',
    type: 'realtime',
    description: 'AutomationLog records with sequence_number, level (DEBUG/INFO/WARNING/ERROR), message, log_data JSONB, timestamp',
  },
  {
    id: 'screenshot-stream',
    name: 'Screenshot Stream',
    x: 145,
    y: 330,
    width: 110,
    height: 65,
    color: '#8B5CF6',
    type: 'realtime',
    description: 'Base64 image → validate MIME/magic bytes → PIL dimension extraction → S3 upload → AutomationScreenshot record → presigned URL (7-day)',
  },
  {
    id: 'input-stream',
    name: 'Input Events',
    x: 270,
    y: 330,
    width: 110,
    height: 65,
    color: '#8B5CF6',
    type: 'realtime',
    description: 'AutomationInputEvent: mouse.clicked/moved/dragged, keyboard.text_typed with coordinates, screenshots linked within ±2.5 seconds',
  },

  // ========== LAYER 5: Pattern Matching ==========
  {
    id: 'qontinui-api',
    name: 'Qontinui API',
    x: 400,
    y: 230,
    width: 130,
    height: 65,
    color: '#10B981',
    type: 'api',
    description: 'qontinui-api:8001 - Real CV pattern matching with FindExecutor, TemplateMatcher, SimilarityFilter, NMS. State detection and mock execution',
  },
  {
    id: 'pattern-match',
    name: 'Pattern Matching',
    x: 400,
    y: 330,
    width: 130,
    height: 65,
    color: '#10B981',
    type: 'api',
    description: 'POST /find, /find_all - OpenCV TM_CCOEFF_NORMED template matching with confidence threshold (default 0.8), returns region, score, center',
  },

  // ========== LAYER 6: Data Persistence ==========
  {
    id: 'postgres',
    name: 'PostgreSQL',
    x: 50,
    y: 430,
    width: 110,
    height: 65,
    color: '#10B981',
    type: 'storage',
    description: 'automation_sessions, automation_logs, automation_screenshots, automation_input_events, screenshot_input_associations with cascade deletes',
  },
  {
    id: 's3-storage',
    name: 'S3 Storage',
    x: 175,
    y: 430,
    width: 110,
    height: 65,
    color: '#10B981',
    type: 'storage',
    description: 'S3 key: automation/{user_id}/{session_id}/{screenshot_id}.{ext} - Stores screenshots with metadata, presigned URLs for 7-day access',
  },
  {
    id: 'redis-pubsub',
    name: 'Redis Pub/Sub',
    x: 300,
    y: 430,
    width: 110,
    height: 65,
    color: '#10B981',
    type: 'storage',
    description: 'WebSocket horizontal scaling via Pub/Sub channels: automation_session:{id}, automation_runner:{user_id}. Tracks connections across instances',
  },

  // ========== LAYER 7: Real-Time Updates ==========
  {
    id: 'frontend-ws',
    name: 'Frontend WebSocket',
    x: 50,
    y: 530,
    width: 130,
    height: 65,
    color: '#EC4899',
    type: 'realtime',
    description: 'frontend/src/services/execution-websocket.ts - Auto-reconnection, heartbeat (30s), message queue (max 100), exponential backoff (1s→30s)',
  },
  {
    id: 'frontend-polling',
    name: 'Polling Fallback',
    x: 200,
    y: 530,
    width: 130,
    height: 65,
    color: '#EC4899',
    type: 'realtime',
    description: 'execution-store.ts startPolling() - 1-second interval if WebSocket unavailable, getExecutionStatus() for status updates',
  },

  // ========== LAYER 8: Session Completion ==========
  {
    id: 'session-end',
    name: 'Session End',
    x: 400,
    y: 430,
    width: 130,
    height: 65,
    color: '#F59E0B',
    type: 'backend',
    description: 'session_end message updates status (completed/failed), sets ended_at timestamp, closes RunnerConnection record with duration',
  },
  {
    id: 'history-analytics',
    name: 'History & Analytics',
    x: 400,
    y: 530,
    width: 130,
    height: 65,
    color: '#F59E0B',
    type: 'backend',
    description: 'GET /api/v1/automation/sessions - Query completed sessions. Timeline merges logs+screenshots. Image recognition reports aggregate success rates',
  },

  // ========== LAYER 9: Monitoring ==========
  {
    id: 'monitor-ws',
    name: 'Monitor WebSocket',
    x: 560,
    y: 230,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'realtime',
    description: '/api/v1/ws/automation/monitor/{session_id} - Real-time monitoring of active sessions via Redis Pub/Sub for multi-instance support',
  },
  {
    id: 'debugger-ui',
    name: 'Execution Debugger',
    x: 560,
    y: 330,
    width: 130,
    height: 65,
    color: '#EC4899',
    type: 'ui',
    description: 'frontend/src/components/ExecutionDebugger - Step-through debugging, breakpoints, variable inspector, action timeline, execution logs',
  },
]

const connections: WorkflowConnection[] = [
  // User initiates execution
  { from: 'frontend-ui', to: 'backend-rest', label: 'Execute Workflow', dashed: false },
  { from: 'desktop-runner', to: 'backend-ws', label: 'Connect WS', dashed: false },

  // Authentication and session setup
  { from: 'backend-ws', to: 'auth-validation', label: 'Authenticate', dashed: false },
  { from: 'auth-validation', to: 'session-creation', label: 'Create Session', dashed: false },
  { from: 'backend-rest', to: 'session-creation', label: 'Start Session', dashed: false },

  // Real-time streaming
  { from: 'backend-ws', to: 'log-stream', label: 'Log Events', dashed: false },
  { from: 'backend-ws', to: 'screenshot-stream', label: 'Screenshots', dashed: false },
  { from: 'backend-ws', to: 'input-stream', label: 'Input Events', dashed: false },

  // Pattern matching integration
  { from: 'screenshot-stream', to: 'qontinui-api', label: 'Find Pattern', dashed: false },
  { from: 'qontinui-api', to: 'pattern-match', label: 'Execute Match', dashed: false },
  { from: 'pattern-match', to: 'qontinui-api', label: 'Match Results', dashed: false },

  // Data persistence
  { from: 'log-stream', to: 'postgres', label: 'Store Logs', dashed: false },
  { from: 'screenshot-stream', to: 's3-storage', label: 'Upload Image', dashed: false },
  { from: 'screenshot-stream', to: 'postgres', label: 'Store Metadata', dashed: false },
  { from: 'input-stream', to: 'postgres', label: 'Store Events', dashed: false },

  // Session management
  { from: 'session-creation', to: 'postgres', label: 'Create Record', dashed: false },
  { from: 'session-end', to: 'postgres', label: 'Update Status', dashed: false },

  // Real-time updates to frontend
  { from: 'backend-ws', to: 'redis-pubsub', label: 'Broadcast Events', dashed: false },
  { from: 'redis-pubsub', to: 'frontend-ws', label: 'Stream Updates', dashed: false },
  { from: 'frontend-ws', to: 'frontend-ui', label: 'Update UI', dashed: false },

  // Fallback polling
  { from: 'frontend-polling', to: 'backend-rest', label: 'Poll Status', dashed: true },
  { from: 'backend-rest', to: 'postgres', label: 'Query Sessions', dashed: false },

  // Monitoring
  { from: 'backend-ws', to: 'monitor-ws', label: 'Session Events', dashed: false },
  { from: 'monitor-ws', to: 'debugger-ui', label: 'Real-time Updates', dashed: false },
  { from: 'debugger-ui', to: 'backend-rest', label: 'Control Commands', dashed: false },

  // Session completion
  { from: 'session-creation', to: 'session-end', label: 'Lifecycle', dashed: true },
  { from: 'session-end', to: 'history-analytics', label: 'Archive', dashed: false },
  { from: 'history-analytics', to: 'postgres', label: 'Query History', dashed: false },
]

export function AutomationSessionLifecycleDiagram() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  const getNodeColor = (type: WorkflowNode['type']) => {
    switch (type) {
      case 'ui':
        return { main: '#EC4899', hover: '#DB2777' }
      case 'backend':
        return { main: '#3B82F6', hover: '#2563EB' }
      case 'api':
        return { main: '#10B981', hover: '#059669' }
      case 'storage':
        return { main: '#10B981', hover: '#059669' }
      case 'realtime':
        return { main: '#8B5CF6', hover: '#7C3AED' }
      case 'desktop':
        return { main: '#8B5CF6', hover: '#7C3AED' }
      default:
        return { main: '#64748B', hover: '#475569' }
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
      .filter((c) => c.from === active || c.to === active)
      .flatMap((c) => [c.from, c.to])

    return !relatedNodes.includes(nodeId)
  }

  return (
    <div className="w-full h-full min-h-[900px] flex flex-col">
      {/* Legend */}
      <div className="mb-4">
        <div className="flex flex-wrap gap-4 text-sm mb-2">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#EC4899' }} />
            <span>Frontend UI</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#8B5CF6' }} />
            <span>Desktop Runner / Real-Time</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#3B82F6' }} />
            <span>Backend API</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#10B981' }} />
            <span>Storage / Qontinui API</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#F59E0B' }} />
            <span>Session Management</span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Click on a component to see details. Hover to highlight related components.
        </p>
      </div>

      {/* SVG Diagram */}
      <div className="flex-1 flex items-center justify-center">
        <svg viewBox="0 0 720 630" className="w-full h-full max-h-[900px]">
          <defs>
            <filter id="shadow">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.3" />
            </filter>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 10 3, 0 6" fill="#64748B" />
            </marker>
            <marker
              id="arrowhead-active"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 10 3, 0 6" fill="#3B82F6" />
            </marker>
          </defs>

          {/* Connections */}
          <g>
            {connections.map((conn, idx) => {
              const fromNode = nodes.find((n) => n.id === conn.from)
              const toNode = nodes.find((n) => n.id === conn.to)
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
                    markerEnd={
                      isHighlighted ? 'url(#arrowhead-active)' : 'url(#arrowhead)'
                    }
                    opacity={hoveredNode && !isHighlighted ? 0.3 : 1}
                  />
                  {conn.label && (
                    <text
                      x={(fromX + toX) / 2}
                      y={(fromY + toY) / 2}
                      fill={isHighlighted ? '#3B82F6' : '#64748B'}
                      fontSize="10"
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
                  onClick={() =>
                    setSelectedNode(node.id === selectedNode ? null : node.id)
                  }
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
                    fontSize="13"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {node.name}
                  </text>
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + node.height / 2 + 12}
                    fill="white"
                    fontSize="9"
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
          <h3 className="font-semibold mb-2">
            {nodes.find((n) => n.id === selectedNode)?.name}
          </h3>
          <p className="text-sm text-muted-foreground">
            {nodes.find((n) => n.id === selectedNode)?.description}
          </p>
        </div>
      )}
    </div>
  )
}
