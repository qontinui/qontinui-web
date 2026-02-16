"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Layers,
  ChevronRight,
  ChevronDown,
  MousePointer,
  Type as TypeIcon,
  Globe,
  Hash,
  Box,
  CheckCircle,
  ArrowRight,
  Play,
  Lock,
  Eye,
  BookOpen,
  Search,
  BarChart3,
  List,
  ZoomIn,
  ZoomOut,
  Maximize,
  ArrowUpRight,
  ArrowDownLeft,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  SavedStateWithDetails,
  UIBridgeTransition,
  TransitionAction,
} from "../_types";

type ViewMode = "list" | "spatial";

interface StateViewPanelProps {
  states: SavedStateWithDetails[];
  transitions: UIBridgeTransition[];
  selectedStateId: string | null;
  onSelectState: (stateId: string | null) => void;
}

const ELEMENT_ICONS: Record<string, typeof Hash> = {
  testid: Hash,
  role: MousePointer,
  text: TypeIcon,
  ui: Box,
  url: Globe,
  nav: Globe,
};

const ELEMENT_COLORS: Record<string, string> = {
  testid: "border-blue-400 bg-blue-500/10 text-blue-300",
  role: "border-green-400 bg-green-500/10 text-green-300",
  text: "border-amber-400 bg-amber-500/10 text-amber-300",
  ui: "border-purple-400 bg-purple-500/10 text-purple-300",
  url: "border-cyan-400 bg-cyan-500/10 text-cyan-300",
  nav: "border-cyan-400 bg-cyan-500/10 text-cyan-300",
};

const ACTION_ICONS: Partial<Record<TransitionAction["type"], typeof MousePointer>> = {
  click: MousePointer,
  type: TypeIcon,
  select: Target,
  wait: Layers,
  navigate: Globe,
};

const ACTION_COLORS: Partial<Record<TransitionAction["type"], string>> = {
  click: "text-blue-400",
  type: "text-amber-400",
  select: "text-purple-400",
  wait: "text-gray-400",
  navigate: "text-cyan-400",
};

function getElementPrefix(elementId: string): string {
  const idx = elementId.indexOf(":");
  return idx > 0 ? elementId.slice(0, idx) : "other";
}

function getElementLabel(elementId: string): string {
  const idx = elementId.indexOf(":");
  return idx > 0 ? elementId.slice(idx + 1) : elementId;
}

/** State colors for visual differentiation */
const STATE_COLORS = [
  { border: "#3b82f6", bg: "rgba(59, 130, 246, 0.12)", bgSolid: "rgba(59, 130, 246, 0.25)" },
  { border: "#22c55e", bg: "rgba(34, 197, 94, 0.12)", bgSolid: "rgba(34, 197, 94, 0.25)" },
  { border: "#f59e0b", bg: "rgba(245, 158, 11, 0.12)", bgSolid: "rgba(245, 158, 11, 0.25)" },
  { border: "#ec4899", bg: "rgba(236, 72, 153, 0.12)", bgSolid: "rgba(236, 72, 153, 0.25)" },
  { border: "#8b5cf6", bg: "rgba(139, 92, 246, 0.12)", bgSolid: "rgba(139, 92, 246, 0.25)" },
  { border: "#ef4444", bg: "rgba(239, 68, 68, 0.12)", bgSolid: "rgba(239, 68, 68, 0.25)" },
  { border: "#06b6d4", bg: "rgba(6, 182, 212, 0.12)", bgSolid: "rgba(6, 182, 212, 0.25)" },
  { border: "#84cc16", bg: "rgba(132, 204, 22, 0.12)", bgSolid: "rgba(132, 204, 22, 0.25)" },
];

// =============================================================================
// Spatial Visualization Canvas
// =============================================================================

interface SpatialCanvasProps {
  states: SavedStateWithDetails[];
  transitions: UIBridgeTransition[];
  selectedStateId: string | null;
  onSelectState: (stateId: string | null) => void;
}

