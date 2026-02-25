"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  GitBranch,
  MousePointer,
  Type as TypeIcon,
  ListFilter,
  Clock,
  Globe,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RotateCcw,
  ChevronRight,
  Eye,
  ArrowRight,
  Search,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  SavedStateWithDetails,
  UIBridgeTransition,
  TransitionAction,
} from "../_types";

interface TransitionsPanelProps {
  states: SavedStateWithDetails[];
  transitions: UIBridgeTransition[];
  onSelectTransition: (id: string | null) => void;
}

const ACTION_ICONS: Partial<
  Record<TransitionAction["type"], typeof MousePointer>
> = {
  click: MousePointer,
  type: TypeIcon,
  select: ListFilter,
  wait: Clock,
  navigate: Globe,
};

const ACTION_COLORS: Partial<
  Record<TransitionAction["type"], { text: string; bg: string; border: string }>
> = {
  click: {
    text: "text-blue-400",
    bg: "bg-blue-500/15",
    border: "border-blue-500/30",
  },
  type: {
    text: "text-amber-400",
    bg: "bg-amber-500/15",
    border: "border-amber-500/30",
  },
  select: {
    text: "text-purple-400",
    bg: "bg-purple-500/15",
    border: "border-purple-500/30",
  },
  wait: {
    text: "text-gray-400",
    bg: "bg-gray-500/15",
    border: "border-gray-500/30",
  },
  navigate: {
    text: "text-cyan-400",
    bg: "bg-cyan-500/15",
    border: "border-cyan-500/30",
  },
};

const ACTION_LABELS: Partial<Record<TransitionAction["type"], string>> = {
  click: "Click",
  type: "Type",
  select: "Select",
  wait: "Wait",
  navigate: "Navigate",
};

const ACTION_ACTIVE_LABELS: Partial<Record<TransitionAction["type"], string>> =
  {
    click: "Clicking...",
    type: "Typing...",
    select: "Selecting...",
    wait: "Waiting...",
    navigate: "Navigating...",
  };

interface AnimationState {
  isPlaying: boolean;
  currentActionIndex: number;
  progress: number; // 0-1 within current action
  speed: number;
}

