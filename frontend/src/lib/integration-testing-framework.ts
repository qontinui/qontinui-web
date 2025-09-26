/**
 * Integration Testing Framework for Qontinui Web
 *
 * Based on Qontinui's ActionHistory and ActionSnapshot design
 * Extends with screenshot management for web-based testing
 */

import { Screenshot } from '../types/Screenshot';
import { State } from '../contexts/automation-context/types';

/**
 * ActionSnapshot with screenshot reference
 * Extends Qontinui's ActionRecord concept with screenshot information
 */
export interface ActionSnapshot {
  // Core ActionRecord fields
  id: string;
  timestamp: Date;
  actionType: 'FIND' | 'CLICK' | 'TYPE' | 'DRAG' | 'SCROLL' | 'WAIT';
  actionConfig: any; // Action configuration used

  // Match results
  matches: Array<{
    region: { x: number; y: number; width: number; height: number };
    score: number;
    stateImageId?: string;
  }>;

  // State context
  stateName: string;
  stateId: string;
  activeStates: string[]; // All states active at this moment

  // Success indicators
  actionSuccess: boolean;
  resultSuccess: boolean;

  // Screenshot management (new for web testing)
  screenshotId: string; // Current screenshot when action was taken
  nextScreenshotId?: string; // Screenshot to transition to after action

  // Timing
  duration: number;

  // Text results (for TYPE actions)
  text?: string;
}

/**
 * State activation rules
 * Defines which states should be active initially or after transitions
 */
export interface StateActivationRules {
  // Initial states (marked with decorator in Qontinui)
  initialStates: string[];

  // State dependencies (state A requires state B to be active)
  dependencies: Map<string, string[]>;

  // Mutual exclusions (states that cannot be active simultaneously)
  exclusions: Map<string, string[]>;
}

/**
 * Integration Test Scenario
 * Defines a complete test flow with screenshots and expected actions
 */
export interface TestScenario {
  id: string;
  name: string;
  description: string;

  // Screenshots in order
  screenshots: Screenshot[];

  // State definitions
  states: State[];

  // Activation rules
  activationRules: StateActivationRules;

  // Action snapshots that define the flow
  snapshots: ActionSnapshot[];

  // Expected outcomes
  expectedFinalStates: string[];
  expectedSuccess: boolean;
}

/**
 * Integration Test Engine
 * Manages test execution using ActionHistory pattern
 */
export class IntegrationTestEngine {
  private actionHistory: ActionSnapshot[] = [];
  private currentScreenshotIndex: number = 0;
  private activeStates: Set<string> = new Set();
  private scenario: TestScenario | null = null;

  constructor() {}

  /**
   * Initialize with a test scenario
   */
  loadScenario(scenario: TestScenario) {
    this.scenario = scenario;
    this.actionHistory = [];
    this.currentScreenshotIndex = 0;
    this.activeStates = new Set();

    // Activate initial states
    this.activateInitialStates();
  }

  /**
   * Activate initial states based on rules
   */
  private activateInitialStates() {
    if (!this.scenario) return;

    // Activate states marked as initial
    this.scenario.activationRules.initialStates.forEach(stateId => {
      this.activeStates.add(stateId);
    });

    // Search for StateImages in first screenshot to activate states
    this.detectStatesInCurrentScreenshot();
  }

  /**
   * Detect states in current screenshot by finding StateImages
   * This is the core of Qontinui's state activation
   */
  private async detectStatesInCurrentScreenshot(): Promise<void> {
    if (!this.scenario) return;

    const currentScreenshot = this.getCurrentScreenshot();
    if (!currentScreenshot) return;

    // For each state, check if any StateImage is found
    for (const state of this.scenario.states) {
      if (state.stateImages && state.stateImages.length > 0) {
        // In real implementation, would call qontinui API to find images
        // For now, simulate based on screenshot associations
        if (currentScreenshot.associatedStates.includes(state.id)) {
          this.activateState(state.id);
        }
      }
    }
  }

