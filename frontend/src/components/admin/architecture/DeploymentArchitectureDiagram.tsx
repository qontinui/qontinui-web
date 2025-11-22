'use client'

/**
 * Interactive Deployment Architecture Diagram
 *
 * Visual representation of development and production infrastructure,
 * including AWS services, Docker containers, and deployment pipelines
 */

import { useState } from 'react'

interface DeploymentNode {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  color: string
  type: 'frontend' | 'backend' | 'database' | 'storage' | 'infrastructure' | 'external'
  environment: 'dev' | 'prod' | 'both'
  description: string
}

interface DeploymentConnection {
  from: string
  to: string
  label?: string
  dashed?: boolean
}

const nodes: DeploymentNode[] = [
  // Frontend Layer
  {
    id: 'browser',
    name: 'Web Browser',
    x: 30,
    y: 30,
    width: 140,
    height: 70,
    color: '#EC4899',
    type: 'frontend',
    environment: 'both',
    description: 'User access point - Chrome, Firefox, Safari, Edge',
  },
  {
    id: 'vercel-cdn',
    name: 'Vercel CDN',
    x: 200,
    y: 30,
    width: 140,
    height: 70,
    color: '#EC4899',
    type: 'frontend',
    environment: 'prod',
    description: 'Production: https://qontinui.io - Next.js 14, Edge CDN, Automatic SSL, Preview Deployments',
  },
  {
    id: 'nextjs-dev',
    name: 'Next.js Dev',
    x: 370,
    y: 30,
    width: 140,
    height: 70,
    color: '#EC4899',
    type: 'frontend',
    environment: 'dev',
    description: 'Development: localhost:3001 - Turbopack, Hot Reload, Fast Refresh, API proxy to :8000',
  },

  // API Gateway / Load Balancer Layer
  {
    id: 'eb-alb',
    name: 'EB Load Balancer',
    x: 30,
    y: 140,
    width: 150,
    height: 70,
    color: '#F59E0B',
    type: 'infrastructure',
    environment: 'prod',
    description: 'Production ALB: qontinui-prod-py.eba-km2u4s23.eu-central-1.elasticbeanstalk.com - HTTPS (443), Health checks (/health)',
  },
  {
    id: 'nginx-proxy',
    name: 'Nginx Proxy',
    x: 200,
    y: 140,
    width: 140,
    height: 70,
    color: '#F59E0B',
    type: 'infrastructure',
    environment: 'both',
    description: '.platform/nginx/conf.d/timeout.conf - 120s timeouts, CORS, proxy_pass to Uvicorn',
  },
  {
    id: 'localhost',
    name: 'WSL2 Network',
    x: 360,
    y: 140,
    width: 150,
    height: 70,
    color: '#F59E0B',
    type: 'infrastructure',
    environment: 'dev',
    description: 'Development: 0.0.0.0 binding required for WSL2, accessible from Windows browser',
  },

  // Backend Services Layer
  {
    id: 'fastapi-prod',
    name: 'FastAPI (EB)',
    x: 30,
    y: 250,
    width: 140,
    height: 70,
    color: '#3B82F6',
    type: 'backend',
    environment: 'prod',
    description: 'Production: Docker + Uvicorn, Port 8000, Python 3.12, Poetry deps, Alembic migrations, SSL required',
  },
  {
    id: 'fastapi-dev',
    name: 'FastAPI (Local)',
    x: 190,
    y: 250,
    width: 140,
    height: 70,
    color: '#3B82F6',
    type: 'backend',
    environment: 'dev',
    description: 'Development: localhost:8000, --reload, DEBUG=True, poetry run python run.py',
  },
  {
    id: 'qontinui-api',
    name: 'Qontinui API',
    x: 350,
    y: 250,
    width: 140,
    height: 70,
    color: '#3B82F6',
    type: 'backend',
    environment: 'dev',
    description: 'Development: localhost:8001, Computer Vision, OpenCV, Pattern Matching (/find_all, /find_best)',
  },

  // Background Workers
  {
    id: 'arq-worker',
    name: 'ARQ Worker',
    x: 30,
    y: 360,
    width: 140,
    height: 65,
    color: '#8B5CF6',
    type: 'backend',
    environment: 'dev',
    description: 'run_worker.py - Background tasks: Email sending, Thumbnail generation, Async jobs (Not deployed to prod yet)',
  },
  {
    id: 'elasticache',
    name: 'ElastiCache Redis',
    x: 190,
    y: 360,
    width: 140,
    height: 65,
    color: '#8B5CF6',
    type: 'infrastructure',
    environment: 'prod',
    description: 'Planned: Multi-AZ, At-rest encryption, In-transit TLS, Session storage, Rate limiting, ARQ queue (REDIS_ENABLED=False currently)',
  },
  {
    id: 'redis-dev',
    name: 'Redis Docker',
    x: 350,
    y: 360,
    width: 140,
    height: 65,
    color: '#8B5CF6',
    type: 'infrastructure',
    environment: 'dev',
    description: 'Development: localhost:6379, redis:7-alpine, Health checks, Max memory 512MB, LRU eviction',
  },

  // Database Layer
  {
    id: 'rds-postgres',
    name: 'RDS PostgreSQL',
    x: 30,
    y: 465,
    width: 150,
    height: 75,
    color: '#10B981',
    type: 'database',
    environment: 'prod',
    description: 'Production: PostgreSQL 16, qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com, Multi-AZ, Auto backups (30d), SSL required, Connection pool (5+10)',
  },
  {
    id: 'postgres-dev',
    name: 'PostgreSQL Docker',
    x: 200,
    y: 465,
    width: 150,
    height: 75,
    color: '#10B981',
    type: 'database',
    environment: 'dev',
    description: 'Development: localhost:5432, postgres:15-alpine, qontinui_user/qontinui_db, Volume: postgres_data, Health checks',
  },
  {
    id: 'alembic',
    name: 'Alembic Migrations',
    x: 370,
    y: 465,
    width: 140,
    height: 75,
    color: '#10B981',
    type: 'database',
    environment: 'both',
    description: 'Database migrations: ./scripts/safe_migrate.sh (prevents multiple heads), alembic upgrade head, Version control',
  },

  // Object Storage Layer
  {
    id: 's3-prod',
    name: 'AWS S3',
    x: 30,
    y: 580,
    width: 140,
    height: 70,
    color: '#F59E0B',
    type: 'storage',
    environment: 'prod',
    description: 'Production: qontinui-production bucket, Presigned URLs (7d), Versioning, Lifecycle policies, IAM roles',
  },
  {
    id: 'minio-dev',
    name: 'MinIO Docker',
    x: 190,
    y: 580,
    width: 140,
    height: 70,
    color: '#F59E0B',
    type: 'storage',
    environment: 'dev',
    description: 'Development: localhost:9000, S3-compatible, Console :9001, Auto-bucket creation, Volume: minio_data',
  },
  {
    id: 'storage-service',
    name: 'Object Storage Service',
    x: 350,
    y: 580,
    width: 140,
    height: 70,
    color: '#F59E0B',
    type: 'storage',
    environment: 'both',
    description: 'app/services/object_storage.py - Unified interface for S3/MinIO/Local, boto3 client, Presigned URLs, Metadata tracking',
  },

  // External Services Layer
  {
    id: 'ses-email',
    name: 'AWS SES',
    x: 30,
    y: 690,
    width: 130,
    height: 65,
    color: '#EF4444',
    type: 'external',
    environment: 'prod',
    description: 'Production: eu-central-1, Verification emails, Password reset, Beta welcome, HTML templates, IAM auth',
  },
  {
    id: 'smtp-dev',
    name: 'SMTP Fallback',
    x: 180,
    y: 690,
    width: 130,
    height: 65,
    color: '#EF4444',
    type: 'external',
    environment: 'dev',
    description: 'Development: Port 587, TLS, Automatic fallback if SES fails, noreply@qontinui.com',
  },
  {
    id: 'stripe',
    name: 'Stripe API',
    x: 330,
    y: 690,
    width: 130,
    height: 65,
    color: '#EF4444',
    type: 'external',
    environment: 'both',
    description: 'Payment processing: Subscriptions, Webhooks, Customer Portal, Test/Prod keys, /api/v1/billing/*',
  },
]

