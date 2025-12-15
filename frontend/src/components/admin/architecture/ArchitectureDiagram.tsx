"use client";

/**
 * Interactive Architecture Diagram Component
 *
 * Enhanced visualization with hover tooltips, animations, and relationship highlighting
 */

import { useState } from "react";
import { ComponentType } from "@/app/(app)/admin/architecture/page";

// Define ArchitectureLevel locally since it&apos;s only used by this component
export type ArchitectureLevel =
  | "root"
  | "qontinui-web"
  | "qontinui-api"
  | "qontinui-runner"
  | "qontinui"
  | "multistate";

interface ArchitectureDiagramProps {
  selectedComponent: ComponentType;
  onComponentSelect: (component: ComponentType) => void;
  currentLevel?: ArchitectureLevel;
  onDrillDown?: (component: ComponentType) => void;
}

interface Component {
  id: ComponentType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  hoverColor: string;
  type:
    | "library"
    | "application"
    | "service"
    | "frontend"
    | "backend"
    | "component"
    | "ui"
    | "api"
    | "database";
  shortDesc: string;
  dependencies: ComponentType[];
  dependents: ComponentType[];
  hasDrillDown?: boolean;
}

// Root level architecture
const rootComponents: Component[] = [
  // Core Libraries (Top Layer)
  {
    id: "multistate",
    name: "MultiState",
    x: 50,
    y: 50,
    width: 200,
    height: 100,
    color: "#3B82F6",
    hoverColor: "#2563EB",
    type: "library",
    shortDesc: "Simultaneous state management",
    dependencies: [],
    dependents: ["qontinui"],
    hasDrillDown: true,
  },
  {
    id: "qontinui",
    name: "Qontinui",
    x: 350,
    y: 50,
    width: 200,
    height: 100,
    color: "#3B82F6",
    hoverColor: "#2563EB",
    type: "library",
    shortDesc: "GUI automation engine",
    dependencies: ["multistate"],
    dependents: ["qontinui-runner", "qontinui-web"],
    hasDrillDown: true,
  },
  // Applications (Middle Layer)
  {
    id: "qontinui-runner",
    name: "Qontinui Runner",
    x: 50,
    y: 220,
    width: 200,
    height: 100,
    color: "#10B981",
    hoverColor: "#059669",
    type: "application",
    shortDesc: "Desktop automation executor",
    dependencies: ["qontinui", "qontinui-api"],
    dependents: [],
    hasDrillDown: true,
  },
  {
    id: "qontinui-web",
    name: "Qontinui Web",
    x: 350,
    y: 220,
    width: 200,
    height: 100,
    color: "#10B981",
    hoverColor: "#059669",
    type: "application",
    shortDesc: "Web-based visual builder",
    dependencies: ["qontinui", "qontinui-api"],
    dependents: [],
    hasDrillDown: true,
  },
  // Services (Bottom Layer)
  {
    id: "qontinui-api",
    name: "Qontinui API",
    x: 200,
    y: 390,
    width: 200,
    height: 100,
    color: "#8B5CF6",
    hoverColor: "#7C3AED",
    type: "service",
    shortDesc: "FastAPI backend service",
    dependencies: [],
    dependents: ["qontinui-web", "qontinui-runner"],
    hasDrillDown: true,
  },
];

// Qontinui Web sub-architecture
const qontinuiWebComponents: Component[] = [
  {
    id: null,
    name: "Next.js Frontend",
    x: 50,
    y: 50,
    width: 220,
    height: 100,
    color: "#06B6D4",
    hoverColor: "#0891B2",
    type: "frontend",
    shortDesc: "React/Next.js UI",
    dependencies: [],
    dependents: [],
  },
  {
    id: null,
    name: "State Builder",
    x: 320,
    y: 50,
    width: 200,
    height: 100,
    color: "#06B6D4",
    hoverColor: "#0891B2",
    type: "component",
    shortDesc: "Visual state designer",
    dependencies: [],
    dependents: [],
  },
  {
    id: null,
    name: "Element Annotator",
    x: 50,
    y: 180,
    width: 200,
    height: 100,
    color: "#06B6D4",
    hoverColor: "#0891B2",
    type: "component",
    shortDesc: "Image annotation tool",
    dependencies: [],
    dependents: [],
  },
  {
    id: null,
    name: "Mock Executor",
    x: 320,
    y: 180,
    width: 200,
    height: 100,
    color: "#06B6D4",
    hoverColor: "#0891B2",
    type: "component",
    shortDesc: "Test automation logic",
    dependencies: [],
    dependents: [],
  },
  {
    id: "qontinui-api",
    name: "FastAPI Backend",
    x: 185,
    y: 310,
    width: 200,
    height: 100,
    color: "#8B5CF6",
    hoverColor: "#7C3AED",
    type: "backend",
    shortDesc: "REST API service",
    dependencies: [],
    dependents: [],
    hasDrillDown: true,
  },
];