  /**
   * Activate a state with dependency checking
   */
  private activateState(stateId: string) {
    if (!this.scenario) return;

    // Check dependencies
    const dependencies = this.scenario.activationRules.dependencies.get(stateId);
    if (dependencies) {
      const allDependenciesMet = dependencies.every(dep => this.activeStates.has(dep));
      if (!allDependenciesMet) {
        console.warn(`Cannot activate ${stateId}: dependencies not met`);
        return;
      }
    }

    // Check exclusions
    const exclusions = this.scenario.activationRules.exclusions.get(stateId);
    if (exclusions) {
      exclusions.forEach(excluded => {
        if (this.activeStates.has(excluded)) {
          console.log(`Deactivating ${excluded} due to exclusion with ${stateId}`);
          this.activeStates.delete(excluded);
        }
      });
    }

    this.activeStates.add(stateId);
  }

  /**
   * Get current screenshot
   */
  getCurrentScreenshot(): Screenshot | null {
    if (!this.scenario) return null;
    return this.scenario.screenshots[this.currentScreenshotIndex] || null;
  }

  /**
   * Execute an action and record snapshot
   */
  async executeAction(actionType: string, config: any): Promise<ActionSnapshot> {
    if (!this.scenario) throw new Error('No scenario loaded');

    const startTime = Date.now();
    const currentScreenshot = this.getCurrentScreenshot();
    if (!currentScreenshot) throw new Error('No current screenshot');

    // Find matching snapshot for this action in current state
    const matchingSnapshot = this.findMatchingSnapshot(actionType, Array.from(this.activeStates));

    if (!matchingSnapshot) {
      // No snapshot found - action fails
      const failureSnapshot: ActionSnapshot = {
        id: generateId(),
        timestamp: new Date(),
        actionType: actionType as any,
        actionConfig: config,
        matches: [],
        stateName: Array.from(this.activeStates)[0] || 'UNKNOWN',
        stateId: Array.from(this.activeStates)[0] || 'UNKNOWN',
        activeStates: Array.from(this.activeStates),
        actionSuccess: false,
        resultSuccess: false,
        screenshotId: currentScreenshot.id,
        duration: Date.now() - startTime
      };

      this.actionHistory.push(failureSnapshot);
      return failureSnapshot;
    }

    // Execute based on snapshot
    const executedSnapshot: ActionSnapshot = {
      ...matchingSnapshot,
      id: generateId(),
      timestamp: new Date(),
      duration: Date.now() - startTime,
      activeStates: Array.from(this.activeStates)
    };

    this.actionHistory.push(executedSnapshot);

    // Handle screenshot transition
    if (matchingSnapshot.nextScreenshotId) {
      this.transitionToScreenshot(matchingSnapshot.nextScreenshotId);
    }

    return executedSnapshot;
  }