const connections: DeploymentConnection[] = [
  // Frontend to API Gateway
  { from: 'browser', to: 'vercel-cdn', label: 'HTTPS' },
  { from: 'browser', to: 'nextjs-dev', label: 'HTTP' },
  { from: 'vercel-cdn', to: 'eb-alb', label: 'API calls' },
  { from: 'nextjs-dev', to: 'localhost', label: 'proxy' },

  // API Gateway to Backend
  { from: 'eb-alb', to: 'nginx-proxy', label: 'forward' },
  { from: 'localhost', to: 'nginx-proxy', label: 'route' },
  { from: 'nginx-proxy', to: 'fastapi-prod', label: 'proxy_pass' },
  { from: 'nginx-proxy', to: 'fastapi-dev', label: 'proxy_pass' },
  { from: 'localhost', to: 'qontinui-api', label: 'direct' },

  // Backend to Workers/Cache
  { from: 'fastapi-prod', to: 'elasticache', label: 'cache', dashed: true },
  { from: 'fastapi-dev', to: 'redis-dev', label: 'cache' },
  { from: 'fastapi-dev', to: 'arq-worker', label: 'enqueue' },
  { from: 'arq-worker', to: 'redis-dev', label: 'Redis queue' },

  // Backend to Database
  { from: 'fastapi-prod', to: 'rds-postgres', label: 'asyncpg SSL' },
  { from: 'fastapi-dev', to: 'postgres-dev', label: 'asyncpg' },
  { from: 'fastapi-prod', to: 'alembic', label: 'migrations' },
  { from: 'fastapi-dev', to: 'alembic', label: 'migrations' },
  { from: 'alembic', to: 'rds-postgres', label: 'upgrade' },
  { from: 'alembic', to: 'postgres-dev', label: 'upgrade' },

  // Backend to Object Storage
  { from: 'fastapi-prod', to: 's3-prod', label: 'boto3' },
  { from: 'fastapi-dev', to: 'minio-dev', label: 'boto3' },
  { from: 's3-prod', to: 'storage-service', label: 'interface' },
  { from: 'minio-dev', to: 'storage-service', label: 'interface' },
  { from: 'storage-service', to: 'rds-postgres', label: 'metadata' },
  { from: 'storage-service', to: 'postgres-dev', label: 'metadata' },

  // Backend to External Services
  { from: 'fastapi-prod', to: 'ses-email', label: 'SES API' },
  { from: 'fastapi-dev', to: 'smtp-dev', label: 'SMTP' },
  { from: 'fastapi-prod', to: 'stripe', label: 'webhooks' },
  { from: 'fastapi-dev', to: 'stripe', label: 'test mode' },

  // Frontend to Object Storage (Presigned URLs)
  { from: 'vercel-cdn', to: 's3-prod', label: 'presigned URLs', dashed: true },
  { from: 'nextjs-dev', to: 'minio-dev', label: 'presigned URLs', dashed: true },

  // Worker to External Services
  { from: 'arq-worker', to: 'smtp-dev', label: 'send email' },
]

