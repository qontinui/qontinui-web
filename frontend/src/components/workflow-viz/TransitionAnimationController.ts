/**
 * Transition Animation Controller
 *
 * State machine for controlling transition visualization animations.
 * Handles action sequencing, playback controls, and animation timing.
 */

import {
  TransitionAnimationState,
  TransitionVisualizationData,
  ActionAnimationConfig,
  INITIAL_ANIMATION_STATE,
  ANIMATION_DURATIONS,
  TYPE_CHAR_DURATION,
  INTER_ACTION_DELAY,
  getActionCategory,
  isBranchingAction,
} from "@/types/transition-animation";
import type {
  Transition,
  OutgoingTransition,
  IncomingTransition,
  State,
} from "@/contexts/automation-context/types";
import type {
  Workflow,
  Action,
  Connections,
} from "@/lib/action-schema/action-types";
import type { Monitor } from "@/lib/schemas/geometry";
import { EASING_FUNCTIONS } from "@/components/workflow-canvas/layout-animation";

// ============================================================================
// Controller Class
// ============================================================================

export class TransitionAnimationController {
  private state: TransitionAnimationState;
  private data: TransitionVisualizationData | null = null;
  private monitors: Monitor[] = [];
  private animationFrameId: number | null = null;
  private startTime: number = 0;
  private onStateChange: (state: TransitionAnimationState) => void;

  constructor(onStateChange: (state: TransitionAnimationState) => void) {
    this.state = { ...INITIAL_ANIMATION_STATE };
    this.onStateChange = onStateChange;
  }

  // ==========================================================================
  // Data Loading
  // ==========================================================================

  /**
   * Load a transition for visualization
   */
  loadTransition(
    transition: Transition,
    states: State[],
    workflows: Workflow[],
    monitors: Monitor[] = []
  ): void {
    // Store monitors for coordinate translation
    this.monitors = monitors;
    this.cancel();

    // Build visualization data
    const transitionWorkflows = transition.workflows
      .map((wfId) => workflows.find((w) => w.id === wfId))
      .filter((w): w is Workflow => w !== undefined);

    // Determine origin and target states
    const originStates: State[] = [];
    const targetStates: State[] = [];
    const deactivatedStates: State[] = [];
    const activatedStates: State[] = [];

    if (transition.type === "OutgoingTransition") {
      const outgoing = transition as OutgoingTransition;

      // Origin is the fromState
      const fromState = states.find((s) => s.id === outgoing.fromState);
      if (fromState) originStates.push(fromState);

      // Activated states
      for (const stateId of outgoing.activateStates) {
        const state = states.find((s) => s.id === stateId);
        if (state) {
          activatedStates.push(state);
          targetStates.push(state);
        }
      }

      // If staysVisible, fromState is also in target
      if (outgoing.staysVisible && fromState) {
        targetStates.push(fromState);
      }

      // Deactivated states
      for (const stateId of outgoing.deactivateStates) {
        const state = states.find((s) => s.id === stateId);
        if (state) deactivatedStates.push(state);
      }

      // If not staysVisible, fromState is deactivated
      if (
        !outgoing.staysVisible &&
        fromState &&
        !deactivatedStates.includes(fromState)
      ) {
        deactivatedStates.push(fromState);
      }
    } else {
      const incoming = transition as IncomingTransition;
      const toState = states.find((s) => s.id === incoming.toState);
      if (toState) {
        targetStates.push(toState);
        activatedStates.push(toState);
      }
    }

    // Build action sequence from workflows
    const actionSequence = this.buildActionSequence(
      transitionWorkflows,
      states
    );

    this.data = {
      transition,
      originStates,
      targetStates,
      deactivatedStates,
      activatedStates,
      workflows: transitionWorkflows,
      actionSequence,
    };

    // Reset to initial state
    this.state = {
      ...INITIAL_ANIMATION_STATE,
      phase: "showing-initial",
      totalActions: actionSequence.length,
    };
    this.emitState();
  }