  /**
   * Find matching snapshot for current action and state
   * This implements Qontinui's get_random_snapshot logic
   */
  private findMatchingSnapshot(
    actionType: string,
    activeStates: string[]
  ): ActionSnapshot | undefined {
    if (!this.scenario) return undefined;

    // Filter snapshots by action type
    const candidates = this.scenario.snapshots.filter(s => s.actionType === actionType);

    if (candidates.length === 0) return undefined;

    // Prefer snapshots matching current active states
    const exactMatches = candidates.filter(s =>
      activeStates.includes(s.stateId)
    );

    if (exactMatches.length > 0) {
      // Return random from exact matches (simulating Qontinui's random selection)
      return exactMatches[Math.floor(Math.random() * exactMatches.length)];
    }

    // Try snapshots with overlapping active states
    const overlapMatches = candidates.filter(s =>
      s.activeStates.some(state => activeStates.includes(state))
    );

    if (overlapMatches.length > 0) {
      return overlapMatches[Math.floor(Math.random() * overlapMatches.length)];
    }

    // Fall back to any snapshot of correct type
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /**
   * Transition to a new screenshot
   */
  private transitionToScreenshot(screenshotId: string) {
    if (!this.scenario) return;

    const newIndex = this.scenario.screenshots.findIndex(s => s.id === screenshotId);
    if (newIndex >= 0) {
      this.currentScreenshotIndex = newIndex;

      // Re-detect states in new screenshot
      this.detectStatesInCurrentScreenshot();
    }
  }

  /**
   * Get action history
   */
  getActionHistory(): ActionSnapshot[] {
    return this.actionHistory;
  }

  /**
   * Get current active states
   */
  getActiveStates(): string[] {
    return Array.from(this.activeStates);
  }

  /**
   * Check if a state is active
   */
  isStateActive(stateId: string): boolean {
    return this.activeStates.has(stateId);
  }

  /**
   * Run complete scenario
   */
  async runScenario(): Promise<{
    success: boolean;
    finalStates: string[];
    history: ActionSnapshot[];
  }> {
    if (!this.scenario) throw new Error('No scenario loaded');

    // Execute all snapshots in order
    for (const snapshot of this.scenario.snapshots) {
      await this.executeAction(snapshot.actionType, snapshot.actionConfig);
    }

    // Check final state
    const finalStates = this.getActiveStates();
    const success = this.scenario.expectedFinalStates.every(state =>
      finalStates.includes(state)
    );

    return {
      success,
      finalStates,
      history: this.actionHistory
    };
  }
}

/**
 * Helper to generate unique IDs
 */
function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

/**
 * Create test scenario from screenshots and states
 */
export function createTestScenario(
  name: string,
  screenshots: Screenshot[],
  states: State[],
  initialStateIds: string[]
): TestScenario {
  return {
    id: generateId(),
    name,
    description: `Integration test with ${screenshots.length} screenshots`,
    screenshots,
    states,
    activationRules: {
      initialStates: initialStateIds,
      dependencies: new Map(),
      exclusions: new Map()
    },
    snapshots: [],
    expectedFinalStates: [],
    expectedSuccess: true
  };
}

/**
 * Record action snapshots from manual execution
 * This allows building test scenarios by recording user actions
 */
export class SnapshotRecorder {
  private snapshots: ActionSnapshot[] = [];
  private currentScreenshot: Screenshot | null = null;
  private activeStates: Set<string> = new Set();

  startRecording(screenshot: Screenshot, activeStates: string[]) {
    this.currentScreenshot = screenshot;
    this.activeStates = new Set(activeStates);
    this.snapshots = [];
  }

  recordAction(
    actionType: ActionSnapshot['actionType'],
    matches: any[],
    nextScreenshot?: Screenshot
  ): ActionSnapshot {
    if (!this.currentScreenshot) throw new Error('No current screenshot');

    const snapshot: ActionSnapshot = {
      id: generateId(),
      timestamp: new Date(),
      actionType,
      actionConfig: {}, // Would include actual config
      matches,
      stateName: Array.from(this.activeStates)[0] || 'UNKNOWN',
      stateId: Array.from(this.activeStates)[0] || 'UNKNOWN',
      activeStates: Array.from(this.activeStates),
      actionSuccess: matches.length > 0,
      resultSuccess: matches.length > 0,
      screenshotId: this.currentScreenshot.id,
      nextScreenshotId: nextScreenshot?.id,
      duration: 0
    };

    this.snapshots.push(snapshot);

    if (nextScreenshot) {
      this.currentScreenshot = nextScreenshot;
    }

    return snapshot;
  }

  getSnapshots(): ActionSnapshot[] {
    return this.snapshots;
  }

  stopRecording(): ActionSnapshot[] {
    const result = this.snapshots;
    this.snapshots = [];
    this.currentScreenshot = null;
    this.activeStates.clear();
    return result;
  }
}