export function TransitionsPanel({
  states,
  transitions,
  onSelectTransition,
}: TransitionsPanelProps) {
  const [selectedTransitionId, setSelectedTransitionId] = useState<
    string | null
  >(null);
  const [filterFromState, setFilterFromState] = useState<string | null>(null);
  const [filterToState, setFilterToState] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [animation, setAnimation] = useState<AnimationState>({
    isPlaying: false,
    currentActionIndex: -1,
    progress: 0,
    speed: 1,
  });

  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const selectedTransition = useMemo(
    () => transitions.find((t) => t.transition_id === selectedTransitionId),
    [transitions, selectedTransitionId]
  );

  // Filter transitions
  const filteredTransitions = useMemo(() => {
    return transitions.filter((t) => {
      if (filterFromState && !t.from_states.includes(filterFromState))
        return false;
      if (filterToState && !t.activate_states.includes(filterToState))
        return false;
      if (searchFilter) {
        const lower = searchFilter.toLowerCase();
        if (!t.name.toLowerCase().includes(lower)) return false;
      }
      return true;
    });
  }, [transitions, filterFromState, filterToState, searchFilter]);

  const stateNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of states) {
      map.set(s.state_id, s.name);
    }
    return map;
  }, [states]);

  // Animation functions
  const actionDuration = useCallback((action: TransitionAction) => {
    switch (action.type) {
      case "click":
        return 800;
      case "type":
        return Math.max(800, (action.text?.length ?? 5) * 60 + 400);
      case "navigate":
        return 1200;
      case "wait":
        return Math.min(action.delay_ms ?? 1000, 2000);
      case "select":
        return 1000;
      default:
        return 1500;
    }
  }, []);

  const stopAnimation = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setAnimation((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const animate = useCallback(() => {
    if (!selectedTransition || selectedTransition.actions.length === 0) return;

    const tick = (timestamp: number) => {
      setAnimation((prev) => {
        if (!prev.isPlaying) return prev;

        const elapsed = timestamp - startTimeRef.current;
        const currentAction =
          selectedTransition.actions[prev.currentActionIndex];
        if (!currentAction) {
          return { ...prev, isPlaying: false };
        }

        const duration = actionDuration(currentAction) / prev.speed;
        const progress = Math.min(elapsed / duration, 1);

        if (progress >= 1) {
          // Move to next action
          const nextIndex = prev.currentActionIndex + 1;
          if (nextIndex >= selectedTransition.actions.length) {
            return { ...prev, isPlaying: false, progress: 1 };
          }
          startTimeRef.current = timestamp;
          return { ...prev, currentActionIndex: nextIndex, progress: 0 };
        }

        return { ...prev, progress };
      });

      animationRef.current = requestAnimationFrame(tick);
    };

    startTimeRef.current = performance.now();
    animationRef.current = requestAnimationFrame(tick);
  }, [selectedTransition, actionDuration]);

  const playAnimation = useCallback(() => {
    setAnimation((prev) => {
      const startIndex =
        prev.currentActionIndex < 0 ? 0 : prev.currentActionIndex;
      // If completed, restart from beginning
      const idx =
        prev.progress >= 1 &&
        startIndex >= (selectedTransition?.actions.length ?? 0) - 1
          ? 0
          : startIndex;
      return { ...prev, isPlaying: true, currentActionIndex: idx, progress: 0 };
    });
    setTimeout(animate, 0);
  }, [animate, selectedTransition]);

  const pauseAnimation = useCallback(() => {
    stopAnimation();
  }, [stopAnimation]);

  const resetAnimation = useCallback(() => {
    stopAnimation();
    setAnimation((prev) => ({
      ...prev,
      currentActionIndex: -1,
      progress: 0,
    }));
  }, [stopAnimation]);

  const stepForward = useCallback(() => {
    stopAnimation();
    setAnimation((prev) => {
      const next = prev.currentActionIndex + 1;
      if (!selectedTransition || next >= selectedTransition.actions.length)
        return prev;
      return { ...prev, currentActionIndex: next, progress: 1 };
    });
  }, [stopAnimation, selectedTransition]);

  const stepBackward = useCallback(() => {
    stopAnimation();
    setAnimation((prev) => {
      const next = prev.currentActionIndex - 1;
      if (next < 0) return { ...prev, currentActionIndex: -1, progress: 0 };
      return { ...prev, currentActionIndex: next, progress: 1 };
    });
  }, [stopAnimation]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Reset animation when transition changes
  useEffect(() => {
    resetAnimation();
  }, [selectedTransitionId, resetAnimation]);

  const handleSelectTransition = useCallback(
    (tid: string) => {
      setSelectedTransitionId(tid === selectedTransitionId ? null : tid);
      onSelectTransition(tid === selectedTransitionId ? null : tid);
    },
    [selectedTransitionId, onSelectTransition]
  );

  // Calculate overall progress for the progress bar
  const overallProgress = useMemo(() => {
    if (!selectedTransition || selectedTransition.actions.length === 0)
      return 0;
    if (animation.currentActionIndex < 0) return 0;
    const completedActions = animation.currentActionIndex;
    const currentProgress = animation.progress;
    return (
      (completedActions + currentProgress) / selectedTransition.actions.length
    );
  }, [selectedTransition, animation]);

  return (
    <div className="flex h-full">
      {/* Left: Transition List */}
      <div className="w-80 border-r border-border-primary bg-surface-primary overflow-y-auto shrink-0">
        <div className="p-3 border-b border-border-primary">
          <div className="flex items-center gap-2 mb-3">
            <GitBranch className="size-4 text-brand-primary" />
            <h3 className="text-sm font-semibold text-text-primary">
              Transitions
            </h3>
            <span className="text-xs text-text-muted ml-auto">
              {filteredTransitions.length}
            </span>
          </div>

          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-text-muted" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search transitions..."
              className="input w-full text-[10px] h-6 pl-7"
            />
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            <select
              value={filterFromState ?? ""}
              onChange={(e) => setFilterFromState(e.target.value || null)}
              className="input text-[10px] h-6 flex-1"
            >
              <option value="">All from states</option>
              {states.map((s) => (
                <option key={s.state_id} value={s.state_id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={filterToState ?? ""}
              onChange={(e) => setFilterToState(e.target.value || null)}
              className="input text-[10px] h-6 flex-1"
            >
              <option value="">All target states</option>
              {states.map((s) => (
                <option key={s.state_id} value={s.state_id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-2 space-y-0.5">
          {filteredTransitions.map((t) => {
            const isSelected = t.transition_id === selectedTransitionId;
            return (
              <button
                key={t.transition_id}
                onClick={() => handleSelectTransition(t.transition_id)}
                className={`
                  w-full text-left px-3 py-2 rounded-md transition-colors text-sm
                  ${
                    isSelected
                      ? "bg-brand-primary/10 border border-brand-primary/30"
                      : "hover:bg-surface-secondary border border-transparent"
                  }
                `}
              >
                <div className="flex items-center gap-1.5">
                  {/* Action type icons */}
                  <span className="flex items-center gap-0.5">
                    {[...new Set(t.actions.map((a) => a.type))]
                      .slice(0, 3)
                      .map((type) => {
                        const Icon = ACTION_ICONS[type];
                        const color = ACTION_COLORS[type];
                        return Icon ? (
                          <Icon
                            key={type}
                            className={`size-3 ${color?.text ?? "text-gray-400"}`}
                          />
                        ) : null;
                      })}
                  </span>
                  <span className="font-medium text-text-primary truncate flex-1">
                    {t.name || "Unnamed"}
                  </span>
                  {t.stays_visible && (
                    <Eye className="size-3 text-green-500 shrink-0" />
                  )}
                  {t.actions.length > 0 && (
                    <span className="text-[9px] text-text-muted bg-surface-secondary px-1 rounded">
                      {t.actions.length}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-0.5 ml-4 text-[10px] text-text-muted">
                  <span className="truncate">
                    {t.from_states
                      .map((s) => stateNameMap.get(s) ?? s)
                      .join(", ")}
                  </span>
                  <ArrowRight className="size-2.5 shrink-0" />
                  <span className="truncate">
                    {t.activate_states
                      .map((s) => stateNameMap.get(s) ?? s)
                      .join(", ")}
                  </span>
                </div>
              </button>
            );
          })}
          {filteredTransitions.length === 0 && (
            <p className="text-xs text-text-muted text-center py-4">
              No transitions match filters.
            </p>
          )}
        </div>
      </div>

      {/* Right: Transition Detail + Animation */}
      <div className="flex-1 overflow-y-auto">
        {selectedTransition ? (
          <div className="p-6 space-y-6">
            {/* Header */}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-text-primary">
                  {selectedTransition.name || "Unnamed Transition"}
                </h2>
                {selectedTransition.stays_visible && (
                  <span className="badge badge-sm bg-green-500/20 text-green-400 border-green-500/30">
                    <Eye className="size-2.5 mr-0.5" />
                    Visible
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2 text-xs text-text-muted flex-wrap">
                <span className="badge badge-sm badge-default">
                  From:{" "}
                  {selectedTransition.from_states
                    .map((s) => stateNameMap.get(s) ?? s)
                    .join(", ")}
                </span>
                <ArrowRight className="size-3" />
                <span className="badge badge-sm badge-default">
                  To:{" "}
                  {selectedTransition.activate_states
                    .map((s) => stateNameMap.get(s) ?? s)
                    .join(", ")}
                </span>
                {selectedTransition.exit_states.length > 0 && (
                  <span className="badge badge-sm bg-red-500/10 text-red-400 border-red-500/30">
                    Exit:{" "}
                    {selectedTransition.exit_states
                      .map((s) => stateNameMap.get(s) ?? s)
                      .join(", ")}
                  </span>
                )}
              </div>
            </div>

            {/* Playback Controls */}
            {selectedTransition.actions.length > 0 && (
              <div className="rounded-lg border border-border-primary bg-surface-secondary p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Zap className="size-3.5 text-brand-primary" />
                    <span className="text-xs font-medium text-text-primary">
                      Action Playback
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={animation.speed}
                      onChange={(e) =>
                        setAnimation((prev) => ({
                          ...prev,
                          speed: parseFloat(e.target.value),
                        }))
                      }
                      className="input text-[10px] h-5 w-16"
                    >
                      <option value="0.5">0.5x</option>
                      <option value="1">1x</option>
                      <option value="1.5">1.5x</option>
                      <option value="2">2x</option>
                      <option value="4">4x</option>
                    </select>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 bg-surface-primary rounded-full mb-3 overflow-hidden">
                  <div
                    className="h-full bg-brand-primary rounded-full transition-all duration-100"
                    style={{ width: `${overallProgress * 100}%` }}
                  />
                </div>

                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetAnimation}
                    className="h-7 w-7 p-0"
                    title="Reset"
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={stepBackward}
                    disabled={animation.currentActionIndex <= 0}
                    className="h-7 w-7 p-0"
                    title="Step back"
                  >
                    <SkipBack className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    onClick={
                      animation.isPlaying ? pauseAnimation : playAnimation
                    }
                    className="h-9 w-9 p-0 rounded-full"
                    title={animation.isPlaying ? "Pause" : "Play"}
                  >
                    {animation.isPlaying ? (
                      <Pause className="size-4" />
                    ) : (
                      <Play className="size-4 ml-0.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={stepForward}
                    disabled={
                      animation.currentActionIndex >=
                      selectedTransition.actions.length - 1
                    }
                    className="h-7 w-7 p-0"
                    title="Step forward"
                  >
                    <SkipForward className="size-3.5" />
                  </Button>
                </div>

                {/* Action timeline dots */}
                <div className="mt-3 flex items-center justify-center gap-1">
                  {selectedTransition.actions.map((action, idx) => {
                    const Icon = ACTION_ICONS[action.type] ?? ChevronRight;
                    const isPastAction =
                      animation.currentActionIndex >= 0 &&
                      idx < animation.currentActionIndex;
                    const isCurrentAction =
                      idx === animation.currentActionIndex;
                    const color = ACTION_COLORS[action.type] ?? {
                      text: "text-gray-400",
                      bg: "bg-gray-500/15",
                      border: "border-gray-500/30",
                    };
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          stopAnimation();
                          setAnimation((prev) => ({
                            ...prev,
                            currentActionIndex: idx,
                            progress: 0,
                          }));
                        }}
                        className={`
                          flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] border transition-all
                          ${
                            isCurrentAction
                              ? `${color.bg} ${color.border} ${color.text} shadow-sm`
                              : isPastAction
                                ? "bg-green-500/10 border-green-500/30 text-green-400"
                                : "bg-surface-primary border-border-primary text-text-muted hover:border-brand-primary/30"
                          }
                        `}
                        title={`${ACTION_LABELS[action.type] ?? action.type}: ${action.target || action.url || action.text || ""}`}
                      >
                        <Icon className="size-2.5" />
                        <span>{idx + 1}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Progress indicator text */}
                <div className="mt-1.5 text-center text-[10px] text-text-muted">
                  {animation.currentActionIndex >= 0
                    ? `Action ${animation.currentActionIndex + 1} of ${selectedTransition.actions.length}`
                    : "Ready to play"}
                </div>
              </div>
            )}

            {/* Action sequence */}
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">
                Actions ({selectedTransition.actions.length})
              </h3>

              {selectedTransition.actions.length === 0 ? (
                <p className="text-xs text-text-muted">No actions defined.</p>
              ) : (
                <div className="space-y-2">
                  {selectedTransition.actions.map((action, idx) => {
                    const Icon = ACTION_ICONS[action.type] ?? ChevronRight;
                    const color = ACTION_COLORS[action.type] ?? {
                      text: "text-gray-400",
                      bg: "bg-gray-500/15",
                      border: "border-gray-500/30",
                    };
                    const isCurrent = idx === animation.currentActionIndex;
                    const isPast =
                      animation.currentActionIndex >= 0 &&
                      idx < animation.currentActionIndex;

                    return (
                      <div
                        key={idx}
                        className={`
                          flex items-start gap-3 p-3 rounded-lg border transition-all duration-200
                          ${
                            isCurrent
                              ? `${color.border} ${color.bg} shadow-sm`
                              : isPast
                                ? "border-green-500/30 bg-green-500/5"
                                : "border-border-primary bg-surface-secondary"
                          }
                        `}
                      >
                        {/* Action index + icon */}
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-text-muted font-mono w-4 text-right">
                            {idx + 1}
                          </span>
                          <div
                            className={`p-1.5 rounded-md ${color.bg} ${color.text}`}
                          >
                            <Icon className="size-3.5" />
                          </div>
                        </div>

                        {/* Action details */}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-text-primary flex items-center gap-1.5">
                            <span>
                              {ACTION_LABELS[action.type] ?? action.type}
                            </span>
                            {isCurrent && animation.isPlaying && (
                              <span
                                className={`animate-pulse ${color.text} text-[10px]`}
                              >
                                {ACTION_ACTIVE_LABELS[action.type]}
                              </span>
                            )}
                          </div>

                          {/* Action target details */}
                          {action.target && (
                            <code className="text-[10px] text-text-muted mt-0.5 block truncate bg-surface-primary/50 px-1 py-0.5 rounded">
                              {action.target}
                            </code>
                          )}
                          {action.text && (
                            <div className="text-[10px] text-text-muted mt-0.5 font-mono bg-surface-primary/50 px-1 py-0.5 rounded">
                              &ldquo;
                              {isCurrent && animation.isPlaying
                                ? action.text.slice(
                                    0,
                                    Math.floor(
                                      action.text.length * animation.progress
                                    )
                                  )
                                : action.text}
                              &rdquo;
                              {isCurrent && animation.isPlaying && (
                                <span className="animate-pulse text-brand-primary">
                                  |
                                </span>
                              )}
                            </div>
                          )}
                          {action.url && (
                            <code className="text-[10px] text-cyan-400 mt-0.5 block truncate bg-surface-primary/50 px-1 py-0.5 rounded">
                              {action.url}
                            </code>
                          )}
                          {action.delay_ms != null && (
                            <span className="text-[10px] text-text-muted mt-0.5 block">
                              {action.delay_ms}ms
                              {isCurrent && animation.isPlaying && (
                                <span className="ml-1 text-text-muted/70">
                                  (
                                  {Math.round(
                                    animation.progress * (action.delay_ms ?? 0)
                                  )}
                                  ms elapsed)
                                </span>
                              )}
                            </span>
                          )}
                        </div>

                        {/* Status indicator with action-specific animation */}
                        {isPast && (
                          <div className="text-green-500 shrink-0 mt-0.5">
                            <svg
                              className="size-4"
                              viewBox="0 0 16 16"
                              fill="currentColor"
                            >
                              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                            </svg>
                          </div>
                        )}
                        {isCurrent && animation.isPlaying && (
                          <div className="shrink-0 mt-0.5">
                            {action.type === "click" ? (
                              /* Click ripple animation */
                              <div className="relative w-5 h-5 flex items-center justify-center">
                                <div className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping" />
                                <div className="w-2 h-2 rounded-full bg-blue-400" />
                              </div>
                            ) : action.type === "navigate" ? (
                              /* Navigation arrow animation */
                              <div className="relative w-5 h-5 flex items-center justify-center overflow-hidden">
                                <ArrowRight
                                  className="size-4 text-cyan-400 animate-bounce"
                                  style={{ animationDuration: "0.6s" }}
                                />
                              </div>
                            ) : action.type === "type" ? (
                              /* Typing cursor blink animation */
                              <div className="relative w-5 h-5 flex items-center justify-center">
                                <div
                                  className="w-0.5 h-3.5 bg-amber-400 animate-pulse"
                                  style={{ animationDuration: "0.5s" }}
                                />
                              </div>
                            ) : action.type === "select" ? (
                              /* Select dropdown animation */
                              <div className="relative w-5 h-5 flex items-center justify-center">
                                <ChevronRight
                                  className="size-3.5 text-purple-400 animate-bounce"
                                  style={{
                                    animationDuration: "0.8s",
                                    transform: "rotate(90deg)",
                                  }}
                                />
                              </div>
                            ) : action.type === "wait" ? (
                              /* Wait timer animation */
                              <div className="relative w-5 h-5 flex items-center justify-center">
                                <div
                                  className="w-4 h-4 rounded-full border-2 border-gray-400/40 border-t-gray-400 animate-spin"
                                  style={{ animationDuration: "1.5s" }}
                                />
                              </div>
                            ) : (
                              /* Default spinner */
                              <div
                                className={`w-4 h-4 rounded-full border-2 ${color.text} border-current border-t-transparent animate-spin`}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="text-xs text-text-muted space-y-1 pt-3 border-t border-border-primary">
              <div>Path Cost: {selectedTransition.path_cost}</div>
              <div>
                Stays Visible: {selectedTransition.stays_visible ? "Yes" : "No"}
              </div>
              <div>
                ID:{" "}
                <code className="bg-surface-secondary px-1 rounded">
                  {selectedTransition.transition_id}
                </code>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-text-muted">
            <div className="text-center">
              <GitBranch className="size-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a transition to view its details</p>
              <p className="text-xs mt-1 text-text-muted/70">
                {transitions.length} transition
                {transitions.length !== 1 ? "s" : ""} available
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