/** Compute a force-directed layout for states based on shared elements and transitions */
function computeSpatialLayout(
  states: SavedStateWithDetails[],
  transitions: UIBridgeTransition[],
  canvasWidth: number,
  canvasHeight: number,
): Map<string, { x: number; y: number; radius: number }> {
  const positions = new Map<string, { x: number; y: number; radius: number }>();
  if (states.length === 0) return positions;

  // Calculate element overlap between states (Jaccard similarity)
  const overlapMatrix = new Map<string, Map<string, number>>();
  for (const s1 of states) {
    const map = new Map<string, number>();
    for (const s2 of states) {
      if (s1.state_id === s2.state_id) continue;
      const s2Set = new Set(s2.element_ids);
      const intersection = s1.element_ids.filter((eid) => s2Set.has(eid)).length;
      const union = new Set([...s1.element_ids, ...s2.element_ids]).size;
      map.set(s2.state_id, union > 0 ? intersection / union : 0);
    }
    overlapMatrix.set(s1.state_id, map);
  }

  // Consider transition connections
  const connectionStrength = new Map<string, Map<string, number>>();
  for (const t of transitions) {
    for (const from of t.from_states) {
      for (const to of t.activate_states) {
        if (!connectionStrength.has(from)) connectionStrength.set(from, new Map());
        const current = connectionStrength.get(from)!.get(to) ?? 0;
        connectionStrength.get(from)!.set(to, current + 1);
        if (!connectionStrength.has(to)) connectionStrength.set(to, new Map());
        connectionStrength.get(to)!.set(from, (connectionStrength.get(to)!.get(from) ?? 0) + 1);
      }
    }
  }

  // Initialize positions in a circle
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  const baseRadius = Math.min(canvasWidth, canvasHeight) * 0.35;

  states.forEach((state, i) => {
    const angle = (i / states.length) * Math.PI * 2 - Math.PI / 2;
    const radius = Math.max(20, Math.min(50, 15 + state.element_ids.length * 2));
    positions.set(state.state_id, {
      x: cx + Math.cos(angle) * baseRadius,
      y: cy + Math.sin(angle) * baseRadius,
      radius,
    });
  });

  // Simple force simulation
  const iterations = 80;
  const repulsionStrength = 3000;
  const attractionStrength = 0.02;

  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map<string, { fx: number; fy: number }>();
    for (const s of states) {
      forces.set(s.state_id, { fx: 0, fy: 0 });
    }

    // Repulsion between all pairs
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) {
        const s1 = states[i]!;
        const s2 = states[j]!;
        const p1 = positions.get(s1.state_id)!;
        const p2 = positions.get(s2.state_id)!;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = repulsionStrength / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces.get(s1.state_id)!.fx -= fx;
        forces.get(s1.state_id)!.fy -= fy;
        forces.get(s2.state_id)!.fx += fx;
        forces.get(s2.state_id)!.fy += fy;
      }
    }

    // Attraction for connected/overlapping states
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) {
        const s1 = states[i]!;
        const s2 = states[j]!;
        const overlap = overlapMatrix.get(s1.state_id)?.get(s2.state_id) ?? 0;
        const connection = (connectionStrength.get(s1.state_id)?.get(s2.state_id) ?? 0) * 0.3;
        const attraction = (overlap + connection) * attractionStrength;
        if (attraction > 0) {
          const p1 = positions.get(s1.state_id)!;
          const p2 = positions.get(s2.state_id)!;
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          forces.get(s1.state_id)!.fx += dx * attraction;
          forces.get(s1.state_id)!.fy += dy * attraction;
          forces.get(s2.state_id)!.fx -= dx * attraction;
          forces.get(s2.state_id)!.fy -= dy * attraction;
        }
      }
    }

    // Center gravity
    for (const s of states) {
      const p = positions.get(s.state_id)!;
      const f = forces.get(s.state_id)!;
      f.fx += (cx - p.x) * 0.005;
      f.fy += (cy - p.y) * 0.005;
    }

    // Apply forces with cooling
    const cooling = 1 - iter / iterations;
    const maxMove = 20 * cooling;
    for (const s of states) {
      const p = positions.get(s.state_id)!;
      const f = forces.get(s.state_id)!;
      const mag = Math.sqrt(f.fx * f.fx + f.fy * f.fy);
      const scale = mag > maxMove ? maxMove / mag : 1;
      p.x = Math.max(p.radius + 10, Math.min(canvasWidth - p.radius - 10, p.x + f.fx * scale));
      p.y = Math.max(p.radius + 30, Math.min(canvasHeight - p.radius - 10, p.y + f.fy * scale));
    }
  }

  return positions;
}