  /**
   * Build flattened action sequence from workflows
   */
  private buildActionSequence(
    workflows: Workflow[],
    states: State[]
  ): ActionAnimationConfig[] {
    const sequence: ActionAnimationConfig[] = [];
    let globalIndex = 0;

    for (const workflow of workflows) {
      // Topological sort of actions
      const sortedActions = this.topologicalSort(
        workflow.actions,
        workflow.connections
      );

      for (const action of sortedActions) {
        // Add branch indicator for branching actions
        if (isBranchingAction(action.type)) {
          sequence.push({
            id: `branch-start-${action.id}`,
            actionId: action.id,
            type: "BRANCH_START",
            category: "branch",
            name: `Branch: ${action.name || action.type}`,
            duration: ANIMATION_DURATIONS.branch,
            branchCount: this.getBranchCount(action, workflow.connections),
            branchLabels: this.getBranchLabels(action),
          });
        }

        // Build animation config for the action
        const config = this.actionToAnimationConfig(
          action,
          states,
          globalIndex
        );
        sequence.push(config);
        globalIndex++;

        // Add branch end indicator
        if (isBranchingAction(action.type)) {
          sequence.push({
            id: `branch-end-${action.id}`,
            actionId: action.id,
            type: "BRANCH_END",
            category: "branch",
            name: "Branch End",
            duration: 0,
          });
        }
      }
    }

    return sequence;
  }

