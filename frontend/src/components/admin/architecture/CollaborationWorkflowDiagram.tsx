'use client'

/**
 * Interactive Multi-User Collaboration Architecture Diagram
 *
 * Visual representation of real-time collaboration, permissions, and conflict management
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
  type: 'ui' | 'websocket' | 'service' | 'database' | 'external'
  description: string
}

interface WorkflowConnection {
  from: string
  to: string
  label?: string
  dashed?: boolean
}

const nodes: WorkflowNode[] = [
  // UI Components Layer
  {
    id: 'org-switcher',
    name: 'Org Switcher',
    x: 20,
    y: 30,
    width: 120,
    height: 60,
    color: '#EC4899',
    type: 'ui',
    description: 'OrganizationSwitcher.tsx - Switch between organizations with member counts',
  },
  {
    id: 'share-dialog',
    name: 'Share Dialog',
    x: 160,
    y: 30,
    width: 120,
    height: 60,
    color: '#EC4899',
    type: 'ui',
    description: 'ProjectSharingDialog.tsx - Share with users/organizations, permission levels (view/comment/edit/admin/owner), expiration',
  },
  {
    id: 'team-list',
    name: 'Team Members',
    x: 300,
    y: 30,
    width: 120,
    height: 60,
    color: '#EC4899',
    type: 'ui',
    description: 'TeamMemberList.tsx - Search, role management, pagination, invite button',
  },
  {
    id: 'presence-ui',
    name: 'Presence UI',
    x: 440,
    y: 30,
    width: 120,
    height: 60,
    color: '#EC4899',
    type: 'ui',
    description: 'PresenceIndicator.tsx - Active/idle users, status badges, cursor indicators',
  },
  {
    id: 'lock-banner',
    name: 'Lock Banner',
    x: 20,
    y: 120,
    width: 120,
    height: 60,
    color: '#EC4899',
    type: 'ui',
    description: 'EditLockBanner.tsx - Alert when resource locked, countdown timer, request access',
  },
  {
    id: 'comment-thread',
    name: 'Comments',
    x: 160,
    y: 120,
    width: 120,
    height: 60,
    color: '#EC4899',
    type: 'ui',
    description: 'CommentThread.tsx - Threaded replies, mentions, resolve/reopen, edit/delete',
  },
  {
    id: 'activity-feed',
    name: 'Activity Feed',
    x: 300,
    y: 120,
    width: 120,
    height: 60,
    color: '#EC4899',
    type: 'ui',
    description: 'ActivityFeed.tsx - Timeline with filtering by user/action/resource type',
  },
  {
    id: 'conflict-dialog',
    name: 'Conflict Dialog',
    x: 440,
    y: 120,
    width: 120,
    height: 60,
    color: '#EC4899',
    type: 'ui',
    description: 'ConflictResolutionDialog.tsx - Split/unified diff view, manual merge, local/remote wins',
  },

  // WebSocket Layer
  {
    id: 'collab-ws',
    name: 'Collaboration WS',
    x: 80,
    y: 220,
    width: 140,
    height: 70,
    color: '#3B82F6',
    type: 'websocket',
    description: '/ws/projects/{id}/collaboration - Real-time presence, cursor tracking, lock notifications, comment broadcasting',
  },
  {
    id: 'ws-manager',
    name: 'Connection Manager',
    x: 240,
    y: 220,
    width: 140,
    height: 70,
    color: '#3B82F6',
    type: 'websocket',
    description: 'websocket_manager.py - Per-project connection pools, rate limiting (60 msg/min), heartbeat (120s timeout)',
  },
  {
    id: 'automation-collab-ws',
    name: 'Automation WS',
    x: 400,
    y: 220,
    width: 140,
    height: 70,
    color: '#3B82F6',
    type: 'websocket',
    description: '/ws/automation/runner - Session streaming, screenshot capture, input event tracking',
  },

  // Service Layer
  {
    id: 'permission-service',
    name: 'Permission Service',
    x: 20,
    y: 330,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'service',
    description: 'permission_service.py - Hierarchical access checks (owner→direct→org), 4 permission levels (view/comment/edit/admin)',
  },
  {
    id: 'lock-service',
    name: 'Distributed Locks',
    x: 170,
    y: 330,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'service',
    description: 'distributed_lock_service.py - Redis-backed distributed locks with PostgreSQL fallback, atomic SETNX operations, 5-30 min TTL, heartbeat refresh',
  },
  {
    id: 'comment-service',
    name: 'Comment Service',
    x: 320,
    y: 330,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'service',
    description: 'collaboration_service.py - CRUD comments, threading, mentions, resolve/reopen',
  },
  {
    id: 'activity-service',
    name: 'Activity Service',
    x: 470,
    y: 330,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'service',
    description: 'collaboration_service.py - Log actions (created/modified/deleted/shared/commented/locked/unlocked/viewed/exported/imported)',
  },
  {
    id: 'conflict-service',
    name: 'Conflict Resolution',
    x: 20,
    y: 415,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'service',
    description: 'conflict_resolution_service.py - 3-way merge algorithm (base/local/remote), automatic conflict detection, 5 REST endpoints for resolution',
  },
  {
    id: 'notification-service',
    name: 'Notification Service',
    x: 170,
    y: 415,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'service',
    description: 'notification_service.py - Email + WebSocket delivery, mention/share/comment/lock notifications, user preferences, read/unread tracking',
  },
  {
    id: 'version-service',
    name: 'Version History',
    x: 320,
    y: 415,
    width: 130,
    height: 65,
    color: '#8B5CF6',
    type: 'service',
    description: 'version_history_service.py + event_sourcing_service.py - Full snapshots, event sourcing command log, version comparison, rollback support',
  },

  // Database Layer
  {
    id: 'organizations-db',
    name: 'Organizations',
    x: 20,
    y: 520,
    width: 110,
    height: 60,
    color: '#10B981',
    type: 'database',
    description: 'organizations table - name, slug, owner_id, settings, is_active',
  },
  {
    id: 'team-members-db',
    name: 'Team Members',
    x: 150,
    y: 520,
    width: 110,
    height: 60,
    color: '#10B981',
    type: 'database',
    description: 'team_members - org+user unique constraint, roles (owner/admin/member/viewer), invited_by',
  },
  {
    id: 'project-access-db',
    name: 'Project Access',
    x: 280,
    y: 520,
    width: 110,
    height: 60,
    color: '#10B981',
    type: 'database',
    description: 'project_access_control - user_id XOR organization_id, permission_level, expires_at',
  },
  {
    id: 'invitations-db',
    name: 'Invitations',
    x: 410,
    y: 520,
    width: 110,
    height: 60,
    color: '#10B981',
    type: 'database',
    description: 'organization_invitations - email, role, token (32-char secure), 7-day expiration',
  },
  {
    id: 'projects-db',
    name: 'Projects (v)',
    x: 540,
    y: 520,
    width: 110,
    height: 60,
    color: '#10B981',
    type: 'database',
    description: 'projects table - Added version column for optimistic locking, auto-incremented on every update',
  },
  {
    id: 'locks-db',
    name: 'Project Locks',
    x: 20,
    y: 605,
    width: 110,
    height: 60,
    color: '#10B981',
    type: 'database',
    description: 'project_locks - resource_type/id, user_id, acquired_at, expires_at, auto_release, metadata, SELECT FOR UPDATE',
  },
  {
    id: 'comments-db',
    name: 'Comments',
    x: 150,
    y: 605,
    width: 110,
    height: 60,
    color: '#10B981',
    type: 'database',
    description: 'project_comments - threaded (parent_id), position {x,y}, mentions[], resolved, resolved_by',
  },
  {
    id: 'activity-db',
    name: 'Activity Logs',
    x: 280,
    y: 605,
    width: 110,
    height: 60,
    color: '#10B981',
    type: 'database',
    description: 'activity_logs - action_type, resource_type/id, changes JSON, indexed by (project_id, created_at)',
  },
  {
    id: 'sessions-db',
    name: 'Session Activity',
    x: 410,
    y: 605,
    width: 110,
    height: 60,
    color: '#10B981',
    type: 'database',
    description: 'session_activities - jti (JWT ID), first_login_at, last_activity_at, absolute_expiry_at',
  },
  {
    id: 'conflicts-db',
    name: 'Conflict Logs',
    x: 20,
    y: 690,
    width: 110,
    height: 60,
    color: '#10B981',
    type: 'database',
    description: 'conflict_logs - resource_type/id, local/remote/base versions, changes[], resolved, resolution_type (local/remote/merge)',
  },
  {
    id: 'notifications-db',
    name: 'Notifications',
    x: 150,
    y: 690,
    width: 110,
    height: 60,
    color: '#10B981',
    type: 'database',
    description: 'notifications - type (mention/share/comment/reply/lock_released), is_read, metadata, notification_preferences for user settings',
  },
  {
    id: 'versions-db',
    name: 'Project Versions',
    x: 280,
    y: 690,
    width: 110,
    height: 60,
    color: '#10B981',
    type: 'database',
    description: 'project_versions - version_number, snapshot (full state JSON), created_at, created_by. Unique constraint on (project_id, version_number)',
  },
  {
    id: 'commands-db',
    name: 'Edit Commands',
    x: 410,
    y: 690,
    width: 110,
    height: 60,
    color: '#10B981',
    type: 'database',
    description: 'edit_commands - sequence_number, command_type (update/create/delete), payload JSON. Event sourcing log with unique (project_id, sequence)',
  },

  // External/Integration Layer
  {
    id: 'email-service',
    name: 'Email (AWS SES)',
    x: 100,
    y: 785,
    width: 140,
    height: 60,
    color: '#F59E0B',
    type: 'external',
    description: 'aiosmtplib + AWS SES - Send invitations, share notifications, mention alerts, lock release notifications',
  },
  {
    id: 'redis-cache',
    name: 'Redis',
    x: 270,
    y: 785,
    width: 140,
    height: 60,
    color: '#F59E0B',
    type: 'external',
    description: 'redis - Distributed locks (SETNX), session storage, rate limiting, WebSocket connection state, message sequencing',
  },
  {
    id: 'websocket-sequencing',
    name: 'WS Sequencing',
    x: 440,
    y: 785,
    width: 140,
    height: 60,
    color: '#F59E0B',
    type: 'external',
    description: 'Message sequence tracking, out-of-order buffering, automatic gap detection, acknowledgments, resend mechanism',
  },
]

const connections: WorkflowConnection[] = [
  // UI to WebSocket
  { from: 'org-switcher', to: 'collab-ws', label: 'connect' },
  { from: 'presence-ui', to: 'collab-ws', label: 'cursor/status' },
  { from: 'lock-banner', to: 'collab-ws', label: 'lock events' },
  { from: 'comment-thread', to: 'collab-ws', label: 'broadcast' },
  { from: 'activity-feed', to: 'collab-ws', label: 'subscribe' },
  { from: 'conflict-dialog', to: 'conflict-service', label: 'resolve' },

  // UI to Services (REST API)
  { from: 'share-dialog', to: 'permission-service', label: 'grant access' },
  { from: 'team-list', to: 'permission-service', label: 'manage roles' },
  { from: 'lock-banner', to: 'lock-service', label: 'acquire/release' },
  { from: 'comment-thread', to: 'comment-service', label: 'CRUD' },
  { from: 'activity-feed', to: 'activity-service', label: 'fetch' },

  // WebSocket to Connection Manager
  { from: 'collab-ws', to: 'ws-manager', label: 'pool' },
  { from: 'automation-collab-ws', to: 'ws-manager', label: 'pool' },

  // Connection Manager to Services
  { from: 'ws-manager', to: 'lock-service', label: 'notify' },
  { from: 'ws-manager', to: 'comment-service', label: 'broadcast' },
  { from: 'ws-manager', to: 'activity-service', label: 'stream' },
  { from: 'ws-manager', to: 'notification-service', label: 'push' },
  { from: 'ws-manager', to: 'websocket-sequencing', label: 'sequence' },

  // Services to Database
  { from: 'permission-service', to: 'organizations-db', label: 'check org' },
  { from: 'permission-service', to: 'team-members-db', label: 'check role' },
  { from: 'permission-service', to: 'project-access-db', label: 'check access' },
  { from: 'lock-service', to: 'locks-db', label: 'atomic ops' },
  { from: 'lock-service', to: 'redis-cache', label: 'SETNX' },
  { from: 'comment-service', to: 'comments-db', label: 'CRUD' },
  { from: 'activity-service', to: 'activity-db', label: 'append' },
  { from: 'conflict-service', to: 'conflicts-db', label: 'log/resolve' },
  { from: 'conflict-service', to: 'projects-db', label: 'check version' },
  { from: 'notification-service', to: 'notifications-db', label: 'create/read' },
  { from: 'notification-service', to: 'email-service', label: 'send' },
  { from: 'version-service', to: 'versions-db', label: 'snapshot' },
  { from: 'version-service', to: 'commands-db', label: 'log commands' },
  { from: 'version-service', to: 'projects-db', label: 'restore' },

  // Database Internal Relationships
  { from: 'organizations-db', to: 'team-members-db', label: 'FK' },
  { from: 'organizations-db', to: 'invitations-db', label: 'FK' },
  { from: 'organizations-db', to: 'project-access-db', label: 'FK' },
  { from: 'team-members-db', to: 'project-access-db', label: 'inherit', dashed: true },
  { from: 'projects-db', to: 'versions-db', label: 'FK' },
  { from: 'projects-db', to: 'commands-db', label: 'FK' },
  { from: 'projects-db', to: 'conflicts-db', label: 'FK' },

  // External Integrations
  { from: 'permission-service', to: 'email-service', label: 'invite' },
  { from: 'comment-service', to: 'notification-service', label: 'mention' },
  { from: 'ws-manager', to: 'redis-cache', label: 'rate limit' },
  { from: 'collab-ws', to: 'sessions-db', label: 'track' },

  // Feedback Loops
  { from: 'activity-db', to: 'activity-feed', label: 'real-time', dashed: true },
  { from: 'locks-db', to: 'lock-banner', label: 'status', dashed: true },
  { from: 'comments-db', to: 'comment-thread', label: 'load', dashed: true },
  { from: 'notifications-db', to: 'collab-ws', label: 'broadcast', dashed: true },
]

export function CollaborationWorkflowDiagram() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  const getNodeColor = (type: WorkflowNode['type']) => {
    switch (type) {
      case 'ui': return { main: '#EC4899', hover: '#DB2777' }
      case 'websocket': return { main: '#3B82F6', hover: '#2563EB' }
      case 'service': return { main: '#8B5CF6', hover: '#7C3AED' }
      case 'database': return { main: '#10B981', hover: '#059669' }
      case 'external': return { main: '#F59E0B', hover: '#D97706' }
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
    <div className="w-full h-full min-h-[900px] flex flex-col">
      {/* Legend */}
      <div className="mb-4">
        <div className="flex flex-wrap gap-4 text-sm mb-2">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#EC4899' }} />
            <span>UI Components</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#3B82F6' }} />
            <span>WebSocket/Real-Time</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#8B5CF6' }} />
            <span>Backend Services</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#10B981' }} />
            <span>Database Models</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#F59E0B' }} />
            <span>External/Integration</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Production-ready implementation - 3 WebSocket endpoints, 14 collaboration tables, 7 backend services, 4 permission levels, 4 team roles. Dashed lines indicate background processes or inheritance.
        </p>
        <p className="text-xs text-green-600 dark:text-green-500 font-semibold mt-1">
          ✅ All critical improvements implemented: 3-way merge conflict detection, distributed locks with Redis, version tracking & history, notification system, WebSocket message sequencing, and atomic lock operations
        </p>
      </div>

      {/* SVG Diagram */}
      <div className="flex-1 flex items-center justify-center">
        <svg viewBox="0 0 680 880" className="w-full h-full max-h-[900px]">
          <defs>
            <filter id="shadow-collab">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.3" />
            </filter>
            <marker id="arrowhead-collab" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
              <polygon points="0 0, 10 3, 0 6" fill="#64748B" />
            </marker>
            <marker id="arrowhead-active-collab" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
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
                    markerEnd={isHighlighted ? 'url(#arrowhead-active-collab)' : 'url(#arrowhead-collab)'}
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
                    filter="url(#shadow-collab)"
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
          <h3 className="font-semibold mb-2">{nodes.find(n => n.id === selectedNode)?.name}</h3>
          <p className="text-sm text-muted-foreground">
            {nodes.find(n => n.id === selectedNode)?.description}
          </p>
        </div>
      )}
    </div>
  )
}