function SpatialCanvas({ states, transitions, selectedStateId, onSelectState }: SpatialCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [zoom, setZoom] = useState(1);
  const [hoveredStateId, setHoveredStateId] = useState<string | null>(null);

  const layout = useMemo(
    () => computeSpatialLayout(states, transitions, canvasSize.width, canvasSize.height),
    [states, transitions, canvasSize.width, canvasSize.height]
  );

  // Build shared element data
  const sharedElements = useMemo(() => {
    const elementStateMap = new Map<string, Set<string>>();
    for (const s of states) {
      for (const eid of s.element_ids) {
        if (!elementStateMap.has(eid)) elementStateMap.set(eid, new Set());
        elementStateMap.get(eid)!.add(s.state_id);
      }
    }
    return elementStateMap;
  }, [states]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setCanvasSize({
          width: Math.floor(entry.contentRect.width),
          height: Math.floor(entry.contentRect.height),
        });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    ctx.scale(dpr * zoom, dpr * zoom);

    ctx.clearRect(0, 0, canvasSize.width / zoom, canvasSize.height / zoom);

    // Draw shared element connections (thin dashed lines)
    for (const [, stateIds] of sharedElements) {
      if (stateIds.size < 2) continue;
      const ids = Array.from(stateIds);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const p1 = layout.get(ids[i]!);
          const p2 = layout.get(ids[j]!);
          if (!p1 || !p2) continue;

          ctx.beginPath();
          ctx.strokeStyle = "rgba(128, 128, 128, 0.06)";
          ctx.lineWidth = 0.5;
          ctx.setLineDash([4, 4]);
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Draw transition arrows
    for (const t of transitions) {
      for (const from of t.from_states) {
        for (const to of t.activate_states) {
          const p1 = layout.get(from);
          const p2 = layout.get(to);
          if (!p1 || !p2) continue;

          const isHighlighted =
            from === selectedStateId || to === selectedStateId ||
            from === hoveredStateId || to === hoveredStateId;

          ctx.beginPath();
          ctx.strokeStyle = isHighlighted ? "#6366f1" : "rgba(128, 128, 128, 0.2)";
          ctx.lineWidth = isHighlighted ? 2 : 1;

          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const nx = dx / dist;
          const ny = dy / dist;
          const startX = p1.x + nx * p1.radius;
          const startY = p1.y + ny * p1.radius;
          const endX = p2.x - nx * p2.radius;
          const endY = p2.y - ny * p2.radius;

          const cpx = (startX + endX) / 2 - ny * 20;
          const cpy = (startY + endY) / 2 + nx * 20;

          ctx.moveTo(startX, startY);
          ctx.quadraticCurveTo(cpx, cpy, endX, endY);
          ctx.stroke();

          // Arrowhead
          const angle = Math.atan2(endY - cpy, endX - cpx);
          const arrowSize = 6;
          ctx.beginPath();
          ctx.fillStyle = ctx.strokeStyle;
          ctx.moveTo(endX, endY);
          ctx.lineTo(
            endX - arrowSize * Math.cos(angle - Math.PI / 6),
            endY - arrowSize * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            endX - arrowSize * Math.cos(angle + Math.PI / 6),
            endY - arrowSize * Math.sin(angle + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fill();

          // Draw transition label at midpoint if highlighted
          if (isHighlighted) {
            const labelX = (startX + endX) / 2 - ny * 10;
            const labelY = (startY + endY) / 2 + nx * 10;
            ctx.font = "9px system-ui, sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(t.name, labelX, labelY);
          }
        }
      }
    }

    // Draw state circles
    for (let i = 0; i < states.length; i++) {
      const state = states[i]!;
      const pos = layout.get(state.state_id);
      if (!pos) continue;

      const color = STATE_COLORS[i % STATE_COLORS.length]!;
      const isSelected = state.state_id === selectedStateId;
      const isHovered = state.state_id === hoveredStateId;
      const isInitial = state.extra_metadata?.initial === true;

      // Circle background
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, pos.radius, 0, Math.PI * 2);
      ctx.fillStyle = isSelected || isHovered ? color.bgSolid : color.bg;
      ctx.fill();
      ctx.strokeStyle = color.border;
      ctx.lineWidth = isSelected ? 3 : isHovered ? 2 : 1.5;
      ctx.stroke();

      // Selection ring
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, pos.radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = color.border;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Initial state indicator
      if (isInitial) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y - pos.radius - 8, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#FFD700";
        ctx.fill();
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // State name label
      ctx.fillStyle = isSelected || isHovered ? "#fff" : "rgba(255, 255, 255, 0.85)";
      ctx.font = `${isSelected ? "bold " : ""}${Math.max(9, Math.min(12, pos.radius / 3))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      let displayName = state.name;
      const maxWidth = pos.radius * 1.6;
      while (ctx.measureText(displayName).width > maxWidth && displayName.length > 3) {
        displayName = displayName.slice(0, -2) + "\u2026";
      }
      ctx.fillText(displayName, pos.x, pos.y);

      // Element count below
      ctx.font = "9px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.fillText(`${state.element_ids.length} el`, pos.x, pos.y + pos.radius + 12);
    }
  }, [canvasSize, states, transitions, layout, selectedStateId, hoveredStateId, sharedElements, zoom]);

  const getStateAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left) / zoom;
      const y = (clientY - rect.top) / zoom;

      for (let i = states.length - 1; i >= 0; i--) {
        const state = states[i]!;
        const pos = layout.get(state.state_id);
        if (!pos) continue;
        const dx = x - pos.x;
        const dy = y - pos.y;
        if (dx * dx + dy * dy <= pos.radius * pos.radius) {
          return state.state_id;
        }
      }
      return null;
    },
    [states, layout, zoom]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      setHoveredStateId(getStateAtPoint(e.clientX, e.clientY));
    },
    [getStateAtPoint]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const stateId = getStateAtPoint(e.clientX, e.clientY);
      onSelectState(stateId === selectedStateId ? null : stateId);
    },
    [getStateAtPoint, onSelectState, selectedStateId]
  );

  return (
    <div ref={containerRef} className="relative w-full h-full bg-surface-secondary">
      <canvas
        ref={canvasRef}
        style={{ width: canvasSize.width, height: canvasSize.height, cursor: hoveredStateId ? "pointer" : "default" }}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onMouseLeave={() => setHoveredStateId(null)}
      />

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 bg-surface-primary/80 backdrop-blur-sm"
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
          title="Zoom in"
        >
          <ZoomIn className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 bg-surface-primary/80 backdrop-blur-sm"
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          title="Zoom out"
        >
          <ZoomOut className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 bg-surface-primary/80 backdrop-blur-sm"
          onClick={() => setZoom(1)}
          title="Reset zoom"
        >
          <Maximize className="size-3.5" />
        </Button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 text-[10px] text-text-muted bg-surface-primary/80 backdrop-blur-sm px-2.5 py-1.5 rounded border border-border-primary/50">
        <div className="flex items-center gap-3">
          <span>{states.length} states</span>
          <span>{transitions.length} transitions</span>
          <span>Zoom: {Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {/* Hovered state tooltip */}
      {hoveredStateId && (
        <div className="absolute top-3 left-3 text-xs bg-surface-primary/95 backdrop-blur-sm px-3 py-2 rounded-lg border border-border-primary shadow-md">
          <div className="font-medium text-text-primary">
            {states.find((s) => s.state_id === hoveredStateId)?.name}
          </div>
          <div className="text-text-muted mt-0.5">
            {states.find((s) => s.state_id === hoveredStateId)?.element_ids.length} elements
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function StateViewPanel({
  states,
  transitions,
  selectedStateId,
  onSelectState,
}: StateViewPanelProps) {
  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const selectedState = useMemo(
    () => states.find((s) => s.state_id === selectedStateId),
    [states, selectedStateId]
  );

  // Build outgoing/incoming transition map
  const transitionMap = useMemo(() => {
    const outgoing = new Map<string, UIBridgeTransition[]>();
    const incoming = new Map<string, UIBridgeTransition[]>();

    for (const t of transitions) {
      for (const from of t.from_states) {
        if (!outgoing.has(from)) outgoing.set(from, []);
        outgoing.get(from)!.push(t);
      }
      for (const to of t.activate_states) {
        if (!incoming.has(to)) incoming.set(to, []);
        incoming.get(to)!.push(t);
      }
    }
    return { outgoing, incoming };
  }, [transitions]);

  // Group elements by type prefix for the detail view
  const elementGroups = useMemo(() => {
    if (!selectedState) return new Map<string, string[]>();
    const groups = new Map<string, string[]>();
    for (const eid of selectedState.element_ids) {
      const prefix = getElementPrefix(eid);
      if (!groups.has(prefix)) groups.set(prefix, []);
      groups.get(prefix)!.push(eid);
    }
    return groups;
  }, [selectedState]);

  // Shared elements between states
  const sharedElements = useMemo(() => {
    const elementStateMap = new Map<string, string[]>();
    for (const s of states) {
      for (const eid of s.element_ids) {
        if (!elementStateMap.has(eid)) elementStateMap.set(eid, []);
        elementStateMap.get(eid)!.push(s.state_id);
      }
    }
    return elementStateMap;
  }, [states]);

  // Filter states by search
  const filteredStates = useMemo(() => {
    if (!searchFilter) return states;
    const lower = searchFilter.toLowerCase();
    return states.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.state_id.toLowerCase().includes(lower) ||
        s.element_ids.some((eid) => eid.toLowerCase().includes(lower))
    );
  }, [states, searchFilter]);

  const toggleExpanded = (stateId: string) => {
    setExpandedStates((prev) => {
      const next = new Set(prev);
      if (next.has(stateId)) {
        next.delete(stateId);
      } else {
        next.add(stateId);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full">
      {/* Left Panel: State List */}
      <div className="w-72 border-r border-border-primary bg-surface-primary overflow-y-auto shrink-0">
        <div className="p-3 border-b border-border-primary">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="size-4 text-brand-primary" />
            <h3 className="text-sm font-semibold text-text-primary">States</h3>
            <span className="text-xs text-text-muted ml-auto">{states.length}</span>
          </div>

          {/* View mode toggle + search */}
          <div className="flex items-center gap-2 mb-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-text-muted" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter states..."
                className="input w-full text-xs h-7 pl-7"
              />
            </div>
            <div className="flex items-center border border-border-primary rounded overflow-hidden">
              <button
                onClick={() => setViewMode("list")}
                className={`p-1 ${viewMode === "list" ? "bg-brand-primary/20 text-brand-primary" : "text-text-muted hover:text-text-primary"}`}
                title="List view"
              >
                <List className="size-3.5" />
              </button>
              <button
                onClick={() => setViewMode("spatial")}
                className={`p-1 ${viewMode === "spatial" ? "bg-brand-primary/20 text-brand-primary" : "text-text-muted hover:text-text-primary"}`}
                title="Spatial view"
              >
                <BarChart3 className="size-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="p-2 space-y-0.5">
          {filteredStates.map((state) => {
            const colorIdx = states.indexOf(state);
            const color = STATE_COLORS[colorIdx % STATE_COLORS.length]!;
            const isSelected = state.state_id === selectedStateId;
            const isExpanded = expandedStates.has(state.state_id);
            const stateOutgoing = transitionMap.outgoing.get(state.state_id) ?? [];
            const stateIncoming = transitionMap.incoming.get(state.state_id) ?? [];
            const isInitial = state.extra_metadata?.initial === true;
            const isBlocking = state.extra_metadata?.blocking === true;

            return (
              <div key={state.state_id}>
                <button
                  onClick={() => {
                    onSelectState(isSelected ? null : state.state_id);
                    if (!isExpanded) toggleExpanded(state.state_id);
                  }}
                  className={`
                    w-full text-left px-3 py-2 rounded-md transition-colors text-sm
                    ${isSelected
                      ? "bg-brand-primary/10 border border-brand-primary/30"
                      : "hover:bg-surface-secondary border border-transparent"
                    }
                  `}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: color.border }}
                    />
                    {isInitial && (
                      <Play className="size-3 text-yellow-500 fill-yellow-500 shrink-0" />
                    )}
                    {isBlocking && (
                      <Lock className="size-3 text-amber-500 shrink-0" />
                    )}
                    <span className="font-medium text-text-primary truncate flex-1">
                      {state.name}
                    </span>
                    {isExpanded ? (
                      <ChevronDown className="size-3 text-text-muted transition-transform" />
                    ) : (
                      <ChevronRight className="size-3 text-text-muted transition-transform" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 ml-4.5 text-xs text-text-muted">
                    <span>{state.element_ids.length} elements</span>
                    <span
                      className={
                        Math.round(state.confidence * 100) >= 80
                          ? "text-green-400"
                          : Math.round(state.confidence * 100) >= 50
                            ? "text-amber-400"
                            : "text-red-400"
                      }
                    >
                      {Math.round(state.confidence * 100)}%
                    </span>
                    {stateOutgoing.length > 0 && (
                      <span className="text-brand-secondary flex items-center gap-0.5">
                        <ArrowUpRight className="size-2" />
                        {stateOutgoing.length}
                      </span>
                    )}
                    {stateIncoming.length > 0 && (
                      <span className="text-brand-primary flex items-center gap-0.5">
                        <ArrowDownLeft className="size-2" />
                        {stateIncoming.length}
                      </span>
                    )}
                  </div>
                </button>

                {/* Expanded element list */}
                {isExpanded && (
                  <div className="ml-5 pl-2 border-l border-border-primary mt-1 mb-2 space-y-0.5">
                    {state.element_ids.slice(0, 20).map((eid) => {
                      const prefix = getElementPrefix(eid);
                      const label = getElementLabel(eid);
                      const Icon = ELEMENT_ICONS[prefix] ?? Layers;
                      const stateCount = sharedElements.get(eid)?.length ?? 1;
                      return (
                        <div
                          key={eid}
                          className="text-[10px] text-text-muted flex items-center gap-1 py-0.5 px-1 rounded hover:bg-surface-secondary"
                          title={`${eid}${stateCount > 1 ? ` (shared across ${stateCount} states)` : ""}`}
                        >
                          <Icon className="size-2.5 shrink-0" />
                          <span className="truncate flex-1">{label}</span>
                          {stateCount > 1 && (
                            <span className="text-[8px] text-brand-primary bg-brand-primary/10 px-1 rounded-full shrink-0">
                              {stateCount}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {state.element_ids.length > 20 && (
                      <div className="text-[10px] text-text-muted py-0.5 px-1">
                        +{state.element_ids.length - 20} more
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {filteredStates.length === 0 && (
            <p className="text-xs text-text-muted text-center py-4">
              No states match filter.
            </p>
          )}
        </div>
      </div>

      {/* Right Panel: Spatial Canvas or State Details */}
      <div className="flex-1 overflow-hidden">
        {viewMode === "spatial" ? (
          <SpatialCanvas
            states={states}
            transitions={transitions}
            selectedStateId={selectedStateId}
            onSelectState={onSelectState}
          />
        ) : selectedState ? (
          <div className="p-6 space-y-6 overflow-y-auto h-full">
            {/* State header */}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-text-primary">
                  {selectedState.name}
                </h2>
                {selectedState.extra_metadata?.initial === true && (
                  <span className="badge badge-sm bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                    <Play className="size-2.5 mr-0.5 fill-current" />
                    Initial
                  </span>
                )}
                {selectedState.extra_metadata?.blocking === true && (
                  <span className="badge badge-sm bg-amber-500/20 text-amber-400 border-amber-500/30">
                    <Lock className="size-2.5 mr-0.5" />
                    Blocking
                  </span>
                )}
              </div>
              {selectedState.description && (
                <p className="text-sm text-text-muted mt-1">
                  {selectedState.description}
                </p>
              )}
              <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                <span className="badge badge-sm badge-default">
                  {selectedState.element_ids.length} elements
                </span>
                <span className="badge badge-sm badge-default">
                  {selectedState.render_ids.length} renders
                </span>
                <span
                  className={`badge badge-sm ${
                    Math.round(selectedState.confidence * 100) >= 80
                      ? "badge-success"
                      : "badge-warning"
                  }`}
                >
                  {Math.round(selectedState.confidence * 100)}% confidence
                </span>
              </div>
            </div>

            {/* Element groups */}
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">
                Elements by Type
              </h3>
              <div className="space-y-3">
                {Array.from(elementGroups.entries()).map(([prefix, elements]) => {
                  const Icon = ELEMENT_ICONS[prefix] ?? Layers;
                  const colorClass =
                    ELEMENT_COLORS[prefix] ??
                    "border-gray-400 bg-gray-500/10 text-gray-300";

                  return (
                    <div key={prefix}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Icon className="size-3.5" />
                        <span className="text-xs font-medium text-text-primary capitalize">
                          {prefix}
                        </span>
                        <span className="text-xs text-text-muted">
                          ({elements.length})
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {elements.map((eid) => {
                          const stateCount = sharedElements.get(eid)?.length ?? 1;
                          return (
                            <div
                              key={eid}
                              className={`text-[11px] px-2 py-0.5 rounded border ${colorClass} inline-flex items-center gap-1`}
                              title={`${eid}${stateCount > 1 ? ` (shared across ${stateCount} states)` : ""}`}
                            >
                              {getElementLabel(eid)}
                              {stateCount > 1 && (
                                <span className="text-[8px] opacity-70 bg-white/10 px-0.5 rounded">
                                  x{stateCount}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Transitions from/to this state */}
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">
                Transitions
              </h3>
              <div className="space-y-2">
                {(transitionMap.outgoing.get(selectedState.state_id) ?? []).map(
                  (t) => (
                    <div
                      key={`out-${t.transition_id}`}
                      className="flex items-center gap-2 text-xs p-2.5 rounded-lg bg-surface-secondary border border-border-primary"
                    >
                      <ArrowRight className="size-3 text-brand-secondary shrink-0" />
                      <span className="font-medium text-text-primary">
                        {t.name}
                      </span>
                      {/* Action type icons */}
                      {t.actions.length > 0 && (
                        <span className="flex items-center gap-0.5 shrink-0">
                          {[...new Set(t.actions.map((a) => a.type))].slice(0, 3).map((actionType) => {
                            const ActionIcon = ACTION_ICONS[actionType];
                            return ActionIcon ? (
                              <ActionIcon key={actionType} className={`size-2.5 ${ACTION_COLORS[actionType] ?? "text-gray-400"}`} />
                            ) : null;
                          })}
                        </span>
                      )}
                      <ArrowRight className="size-2.5 text-text-muted" />
                      <span className="text-text-muted truncate">
                        {t.activate_states
                          .map((sid) => states.find((s) => s.state_id === sid)?.name ?? sid)
                          .join(", ")}
                      </span>
                      {t.actions.length > 0 && (
                        <span className="text-text-muted ml-auto text-[10px] shrink-0">
                          {t.actions.length} action{t.actions.length !== 1 ? "s" : ""}
                        </span>
                      )}
                      {t.stays_visible && (
                        <Eye className="size-3 text-green-400 shrink-0" />
                      )}
                    </div>
                  )
                )}
                {(transitionMap.incoming.get(selectedState.state_id) ?? []).map(
                  (t) => (
                    <div
                      key={`in-${t.transition_id}`}
                      className="flex items-center gap-2 text-xs p-2.5 rounded-lg bg-surface-secondary border border-border-primary"
                    >
                      <CheckCircle className="size-3 text-brand-primary shrink-0" />
                      <span className="font-medium text-text-primary">
                        {t.name}
                      </span>
                      {/* Action type icons */}
                      {t.actions.length > 0 && (
                        <span className="flex items-center gap-0.5 shrink-0">
                          {[...new Set(t.actions.map((a) => a.type))].slice(0, 3).map((actionType) => {
                            const ActionIcon = ACTION_ICONS[actionType];
                            return ActionIcon ? (
                              <ActionIcon key={actionType} className={`size-2.5 ${ACTION_COLORS[actionType] ?? "text-gray-400"}`} />
                            ) : null;
                          })}
                        </span>
                      )}
                      <span className="text-text-muted truncate">
                        from{" "}
                        {t.from_states
                          .map((sid) => states.find((s) => s.state_id === sid)?.name ?? sid)
                          .join(", ")}
                      </span>
                    </div>
                  )
                )}
                {(transitionMap.outgoing.get(selectedState.state_id) ?? []).length === 0 &&
                  (transitionMap.incoming.get(selectedState.state_id) ?? []).length === 0 && (
                    <p className="text-xs text-text-muted">No transitions connected.</p>
                  )}
              </div>
            </div>

            {/* Acceptance criteria */}
            {selectedState.acceptance_criteria.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-text-primary mb-2">
                  Acceptance Criteria
                </h3>
                <ul className="space-y-1">
                  {selectedState.acceptance_criteria.map((criteria, i) => (
                    <li key={i} className="text-xs text-text-muted flex items-start gap-1.5">
                      <CheckCircle className="size-3 text-green-500 mt-0.5 shrink-0" />
                      {criteria}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Domain knowledge */}
            {selectedState.domain_knowledge.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-text-primary mb-2">
                  <BookOpen className="size-3.5 inline mr-1" />
                  Domain Knowledge
                </h3>
                <div className="space-y-2">
                  {selectedState.domain_knowledge.map((dk) => (
                    <div
                      key={dk.id}
                      className="p-3 rounded-lg bg-surface-secondary border border-border-primary"
                    >
                      <div className="text-xs font-medium text-text-primary">{dk.title}</div>
                      <div className="text-[10px] text-text-muted mt-1 line-clamp-3">
                        {dk.content}
                      </div>
                      {dk.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {dk.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[9px] px-1.5 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="text-xs text-text-muted space-y-1 pt-3 border-t border-border-primary">
              <div>State ID: <code className="bg-surface-secondary px-1 rounded">{selectedState.state_id}</code></div>
              <div>Created: {new Date(selectedState.created_at).toLocaleDateString()}</div>
              <div>Updated: {new Date(selectedState.updated_at).toLocaleDateString()}</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-text-muted">
            <div className="text-center">
              <Layers className="size-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a state to view its details</p>
              <p className="text-xs mt-1 text-text-muted/70">
                {states.length} state{states.length !== 1 ? "s" : ""} available
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
