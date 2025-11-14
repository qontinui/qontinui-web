'use client'

/**
 * Interactive Architecture Diagram Component
 *
 * Displays the Qontinui ecosystem components and their relationships
 */

import { ComponentType } from '@/app/(app)/admin/architecture/page'

interface ArchitectureDiagramProps {
  selectedComponent: ComponentType
  onComponentSelect: (component: ComponentType) => void
}

interface Component {
  id: ComponentType
  name: string
  x: number
  y: number
  width: number
  height: number
  color: string
  hoverColor: string
  type: 'library' | 'application' | 'service'
}

const components: Component[] = [
  // Core Libraries (Top Layer)
  {
    id: 'multistate',
    name: 'MultiState',
    x: 50,
    y: 50,
    width: 200,
    height: 100,
    color: '#3B82F6',
    hoverColor: '#2563EB',
    type: 'library',
  },
  {
    id: 'qontinui',
    name: 'Qontinui',
    x: 350,
    y: 50,
    width: 200,
    height: 100,
    color: '#3B82F6',
    hoverColor: '#2563EB',
    type: 'library',
  },
  // Applications (Middle Layer)
  {
    id: 'qontinui-runner',
    name: 'Qontinui Runner',
    x: 50,
    y: 220,
    width: 200,
    height: 100,
    color: '#10B981',
    hoverColor: '#059669',
    type: 'application',
  },
  {
    id: 'qontinui-web',
    name: 'Qontinui Web',
    x: 350,
    y: 220,
    width: 200,
    height: 100,
    color: '#10B981',
    hoverColor: '#059669',
    type: 'application',
  },
  // Services (Bottom Layer)
  {
    id: 'qontinui-api',
    name: 'Qontinui API',
    x: 200,
    y: 390,
    width: 200,
    height: 100,
    color: '#8B5CF6',
    hoverColor: '#7C3AED',
    type: 'service',
  },
]

interface Connection {
  from: { x: number; y: number }
  to: { x: number; y: number }
  label?: string
  dashed?: boolean
}

const connections: Connection[] = [
  // MultiState -> Qontinui
  { from: { x: 250, y: 100 }, to: { x: 350, y: 100 }, label: 'state mgmt' },
  // Qontinui -> Runner
  { from: { x: 350, y: 150 }, to: { x: 150, y: 220 }, label: 'execution' },
  // Qontinui -> Web (via API)
  { from: { x: 450, y: 150 }, to: { x: 450, y: 220 }, label: 'mock exec' },
  // Web -> API
  { from: { x: 450, y: 320 }, to: { x: 350, y: 390 }, label: 'REST API' },
  // API -> Runner (export configs)
  { from: { x: 250, y: 440 }, to: { x: 150, y: 320 }, label: 'configs', dashed: true },
]

export function ArchitectureDiagram({
  selectedComponent,
  onComponentSelect,
}: ArchitectureDiagramProps) {
  return (
    <div className="w-full h-full min-h-[600px] flex items-center justify-center">
      <svg
        viewBox="0 0 600 540"
        className="w-full h-full"
        style={{ maxHeight: '700px' }}
      >
        {/* Define arrow markers */}
        <defs>
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
            id="arrowhead-dashed"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 10 3, 0 6" fill="#94A3B8" />
          </marker>
        </defs>

        {/* Connections */}
        <g>
          {connections.map((conn, index) => (
            <g key={index}>
              <line
                x1={conn.from.x}
                y1={conn.from.y}
                x2={conn.to.x}
                y2={conn.to.y}
                stroke={conn.dashed ? '#94A3B8' : '#64748B'}
                strokeWidth="2"
                strokeDasharray={conn.dashed ? '5,5' : undefined}
                markerEnd={conn.dashed ? 'url(#arrowhead-dashed)' : 'url(#arrowhead)'}
              />
              {conn.label && (
                <text
                  x={(conn.from.x + conn.to.x) / 2}
                  y={(conn.from.y + conn.to.y) / 2 - 5}
                  fill="#64748B"
                  fontSize="12"
                  textAnchor="middle"
                  className="select-none"
                >
                  {conn.label}
                </text>
              )}
            </g>
          ))}
        </g>

        {/* Components */}
        <g>
          {components.map((component) => {
            const isSelected = selectedComponent === component.id
            const isHovered = false // We'll handle this with CSS

            return (
              <g
                key={component.id}
                onClick={() => onComponentSelect(component.id)}
                className="cursor-pointer transition-all"
                style={{ transformOrigin: `${component.x + component.width / 2}px ${component.y + component.height / 2}px` }}
              >
                {/* Shadow for selected */}
                {isSelected && (
                  <rect
                    x={component.x - 4}
                    y={component.y - 4}
                    width={component.width + 8}
                    height={component.height + 8}
                    rx="12"
                    fill="none"
                    stroke={component.color}
                    strokeWidth="3"
                    opacity="0.5"
                  />
                )}

                {/* Component box */}
                <rect
                  x={component.x}
                  y={component.y}
                  width={component.width}
                  height={component.height}
                  rx="8"
                  fill={isSelected ? component.hoverColor : component.color}
                  className="transition-all hover:brightness-110"
                  opacity={selectedComponent && !isSelected ? 0.5 : 1}
                />

                {/* Component name */}
                <text
                  x={component.x + component.width / 2}
                  y={component.y + component.height / 2 - 10}
                  fill="white"
                  fontSize="18"
                  fontWeight="600"
                  textAnchor="middle"
                  className="select-none pointer-events-none"
                >
                  {component.name}
                </text>

                {/* Component type badge */}
                <text
                  x={component.x + component.width / 2}
                  y={component.y + component.height / 2 + 15}
                  fill="white"
                  fontSize="12"
                  opacity="0.9"
                  textAnchor="middle"
                  className="select-none pointer-events-none"
                >
                  {component.type === 'library' && '📚 Core Library'}
                  {component.type === 'application' && '🖥️ Application'}
                  {component.type === 'service' && '⚙️ Service'}
                </text>

                {/* Hover effect indicator */}
                {isSelected && (
                  <text
                    x={component.x + component.width / 2}
                    y={component.y - 15}
                    fill={component.color}
                    fontSize="12"
                    fontWeight="600"
                    textAnchor="middle"
                    className="select-none animate-pulse"
                  >
                    ▼ Selected
                  </text>
                )}
              </g>
            )
          })}
        </g>

        {/* Legend */}
        <g transform="translate(20, 500)">
          <text x="0" y="0" fill="currentColor" fontSize="14" fontWeight="600">
            Legend:
          </text>
          <rect x="0" y="8" width="20" height="12" rx="2" fill="#3B82F6" />
          <text x="25" y="18" fill="currentColor" fontSize="12">
            Core Library
          </text>
          <rect x="120" y="8" width="20" height="12" rx="2" fill="#10B981" />
          <text x="145" y="18" fill="currentColor" fontSize="12">
            Application
          </text>
          <rect x="240" y="8" width="20" height="12" rx="2" fill="#8B5CF6" />
          <text x="265" y="18" fill="currentColor" fontSize="12">
            Service
          </text>
        </g>
      </svg>
    </div>
  )
}