export function DeploymentArchitectureDiagram() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [environmentFilter, setEnvironmentFilter] = useState<'all' | 'dev' | 'prod'>('all')

  const getNodeColor = (type: DeploymentNode['type']) => {
    switch (type) {
      case 'frontend': return { main: '#EC4899', hover: '#DB2777' }
      case 'backend': return { main: '#3B82F6', hover: '#2563EB' }
      case 'database': return { main: '#10B981', hover: '#059669' }
      case 'storage': return { main: '#F59E0B', hover: '#D97706' }
      case 'infrastructure': return { main: '#8B5CF6', hover: '#7C3AED' }
      case 'external': return { main: '#EF4444', hover: '#DC2626' }
    }
  }

  const isConnectionHighlighted = (conn: DeploymentConnection) => {
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

  const filteredNodes = nodes.filter(node => {
    if (environmentFilter === 'all') return true
    if (environmentFilter === 'dev') return node.environment === 'dev' || node.environment === 'both'
    if (environmentFilter === 'prod') return node.environment === 'prod' || node.environment === 'both'
    return true
  })

  const filteredConnections = connections.filter(conn => {
    const fromNode = nodes.find(n => n.id === conn.from)
    const toNode = nodes.find(n => n.id === conn.to)
    return filteredNodes.includes(fromNode!) && filteredNodes.includes(toNode!)
  })

  return (
    <div className="w-full h-full min-h-[900px] flex flex-col">
      {/* Legend and Filters */}
      <div className="mb-4">
        <div className="flex flex-wrap gap-4 text-sm mb-3">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#EC4899' }} />
            <span>Frontend</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#3B82F6' }} />
            <span>Backend Services</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#10B981' }} />
            <span>Database</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#F59E0B' }} />
            <span>Storage/Infrastructure</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#8B5CF6' }} />
            <span>Workers/Cache</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#EF4444' }} />
            <span>External Services</span>
          </div>
        </div>

        {/* Environment Filter */}
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => setEnvironmentFilter('all')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              environmentFilter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            All Environments
          </button>
          <button
            onClick={() => setEnvironmentFilter('dev')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              environmentFilter === 'dev'
                ? 'bg-blue-500 text-white'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            Development
          </button>
          <button
            onClick={() => setEnvironmentFilter('prod')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              environmentFilter === 'prod'
                ? 'bg-green-500 text-white'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            Production
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Based on actual deployment configuration - Includes AWS services, Docker containers, ports, and connection details.
          Dashed lines indicate direct browser-to-storage access via presigned URLs or planned features.
        </p>
      </div>

      {/* SVG Diagram */}
      <div className="flex-1 flex items-center justify-center">
        <svg viewBox="0 0 540 800" className="w-full h-full max-h-[900px]">
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

          {/* Layer Labels */}
          <text x="5" y="20" fill="#64748B" fontSize="12" fontWeight="600">Frontend Layer</text>
          <text x="5" y="130" fill="#64748B" fontSize="12" fontWeight="600">API Gateway</text>
          <text x="5" y="240" fill="#64748B" fontSize="12" fontWeight="600">Backend Services</text>
          <text x="5" y="350" fill="#64748B" fontSize="12" fontWeight="600">Workers & Cache</text>
          <text x="5" y="455" fill="#64748B" fontSize="12" fontWeight="600">Database Layer</text>
          <text x="5" y="570" fill="#64748B" fontSize="12" fontWeight="600">Object Storage</text>
          <text x="5" y="680" fill="#64748B" fontSize="12" fontWeight="600">External Services</text>

          {/* Connections */}
          <g>
            {filteredConnections.map((conn, idx) => {
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
            {filteredNodes.map((node) => {
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
                    y={node.y + node.height / 2 - 8}
                    fill="white"
                    fontSize="13"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {node.name}
                  </text>
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + node.height / 2 + 8}
                    fill="white"
                    fontSize="9"
                    opacity="0.8"
                    textAnchor="middle"
                  >
                    {node.environment === 'both' ? 'Dev + Prod' : node.environment === 'dev' ? 'Development' : 'Production'}
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
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">{nodes.find(n => n.id === selectedNode)?.name}</h3>
            <span className={`text-xs px-2 py-1 rounded ${
              nodes.find(n => n.id === selectedNode)?.environment === 'prod'
                ? 'bg-green-500 text-white'
                : nodes.find(n => n.id === selectedNode)?.environment === 'dev'
                ? 'bg-blue-500 text-white'
                : 'bg-purple-500 text-white'
            }`}>
              {nodes.find(n => n.id === selectedNode)?.environment === 'both'
                ? 'Dev + Prod'
                : nodes.find(n => n.id === selectedNode)?.environment === 'dev'
                ? 'Development'
                : 'Production'}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {nodes.find(n => n.id === selectedNode)?.description}
          </p>
        </div>
      )}
    </div>
  )
}