  /**
   * Topological sort of actions based on connections
   */
  private topologicalSort(
    actions: Action[],
    connections: Connections
  ): Action[] {
    const sorted: Action[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    // Build adjacency list
    const adjacency = new Map<string, string[]>();
    for (const action of actions) {
      adjacency.set(action.id, []);
    }

    for (const [sourceId, outputs] of Object.entries(connections)) {
      if (outputs.main) {
        for (const outputConnections of outputs.main) {
          for (const conn of outputConnections) {
            const targets = adjacency.get(sourceId) || [];
            targets.push(conn.action);
            adjacency.set(sourceId, targets);
          }
        }
      }
    }

    // Find entry points (actions with no incoming connections)
    const hasIncoming = new Set<string>();
    for (const targets of adjacency.values()) {
      for (const target of targets) {
        hasIncoming.add(target);
      }
    }

    const entryPoints = actions.filter((a) => !hasIncoming.has(a.id));

    // DFS from entry points
    const visit = (actionId: string) => {
      if (visited.has(actionId)) return;
      if (visiting.has(actionId)) return; // Cycle detection

      visiting.add(actionId);

      const action = actions.find((a) => a.id === actionId);
      if (action) {
        sorted.push(action);
        visited.add(actionId);
      }

      visiting.delete(actionId);

      // Visit successors
      const successors = adjacency.get(actionId) || [];
      for (const successor of successors) {
        visit(successor);
      }
    };

    // Start from entry points
    for (const entry of entryPoints) {
      visit(entry.id);
    }

    // Add any remaining actions not reachable from entry points
    for (const action of actions) {
      if (!visited.has(action.id)) {
        sorted.push(action);
      }
    }

    return sorted;
  }

  /**
   * Convert an action to animation configuration
   */
  private actionToAnimationConfig(
    action: Action,
    states: State[],
    index: number
  ): ActionAnimationConfig {
    const category = getActionCategory(action.type);
    const config = action.config as Record<string, unknown>;

    // Base configuration
    const animConfig: ActionAnimationConfig = {
      id: `action-${index}-${action.id}`,
      actionId: action.id,
      type: action.type,
      category,
      name: action.name || action.type,
      duration: this.getActionDuration(action),
    };

    // Extract position/region information based on action type
    switch (action.type) {
      case "CLICK":
      case "MOUSE_DOWN":
      case "MOUSE_UP": {
        if (config.x !== undefined && config.y !== undefined) {
          // Explicit coordinates
          animConfig.endPosition = {
            x: config.x as number,
            y: config.y as number,
          };
        } else {
          // Try to resolve position from target
          const pos = this.resolveClickTargetPosition(config, states);
          if (pos) {
            animConfig.endPosition = pos;
          }
        }
        break;
      }

      case "FIND":
      case "VANISH":
      case "RAG_FIND": {
        // FindActionConfig uses: target (TargetConfig object with type, imageId/stateImageId)
        const targetConfig = config.target as
          | Record<string, unknown>
          | undefined;
        const { stateImageId, imageId } =
          this.extractImageIdsFromTarget(targetConfig);

        // Try stateImageId first, then fall back to finding StateImage by imageAssetId
        let resolvedStateImageId = stateImageId;
        if (!resolvedStateImageId && imageId) {
          resolvedStateImageId = this.findStateImageByImageAssetId(
            imageId,
            states
          );
        }

        if (resolvedStateImageId) {
          const region = this.getStateImageRegion(resolvedStateImageId, states);
          if (region) {
            animConfig.targetRegion = region;
            animConfig.targetImageId = resolvedStateImageId;
            if (process.env.NODE_ENV === "development") {
              console.log(
                `[TransitionAnimation] actionToAnimationConfig: ${action.type} action="${action.name}" ` +
                  `resolved region: (${region.x}, ${region.y}, ${region.width}x${region.height}), ` +
                  `stateImageId="${resolvedStateImageId}"`
              );
            }
          }
        } else {
          if (process.env.NODE_ENV === "development") {
            console.log(
              `[TransitionAnimation] actionToAnimationConfig: ${action.type} action="${action.name}" ` +
                `could NOT resolve stateImageId, target=`,
              targetConfig
            );
          }
        }
        break;
      }

      case "TYPE": {
        animConfig.text = (config.text as string) || "";
        if (config.x !== undefined && config.y !== undefined) {
          animConfig.endPosition = {
            x: config.x as number,
            y: config.y as number,
          };
        }
        break;
      }

      case "DRAG": {
        if (config.startX !== undefined && config.startY !== undefined) {
          animConfig.startPosition = {
            x: config.startX as number,
            y: config.startY as number,
          };
        }
        if (config.endX !== undefined && config.endY !== undefined) {
          animConfig.endPosition = {
            x: config.endX as number,
            y: config.endY as number,
          };
        }
        break;
      }

      case "SCROLL": {
        animConfig.direction =
          (config.direction as "up" | "down" | "left" | "right") || "down";
        if (config.x !== undefined && config.y !== undefined) {
          animConfig.endPosition = {
            x: config.x as number,
            y: config.y as number,
          };
        }
        break;
      }

      case "MOUSE_MOVE": {
        if (config.fromX !== undefined && config.fromY !== undefined) {
          animConfig.startPosition = {
            x: config.fromX as number,
            y: config.fromY as number,
          };
        }
        if (config.x !== undefined && config.y !== undefined) {
          animConfig.endPosition = {
            x: config.x as number,
            y: config.y as number,
          };
        }
        break;
      }

      case "KEY_PRESS":
      case "HOTKEY": {
        animConfig.label =
          (config.key as string) ||
          (config.keys as string[])?.join("+") ||
          "KEY";
        break;
      }

      case "GO_TO_STATE": {
        animConfig.targetStateIds = config.targetStateIds as string[];
        animConfig.label =
          (config.targetStateIds as string[])?.join(", ") || "State";
        break;
      }

      case "SET_VARIABLE": {
        animConfig.label = `${config.name || "var"} = ${config.value || "..."}`;
        break;
      }

      case "CODE_BLOCK": {
        animConfig.label = "Code Block";
        break;
      }

      case "AI_PROMPT": {
        animConfig.label = "AI Prompt";
        break;
      }

      default: {
        animConfig.label = action.name || action.type;
      }
    }

    return animConfig;
  }

  /**
   * Get duration for an action
   */
  private getActionDuration(action: Action): number {
    const category = getActionCategory(action.type);

    if (action.type === "TYPE") {
      const text = (action.config as { text?: string }).text || "";
      return Math.max(400, text.length * TYPE_CHAR_DURATION + 200);
    }

    return ANIMATION_DURATIONS[category] || 400;
  }

  /**
   * Get position from a state image
   * Coordinates are returned as absolute screen coordinates (suitable for canvas rendering)
   *
   * The position is determined from searchRegions, which contain the on-screen location
   * where the pattern was captured. pattern.offsetX/offsetY are click offsets (not position).
   */
  private getStateImagePosition(
    stateImageId: string,
    states: State[]
  ): { x: number; y: number } | undefined {
    // Build monitor map for coordinate translation
    const monitorMap = new Map<number, Monitor>();
    this.monitors.forEach((m) => monitorMap.set(m.index, m));

    for (const state of states) {
      for (const stateImage of state.stateImages || []) {
        if (stateImage.id === stateImageId) {
          const monitorIndex = stateImage.monitors?.[0] ?? 0;
          const monitor = monitorMap.get(monitorIndex);
          const pattern = stateImage.patterns?.[0];

          // Try pattern's searchRegions first (preferred source)
          if (pattern?.searchRegions?.[0]) {
            const sr = pattern.searchRegions[0];
            const absX = monitor ? monitor.x + sr.x : sr.x;
            const absY = monitor ? monitor.y + sr.y : sr.y;
            return {
              x: absX + sr.width / 2,
              y: absY + sr.height / 2,
            };
          }

          // Try StateImage-level searchRegions
          if (stateImage.searchRegions?.[0]) {
            const sr = stateImage.searchRegions[0];
            const absX = monitor ? monitor.x + sr.x : sr.x;
            const absY = monitor ? monitor.y + sr.y : sr.y;
            return {
              x: absX + sr.width / 2,
              y: absY + sr.height / 2,
            };
          }

          // Fallback: try pattern.offsetX/offsetY (legacy data may store position here)
          if (
            pattern?.offsetX !== undefined &&
            pattern?.offsetY !== undefined
          ) {
            const absX = monitor
              ? monitor.x + pattern.offsetX
              : pattern.offsetX;
            const absY = monitor
              ? monitor.y + pattern.offsetY
              : pattern.offsetY;
            const width = pattern.searchRegions?.[0]?.width || 50;
            const height = pattern.searchRegions?.[0]?.height || 50;
            return {
              x: absX + width / 2,
              y: absY + height / 2,
            };
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Get region from a state image
   * Coordinates are returned as absolute screen coordinates (suitable for canvas rendering)
   */
  private getStateImageRegion(
    stateImageId: string,
    states: State[]
  ): { x: number; y: number; width: number; height: number } | undefined {
    // Build monitor map for coordinate translation
    const monitorMap = new Map<number, Monitor>();
    this.monitors.forEach((m) => monitorMap.set(m.index, m));

    for (const state of states) {
      for (const stateImage of state.stateImages || []) {
        if (stateImage.id === stateImageId) {
          const monitorIndex = stateImage.monitors?.[0] ?? 0;
          const monitor = monitorMap.get(monitorIndex);
          const pattern = stateImage.patterns?.[0];

          // Try pattern's searchRegions first
          if (pattern?.searchRegions?.[0]) {
            const sr = pattern.searchRegions[0];
            const absX = monitor ? monitor.x + sr.x : sr.x;
            const absY = monitor ? monitor.y + sr.y : sr.y;
            return { x: absX, y: absY, width: sr.width, height: sr.height };
          }

          // Try StateImage-level searchRegions
          if (stateImage.searchRegions?.[0]) {
            const sr = stateImage.searchRegions[0];
            const absX = monitor ? monitor.x + sr.x : sr.x;
            const absY = monitor ? monitor.y + sr.y : sr.y;
            return { x: absX, y: absY, width: sr.width, height: sr.height };
          }

          // Fallback: try pattern.offsetX/offsetY (legacy data)
          if (
            pattern?.offsetX !== undefined &&
            pattern?.offsetY !== undefined
          ) {
            const absX = monitor
              ? monitor.x + pattern.offsetX
              : pattern.offsetX;
            const absY = monitor
              ? monitor.y + pattern.offsetY
              : pattern.offsetY;
            return { x: absX, y: absY, width: 100, height: 100 };
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Extract image ID from a target configuration.
   */
  private extractImageIdsFromTarget(
    targetConfig: Record<string, unknown> | undefined
  ): { stateImageId?: string; imageId?: string } {
    if (!targetConfig) return {};

    const targetType = targetConfig.type as string | undefined;

    switch (targetType) {
      case "stateImage":
        return { stateImageId: targetConfig.stateImageId as string | undefined };

      case "StateImage":
      case "image":
        if (targetConfig.imageId) {
          return { imageId: targetConfig.imageId as string };
        }
        if (Array.isArray(targetConfig.imageIds) && targetConfig.imageIds.length > 0) {
          return { imageId: targetConfig.imageIds[0] as string };
        }
        return {};

      default:
        if (targetConfig.stateImageId) {
          return { stateImageId: targetConfig.stateImageId as string };
        }
        if (targetConfig.imageId) {
          return { imageId: targetConfig.imageId as string };
        }
        if (Array.isArray(targetConfig.imageIds) && targetConfig.imageIds.length > 0) {
          return { imageId: targetConfig.imageIds[0] as string };
        }
        return {};
    }
  }

  /**
   * Find a StateImage that uses a given ImageAsset ID
   */
  private findStateImageByImageAssetId(
    imageAssetId: string,
    states: State[]
  ): string | undefined {
    for (const state of states) {
      for (const stateImage of state.stateImages || []) {
        for (const pattern of stateImage.patterns || []) {
          if (pattern.imageId === imageAssetId) {
            return stateImage.id;
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Resolve click target position from action config.
   */
  private resolveClickTargetPosition(
    config: Record<string, unknown>,
    states: State[]
  ): { x: number; y: number } | undefined {
    const target = config.target as string | Record<string, unknown> | undefined;

    // Handle string target types (ClickActionConfig format)
    if (typeof target === "string") {
      switch (target) {
        case "StateImage": {
          const stateImageId = config.stateImageId as string | undefined;
          const imageId = config.imageId as string | undefined;
          const imageIds = config.imageIds as string[] | undefined;

          // Try stateImageId first (direct StateImage reference)
          if (stateImageId) {
            return this.getStateImagePosition(stateImageId, states);
          }

          // Try imageIds array - these are typically StateImage IDs
          if (imageIds && Array.isArray(imageIds) && imageIds.length > 0) {
            const firstId = imageIds[0] as string;
            // First try as StateImage ID
            const pos = this.getStateImagePosition(firstId, states);
            if (pos) return pos;
            // Fall back to ImageAsset ID
            const resolved = this.findStateImageByImageAssetId(firstId, states);
            if (resolved) return this.getStateImagePosition(resolved, states);
          }

          // Try single imageId field
          if (imageId) {
            const resolved = this.findStateImageByImageAssetId(imageId, states);
            if (resolved) return this.getStateImagePosition(resolved, states);
          }
          break;
        }

        case "StateLocation": {
          const locationId = config.locationId as string | undefined;
          if (locationId) {
            return this.getStateLocationPosition(locationId, states);
          }
          break;
        }

        case "Coordinates":
        case "Last Find Result":
        case "Current Position":
        default:
          return undefined;
      }
    }

    // Handle object target types
    if (typeof target === "object" && target !== null) {
      const { stateImageId, imageId } = this.extractImageIdsFromTarget(
        target as Record<string, unknown>
      );

      if (stateImageId) {
        const pos = this.getStateImagePosition(stateImageId, states);
        if (pos) return pos;
      }

      if (imageId) {
        // First try as StateImage ID
        const pos = this.getStateImagePosition(imageId, states);
        if (pos) return pos;
        // Fall back to ImageAsset ID lookup
        const resolved = this.findStateImageByImageAssetId(imageId, states);
        if (resolved) {
          const resolvedPos = this.getStateImagePosition(resolved, states);
          if (resolvedPos) return resolvedPos;
        }
      }
    }

    return undefined;
  }

  /**
   * Get position from a state location
   */
  private getStateLocationPosition(
    locationId: string,
    states: State[]
  ): { x: number; y: number } | undefined {
    for (const state of states) {
      for (const location of state.locations || []) {
        if (location.id === locationId) {
          // Location coordinates are absolute (no monitor offset needed for locations)
          if (location.x !== undefined && location.y !== undefined) {
            return { x: location.x, y: location.y };
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Get number of branches for a branching action
   */
  private getBranchCount(action: Action, connections: Connections): number {
    const actionConnections = connections[action.id];
    if (!actionConnections?.main) return 2;
    return actionConnections.main.length;
  }

  /**
   * Get branch labels for a branching action
   */
  private getBranchLabels(action: Action): string[] {
    switch (action.type) {
      case "IF":
        return ["true", "false"];
      case "TRY_CATCH":
        return ["success", "error"];
      case "SWITCH": {
        const config = action.config as { cases?: Array<{ value: string }> };
        return (
          config.cases?.map((c) => String(c.value)) || ["case 1", "case 2"]
        );
      }
      default:
        return [];
    }
  }

  // ==========================================================================
  // Playback Controls
  // ==========================================================================

  /**
   * Start or resume playback
   */
  play(): void {
    if (!this.data || this.state.phase === "completed") return;

    this.state.isPlaying = true;
    this.startTime = performance.now();
    this.animate();
    this.emitState();
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.state.isPlaying = false;
    this.cancelAnimationFrame();
    this.emitState();
  }

  /**
   * Step forward one action
   */
  stepForward(): void {
    if (!this.data) return;

    this.pause();

    if (this.state.phase === "showing-initial") {
      this.state.phase = "executing-action";
      this.state.currentActionIndex = 0;
      this.state.globalActionIndex = 0;
    } else if (this.state.phase === "executing-action") {
      if (this.state.globalActionIndex < this.data.actionSequence.length - 1) {
        this.state.globalActionIndex++;
        this.state.currentActionIndex++;
      } else {
        this.state.phase = "transitioning-states";
      }
    } else if (this.state.phase === "transitioning-states") {
      this.state.phase = "showing-final";
    } else if (this.state.phase === "showing-final") {
      this.state.phase = "completed";
    }

    this.state.progress = 0;
    this.emitState();
  }

  /**
   * Step backward one action
   */
  stepBackward(): void {
    if (!this.data) return;

    this.pause();

    if (this.state.phase === "completed") {
      this.state.phase = "showing-final";
    } else if (this.state.phase === "showing-final") {
      this.state.phase = "transitioning-states";
    } else if (this.state.phase === "transitioning-states") {
      this.state.phase = "executing-action";
      this.state.globalActionIndex = this.data.actionSequence.length - 1;
      this.state.currentActionIndex = this.state.globalActionIndex;
    } else if (this.state.phase === "executing-action") {
      if (this.state.globalActionIndex > 0) {
        this.state.globalActionIndex--;
        this.state.currentActionIndex--;
      } else {
        this.state.phase = "showing-initial";
      }
    }

    this.state.progress = 0;
    this.emitState();
  }

  /**
   * Reset to beginning
   */
  reset(): void {
    this.pause();

    this.state = {
      ...INITIAL_ANIMATION_STATE,
      phase: this.data ? "showing-initial" : "idle",
      totalActions: this.data?.actionSequence.length || 0,
      playbackSpeed: this.state.playbackSpeed,
    };

    this.emitState();
  }

  /**
   * Set playback speed
   */
  setSpeed(speed: number): void {
    this.state.playbackSpeed = speed;
    this.emitState();
  }

  /**
   * Seek to specific action index
   */
  seekTo(actionIndex: number): void {
    if (!this.data) return;

    this.pause();

    if (actionIndex < 0) {
      this.state.phase = "showing-initial";
      this.state.globalActionIndex = 0;
    } else if (actionIndex >= this.data.actionSequence.length) {
      this.state.phase = "showing-final";
      this.state.globalActionIndex = this.data.actionSequence.length - 1;
    } else {
      this.state.phase = "executing-action";
      this.state.globalActionIndex = actionIndex;
      this.state.currentActionIndex = actionIndex;
    }

    this.state.progress = 0;
    this.emitState();
  }

  /**
   * Cancel current animation
   */
  cancel(): void {
    this.pause();
    this.data = null;
    this.state = { ...INITIAL_ANIMATION_STATE };
    this.emitState();
  }

  // ==========================================================================
  // Animation Loop
  // ==========================================================================

  private animate = (): void => {
    if (!this.state.isPlaying || !this.data) return;

    const currentTime = performance.now();
    const elapsed = (currentTime - this.startTime) * this.state.playbackSpeed;

    // Get current phase duration
    const phaseDuration = this.getCurrentPhaseDuration();
    const progress = Math.min(elapsed / phaseDuration, 1);

    // Apply easing
    this.state.progress = EASING_FUNCTIONS.easeInOutCubic(progress);

    if (progress >= 1) {
      // Advance to next phase
      this.advancePhase();
      this.startTime = performance.now();
    }

    this.emitState();

    if (this.state.isPlaying && this.state.phase !== "completed") {
      this.animationFrameId = requestAnimationFrame(this.animate);
    }
  };

  private getCurrentPhaseDuration(): number {
    if (!this.data) return 1000;

    switch (this.state.phase) {
      case "showing-initial":
      case "showing-final":
        return ANIMATION_DURATIONS.phase / this.state.playbackSpeed;

      case "transitioning-states":
        return 600 / this.state.playbackSpeed;

      case "executing-action": {
        const action = this.data.actionSequence[this.state.globalActionIndex];
        if (!action) return 400;
        return (
          (action.duration + INTER_ACTION_DELAY) / this.state.playbackSpeed
        );
      }

      default:
        return 1000;
    }
  }

  private advancePhase(): void {
    if (!this.data) return;

    switch (this.state.phase) {
      case "showing-initial":
        if (this.data.actionSequence.length > 0) {
          this.state.phase = "executing-action";
          this.state.globalActionIndex = 0;
          this.state.currentActionIndex = 0;
        } else {
          this.state.phase = "transitioning-states";
        }
        break;

      case "executing-action":
        if (
          this.state.globalActionIndex <
          this.data.actionSequence.length - 1
        ) {
          this.state.globalActionIndex++;
          this.state.currentActionIndex++;
        } else {
          this.state.phase = "transitioning-states";
        }
        break;

      case "transitioning-states":
        this.state.phase = "showing-final";
        break;

      case "showing-final":
        this.state.phase = "completed";
        this.state.isPlaying = false;
        break;
    }

    this.state.progress = 0;
  }

  private cancelAnimationFrame(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private emitState(): void {
    this.onStateChange({ ...this.state });
  }

  // ==========================================================================
  // Getters
  // ==========================================================================

  getState(): TransitionAnimationState {
    return { ...this.state };
  }

  getData(): TransitionVisualizationData | null {
    return this.data;
  }

  getCurrentAction(): ActionAnimationConfig | null {
    if (!this.data || this.state.phase !== "executing-action") return null;
    return this.data.actionSequence[this.state.globalActionIndex] || null;
  }
}

// ============================================================================
// React Hook
// ============================================================================

import { useState, useRef, useEffect, useCallback, useMemo } from "react";

export interface UseTransitionAnimationResult {
  /** Current animation state */
  state: TransitionAnimationState;

  /** Current visualization data */
  data: TransitionVisualizationData | null;

  /** Currently animating action */
  currentAction: ActionAnimationConfig | null;

  /** Load a transition for visualization */
  loadTransition: (
    transition: Transition,
    states: State[],
    workflows: Workflow[],
    monitors?: Monitor[]
  ) => void;

  /** Playback controls */
  play: () => void;
  pause: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  reset: () => void;
  setSpeed: (speed: number) => void;
  seekTo: (actionIndex: number) => void;
  cancel: () => void;
}

/**
 * React hook for transition animation control
 */
export function useTransitionAnimation(): UseTransitionAnimationResult {
  const [state, setState] = useState<TransitionAnimationState>(
    INITIAL_ANIMATION_STATE
  );
  // Store data in state so it's reactive
  const [data, setData] = useState<TransitionVisualizationData | null>(null);
  const controllerRef = useRef<TransitionAnimationController | null>(null);

  useEffect(() => {
    // Create controller with a callback that updates both state and data
    controllerRef.current = new TransitionAnimationController((newState) => {
      setState(newState);
      // Also sync data from controller when state changes
      setData(controllerRef.current?.getData() || null);
    });

    return () => {
      controllerRef.current?.cancel();
    };
  }, []);

  const loadTransition = useCallback(
    (
      transition: Transition,
      states: State[],
      workflows: Workflow[],
      monitors?: Monitor[]
    ) => {
      controllerRef.current?.loadTransition(
        transition,
        states,
        workflows,
        monitors
      );
      // Immediately sync data after loading
      setData(controllerRef.current?.getData() || null);
    },
    []
  );

  const play = useCallback(() => controllerRef.current?.play(), []);
  const pause = useCallback(() => controllerRef.current?.pause(), []);
  const stepForward = useCallback(
    () => controllerRef.current?.stepForward(),
    []
  );
  const stepBackward = useCallback(
    () => controllerRef.current?.stepBackward(),
    []
  );
  const reset = useCallback(() => controllerRef.current?.reset(), []);
  const setSpeed = useCallback(
    (speed: number) => controllerRef.current?.setSpeed(speed),
    []
  );
  const seekTo = useCallback(
    (index: number) => controllerRef.current?.seekTo(index),
    []
  );
  const cancel = useCallback(() => {
    controllerRef.current?.cancel();
    setData(null);
  }, []);

  // Derive currentAction from state and data (reactive)
  const currentAction = useMemo(() => {
    if (!data || state.phase !== "executing-action") return null;
    return data.actionSequence[state.globalActionIndex] || null;
  }, [data, state.phase, state.globalActionIndex]);

  return {
    state,
    data,
    currentAction,
    loadTransition,
    play,
    pause,
    stepForward,
    stepBackward,
    reset,
    setSpeed,
    seekTo,
    cancel,
  };
}