// Architecture level mapping
const architectureMap: Record<ArchitectureLevel, Component[]> = {
  root: rootComponents,
  "qontinui-web": qontinuiWebComponents,
  "qontinui-api": rootComponents, // Placeholder, will be expanded later
  "qontinui-runner": rootComponents, // Placeholder
  qontinui: rootComponents, // Placeholder
  multistate: rootComponents, // Placeholder
};

interface Connection {
  from: ComponentType | string;
  to: ComponentType | string;
  fromPos: { x: number; y: number };
  toPos: { x: number; y: number };
  label?: string;
  dashed?: boolean;
}

const rootConnections: Connection[] = [
  // MultiState -> Qontinui
  {
    from: "multistate",
    to: "qontinui",
    fromPos: { x: 250, y: 100 },
    toPos: { x: 350, y: 100 },
    label: "state mgmt",
  },
  // Qontinui -> Runner
  {
    from: "qontinui",
    to: "qontinui-runner",
    fromPos: { x: 350, y: 150 },
    toPos: { x: 150, y: 220 },
    label: "execution",
  },
  // Qontinui -> Web
  {
    from: "qontinui",
    to: "qontinui-web",
    fromPos: { x: 450, y: 150 },
    toPos: { x: 450, y: 220 },
    label: "mock exec",
  },
  // Web -> API
  {
    from: "qontinui-web",
    to: "qontinui-api",
    fromPos: { x: 450, y: 320 },
    toPos: { x: 350, y: 390 },
    label: "REST API",
  },
  // API -> Runner (export configs)
  {
    from: "qontinui-api",
    to: "qontinui-runner",
    fromPos: { x: 250, y: 440 },
    toPos: { x: 150, y: 320 },
    label: "configs",
    dashed: true,
  },
];

const qontinuiWebConnections: Connection[] = [
  // Frontend -> State Builder
  {
    from: "Next.js Frontend",
    to: "State Builder",
    fromPos: { x: 270, y: 100 },
    toPos: { x: 320, y: 100 },
    label: "routes",
  },
  // Frontend -> Annotator
  {
    from: "Next.js Frontend",
    to: "Element Annotator",
    fromPos: { x: 160, y: 150 },
    toPos: { x: 150, y: 180 },
    label: "routes",
  },
  // Frontend -> Mock Executor
  {
    from: "Next.js Frontend",
    to: "Mock Executor",
    fromPos: { x: 270, y: 150 },
    toPos: { x: 420, y: 180 },
    label: "routes",
  },
  // State Builder -> Backend
  {
    from: "State Builder",
    to: "qontinui-api",
    fromPos: { x: 420, y: 150 },
    toPos: { x: 330, y: 310 },
    label: "API",
  },
  // Annotator -> Backend
  {
    from: "Element Annotator",
    to: "qontinui-api",
    fromPos: { x: 150, y: 280 },
    toPos: { x: 235, y: 310 },
    label: "API",
  },
  // Mock Executor -> Backend
  {
    from: "Mock Executor",
    to: "qontinui-api",
    fromPos: { x: 420, y: 280 },
    toPos: { x: 335, y: 310 },
    label: "API",
  },
];

const connectionMap: Record<ArchitectureLevel, Connection[]> = {
  root: rootConnections,
  "qontinui-web": qontinuiWebConnections,
  "qontinui-api": [],
  "qontinui-runner": [],
  qontinui: [],
  multistate: [],
};

export function ArchitectureDiagram({
  selectedComponent,
  onComponentSelect,
  currentLevel = "root",
  onDrillDown,
}: ArchitectureDiagramProps) {
  const [hoveredComponent, setHoveredComponent] = useState<
    ComponentType | string | null
  >(null);
  const [tooltipData, setTooltipData] = useState<{
    x: number;
    y: number;
    component: Component;
  } | null>(null);

  // Get components and connections for current level
  const components = architectureMap[currentLevel] || rootComponents;
  const connections = connectionMap[currentLevel] || [];

  const handleMouseEnter = (
    component: Component,
    event: React.MouseEvent<SVGGElement>
  ) => {
    setHoveredComponent(component.id || component.name);
    const svg = event.currentTarget.ownerSVGElement;
    if (svg) {
      const rect = svg.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      setTooltipData({ x, y, component });
    }
  };

  const handleMouseLeave = () => {
    setHoveredComponent(null);
    setTooltipData(null);
  };

  const handleComponentClick = (component: Component) => {
    if (component.id) {
      onComponentSelect(component.id);
    }
  };

  const handleComponentDoubleClick = (component: Component) => {
    if (component.hasDrillDown && component.id && onDrillDown) {
      onDrillDown(component.id);
    }
  };

  // Check if a connection should be highlighted
  const isConnectionHighlighted = (conn: Connection) => {
    if (!hoveredComponent) return false;
    return conn.from === hoveredComponent || conn.to === hoveredComponent;
  };

  // Check if a component should be dimmed (not related to hovered)
  const isComponentDimmed = (componentId: ComponentType | string | null) => {
    if (!hoveredComponent || hoveredComponent === componentId) return false;
    const hoveredComp = components.find(
      (c) => (c.id || c.name) === hoveredComponent
    );
    if (!hoveredComp) return false;
    return (
      !hoveredComp.dependencies.includes(componentId as ComponentType) &&
      !hoveredComp.dependents.includes(componentId as ComponentType)
    );
  };

  return (
    <div className="w-full h-full min-h-[600px] flex items-center justify-center relative">
      <svg
        viewBox="0 0 600 540"
        className="w-full h-full"
        style={{ maxHeight: "700px" }}
      >
        {/* Define gradients and filters */}
        <defs>
          {/* Gradient for components */}
          <linearGradient id="gradient-blue" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity="1" />
            <stop offset="100%" stopColor="#2563EB" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="gradient-green" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#10B981" stopOpacity="1" />
            <stop offset="100%" stopColor="#059669" stopOpacity="1" />
          </linearGradient>
          <linearGradient
            id="gradient-purple"
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#8B5CF6" stopOpacity="1" />
            <stop offset="100%" stopColor="#7C3AED" stopOpacity="1" />
          </linearGradient>

          {/* Drop shadow filter */}
          <filter id="drop-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
            <feOffset dx="0" dy="2" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.3" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Glow filter for selected/hovered */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Arrow markers */}
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
            id="arrowhead-highlight"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 10 3, 0 6" fill="#3B82F6" />
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
          {connections.map((conn, index) => {
            const isHighlighted = isConnectionHighlighted(conn);
            const strokeColor = isHighlighted
              ? "#3B82F6"
              : conn.dashed
                ? "#94A3B8"
                : "#64748B";
            const strokeWidth = isHighlighted ? 3 : 2;
            const marker = isHighlighted
              ? "url(#arrowhead-highlight)"
              : conn.dashed
                ? "url(#arrowhead-dashed)"
                : "url(#arrowhead)";

            return (
              <g key={index} className="transition-all duration-300">
                <line
                  x1={conn.fromPos.x}
                  y1={conn.fromPos.y}
                  x2={conn.toPos.x}
                  y2={conn.toPos.y}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={conn.dashed ? "5,5" : undefined}
                  markerEnd={marker}
                  className="transition-all duration-300"
                  opacity={hoveredComponent && !isHighlighted ? 0.3 : 1}
                />
                {conn.label && (
                  <text
                    x={(conn.fromPos.x + conn.toPos.x) / 2}
                    y={(conn.fromPos.y + conn.toPos.y) / 2 - 5}
                    fill={isHighlighted ? "#3B82F6" : "#64748B"}
                    fontSize="12"
                    fontWeight={isHighlighted ? "600" : "400"}
                    textAnchor="middle"
                    className="select-none transition-all duration-300"
                    opacity={hoveredComponent && !isHighlighted ? 0.3 : 1}
                  >
                    {conn.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* Components */}
        <g>
          {components.map((component, index) => {
            const componentKey = component.id || component.name || index;
            const isSelected = selectedComponent === component.id;
            const isHovered =
              hoveredComponent === (component.id || component.name);
            const isDimmed = isComponentDimmed(component.id || component.name);
            const opacity = isDimmed ? 0.3 : 1;

            const gradientId =
              component.type === "library"
                ? "gradient-blue"
                : component.type === "application" ||
                    component.type === "component"
                  ? "gradient-green"
                  : component.type === "frontend" || component.type === "ui"
                    ? "gradient-blue"
                    : "gradient-purple";

            return (
              <g
                key={componentKey}
                onClick={() => handleComponentClick(component)}
                onDoubleClick={() => handleComponentDoubleClick(component)}
                onMouseEnter={(e) => handleMouseEnter(component, e)}
                onMouseLeave={handleMouseLeave}
                className="cursor-pointer transition-all duration-300"
                style={{
                  transformOrigin: `${component.x + component.width / 2}px ${
                    component.y + component.height / 2
                  }px`,
                }}
              >
                {/* Glow effect for selected/hovered */}
                {(isSelected || isHovered) && (
                  <rect
                    x={component.x - 6}
                    y={component.y - 6}
                    width={component.width + 12}
                    height={component.height + 12}
                    rx="14"
                    fill="none"
                    stroke={component.color}
                    strokeWidth="4"
                    opacity="0.4"
                    className="animate-pulse"
                  />
                )}

                {/* Component box with gradient */}
                <rect
                  x={component.x}
                  y={component.y}
                  width={component.width}
                  height={component.height}
                  rx="8"
                  fill={`url(#${gradientId})`}
                  filter={
                    isSelected || isHovered ? "url(#glow)" : "url(#drop-shadow)"
                  }
                  className="transition-all duration-300"
                  opacity={opacity}
                  style={{
                    transform: isHovered ? "scale(1.05)" : "scale(1)",
                  }}
                />

                {/* Shine effect */}
                {(isSelected || isHovered) && (
                  <rect
                    x={component.x}
                    y={component.y}
                    width={component.width}
                    height={component.height / 3}
                    rx="8"
                    fill="white"
                    opacity="0.2"
                    className="pointer-events-none"
                  />
                )}

                {/* Component name */}
                <text
                  x={component.x + component.width / 2}
                  y={component.y + component.height / 2 - 10}
                  fill="white"
                  fontSize="18"
                  fontWeight="600"
                  textAnchor="middle"
                  className="select-none pointer-events-none transition-all duration-300"
                  opacity={opacity}
                >
                  {component.name}
                </text>

                {/* Component type badge */}
                <text
                  x={component.x + component.width / 2}
                  y={component.y + component.height / 2 + 15}
                  fill="white"
                  fontSize="12"
                  opacity={opacity * 0.9}
                  textAnchor="middle"
                  className="select-none pointer-events-none"
                >
                  {component.type === "library" && "📚 Core Library"}
                  {component.type === "application" && "🖥️ Application"}
                  {component.type === "service" && "⚙️ Service"}
                  {component.type === "frontend" && "🌐 Frontend"}
                  {component.type === "backend" && "⚙️ Backend"}
                  {component.type === "component" && "🧩 Component"}
                  {component.type === "ui" && "🎨 UI Component"}
                  {component.type === "api" && "🔌 API"}
                  {component.type === "database" && "💾 Database"}
                </text>

                {/* Drill-down indicator */}
                {component.hasDrillDown && (
                  <text
                    x={component.x + component.width - 15}
                    y={component.y + 25}
                    fill="white"
                    fontSize="16"
                    fontWeight="bold"
                    textAnchor="middle"
                    className="select-none pointer-events-none"
                    opacity={opacity * 0.8}
                  >
                    ⤵
                  </text>
                )}

                {/* Selection indicator */}
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
            );
          })}
        </g>

        {/* Legend with enhanced styling */}
        <g transform="translate(20, 500)">
          <rect
            x="-10"
            y="-5"
            width="370"
            height="35"
            rx="4"
            fill="currentColor"
            opacity="0.05"
          />
          <text x="0" y="0" fill="currentColor" fontSize="14" fontWeight="600">
            Legend:
          </text>
          <rect
            x="0"
            y="8"
            width="20"
            height="12"
            rx="2"
            fill="url(#gradient-blue)"
          />
          <text x="25" y="18" fill="currentColor" fontSize="12">
            Core Library
          </text>
          <rect
            x="120"
            y="8"
            width="20"
            height="12"
            rx="2"
            fill="url(#gradient-green)"
          />
          <text x="145" y="18" fill="currentColor" fontSize="12">
            Application
          </text>
          <rect
            x="240"
            y="8"
            width="20"
            height="12"
            rx="2"
            fill="url(#gradient-purple)"
          />
          <text x="265" y="18" fill="currentColor" fontSize="12">
            Service
          </text>
        </g>
      </svg>

      {/* Tooltip */}
      {tooltipData && (
        <div
          className="absolute z-50 pointer-events-none transition-all duration-200"
          style={{
            left: `${(tooltipData.x / 600) * 100}%`,
            top: `${(tooltipData.y / 540) * 100}%`,
            transform: "translate(-50%, -120%)",
          }}
        >
          <div className="bg-popover border border-border rounded-lg shadow-xl p-3 max-w-xs">
            <div className="font-semibold text-sm mb-1">
              {tooltipData.component.name}
            </div>
            <div className="text-xs text-muted-foreground">
              {tooltipData.component.shortDesc}
            </div>
            <div className="text-xs text-muted-foreground mt-2 italic">
              {tooltipData.component.id
                ? "Click for details"
                : "Component overview"}
              {tooltipData.component.hasDrillDown &&
                " • Double-click to drill down"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
