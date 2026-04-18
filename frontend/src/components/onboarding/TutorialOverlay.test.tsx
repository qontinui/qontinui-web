/**
 * TutorialOverlay Test Utilities and Examples
 *
 * This file provides test utilities and examples for testing the TutorialOverlay component.
 * Note: This is not a full test suite (no test runner), but rather a collection of
 * utilities and manual testing helpers.
 */

import { useOnboardingStore } from "@/stores/onboarding-store";
import { createLogger } from "@/lib/logger";

const log = createLogger("TutorialOverlayTest");

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Reset all onboarding state for testing
 */
export function resetOnboardingForTesting() {
  const { resetOnboarding } = useOnboardingStore.getState();
  resetOnboarding();
  log.debug("Onboarding state reset");
}

/**
 * Start tutorial for testing
 */
export function startTutorialForTesting() {
  const { startTour } = useOnboardingStore.getState();
  startTour();
  log.debug("Tutorial started");
}

/**
 * Skip to specific step for testing
 */
export function goToStepForTesting(step: number) {
  const { setTourStep } = useOnboardingStore.getState();
  setTourStep(step);
  log.debug(`Jumped to step ${step + 1}`);
}

/**
 * Check if all tour targets exist in the DOM
 */
export function validateTourTargets(): {
  valid: boolean;
  missing: string[];
  found: string[];
} {
  const targets = [
    '[data-tour="projects"]',
    '[data-tour="new-project"]',
    '[data-tour="quick-start"]',
    '[data-tour="documentation"]',
    '[data-tour="profile"]',
  ];

  const found: string[] = [];
  const missing: string[] = [];

  targets.forEach((selector) => {
    const element = document.querySelector(selector);
    if (element) {
      found.push(selector);
      log.debug(`[Test] ✓ Found: ${selector}`, element);
    } else {
      missing.push(selector);
      console.warn(`[Test] ✗ Missing: ${selector}`);
    }
  });

  return {
    valid: missing.length === 0,
    missing,
    found,
  };
}

/**
 * Log current onboarding state for debugging
 */
export function logOnboardingState() {
  const state = useOnboardingStore.getState();
  log.debug("[Test] Onboarding State");
  log.debug("Tutorial Active:", state.showTutorialOverlay);
  log.debug("Current Step:", state.currentTourStep + 1);
  log.debug("Has Started Tour:", state.hasStartedTour);
  log.debug("Has Completed Welcome:", state.hasCompletedWelcome);
  log.debug("Welcome Modal Visible:", state.showWelcomeModal);
  log.debug("Don't Show Again:", state.dontShowWelcomeAgain);
}

/**
 * Test keyboard navigation programmatically
 */
export function testKeyboardNavigation() {
  log.debug("[Test] Keyboard Navigation");

  // Test Right Arrow
  log.debug("Testing Right Arrow...");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));

  setTimeout(() => {
    // Test Left Arrow
    log.debug("Testing Left Arrow...");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
  }, 1000);

  setTimeout(() => {
    // Test Enter
    log.debug("Testing Enter...");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  }, 2000);

  setTimeout(() => {
    // Test Escape
    log.debug("Testing Escape...");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  }, 3000);
}

/**
 * Test tooltip positioning at different viewport sizes
 */
export function testTooltipPositioning() {
  const viewportSizes = [
    { width: 1920, height: 1080, name: "Desktop Large" },
    { width: 1366, height: 768, name: "Desktop Medium" },
    { width: 768, height: 1024, name: "Tablet" },
    { width: 375, height: 667, name: "Mobile" },
  ];

  log.debug("[Test] Tooltip Positioning");

  viewportSizes.forEach((size, index) => {
    setTimeout(() => {
      log.debug(`Testing ${size.name} (${size.width}x${size.height})`);
      // Note: This won&apos;t actually resize the window in most browsers
      // Manual testing required for different viewport sizes
      log.debug("Manual test required: Resize window to test positioning");
    }, index * 1000);
  });
}

/**
 * Simulate new user flow
 */
export function simulateNewUserFlow() {
  log.debug("[Test] New User Flow Simulation");

  // Step 1: Reset state
  log.debug("Step 1: Resetting onboarding state...");
  resetOnboardingForTesting();

  // Step 2: Show welcome modal
  setTimeout(() => {
    log.debug("Step 2: Showing welcome modal...");
    const { toggleWelcomeModal } = useOnboardingStore.getState();
    toggleWelcomeModal(true);
  }, 1000);

  // Step 3: Start tour from welcome modal
  setTimeout(() => {
    log.debug("Step 3: Starting tour from welcome modal...");
    const { completeWelcome, startTour } = useOnboardingStore.getState();
    completeWelcome();
    startTour();
  }, 3000);

  // Step 4: Navigate through steps
  setTimeout(() => {
    log.debug("Step 4: Auto-navigating through steps...");
    let currentStep = 0;
    const maxSteps = 5;

    const interval = setInterval(() => {
      if (currentStep < maxSteps - 1) {
        currentStep++;
        goToStepForTesting(currentStep);
      } else {
        clearInterval(interval);
        log.debug("Step 5: Tour completed!");
        const { completeTour } = useOnboardingStore.getState();
        completeTour();
      }
    }, 2000);
  }, 5000);
}

// ============================================================================
// Manual Test Scenarios
// ============================================================================

/**
 * Test Scenario 1: Basic Flow
 *
 * 1. Open browser console
 * 2. Run: testBasicFlow()
 * 3. Verify:
 *    - Tutorial starts
 *    - All targets are highlighted correctly
 *    - Navigation works
 *    - Tutorial completes
 */
export function testBasicFlow() {
  log.debug("[Test Scenario 1] Basic Flow");

  // Validate targets first
  const validation = validateTourTargets();
  if (!validation.valid) {
    console.error("[Test] Missing targets:", validation.missing);
    return;
  }

  // Start tutorial
  startTutorialForTesting();

  log.debug('[Test] Use arrow keys or click "Next" to navigate');
  log.debug("[Test] Press ESC to exit");
}

/**
 * Test Scenario 2: Skip Tutorial
 *
 * 1. Run: testSkipFlow()
 * 2. Verify:
 *    - Tutorial starts
 *    - Skip button works
 *    - State is marked as completed
 */
export function testSkipFlow() {
  log.debug("[Test Scenario 2] Skip Flow");

  // Start tutorial
  startTutorialForTesting();

  // Skip after 2 seconds
  setTimeout(() => {
    log.debug("[Test] Skipping tutorial...");
    const { skipTour } = useOnboardingStore.getState();
    skipTour();

    // Verify state
    setTimeout(() => {
      const state = useOnboardingStore.getState();
      log.debug("[Test] Tutorial active:", state.showTutorialOverlay);
      log.debug("[Test] Expected: false");
    }, 500);
  }, 2000);
}

/**
 * Test Scenario 3: Step Navigation
 *
 * 1. Run: testStepNavigation()
 * 2. Verify:
 *    - Can jump to any step
 *    - Previous button works
 *    - Next button works
 */
export function testStepNavigation() {
  log.debug("[Test Scenario 3] Step Navigation");

  // Start tutorial
  startTutorialForTesting();

  // Jump to different steps
  const steps = [0, 2, 4, 1, 3];
  steps.forEach((step, index) => {
    setTimeout(() => {
      log.debug(`[Test] Jumping to step ${step + 1}`);
      goToStepForTesting(step);
    }, index * 2000);
  });

  // Complete after all jumps
  setTimeout(
    () => {
      const { completeTour } = useOnboardingStore.getState();
      completeTour();
      log.debug("[Test] Tour completed");
    },
    steps.length * 2000 + 1000
  );
}

/**
 * Test Scenario 4: Persistence
 *
 * 1. Run: testPersistence()
 * 2. Navigate to step 3
 * 3. Refresh page
 * 4. Verify state is restored
 */
export function testPersistence() {
  log.debug("[Test Scenario 4] Persistence");

  // Start tutorial and go to step 3
  startTutorialForTesting();
  setTimeout(() => {
    goToStepForTesting(2); // Step 3 (0-indexed)

    log.debug("[Test] Now refresh the page and check localStorage");
    log.debug("[Test] State should be preserved");

    // Log localStorage
    const stored = localStorage.getItem("qontinui-onboarding-state");
    if (stored) {
      log.debug("[Test] Stored state:", JSON.parse(stored));
    }
  }, 1000);
}

/**
 * Test Scenario 5: Responsive Design
 *
 * 1. Run: testResponsive()
 * 2. Resize browser window
 * 3. Verify:
 *    - Tooltip adjusts position
 *    - Spotlight tracks target
 *    - No overflow issues
 */
export function testResponsive() {
  log.debug("[Test Scenario 5] Responsive Design");

  startTutorialForTesting();

  log.debug("[Test] Manually resize browser window to test responsiveness");
  log.debug("[Test] Check:");
  log.debug("  - Tooltip stays in viewport");
  log.debug("  - Spotlight follows target element");
  log.debug("  - No horizontal scroll");
  log.debug("  - Buttons are accessible");

  // Listen for resize events
  let resizeCount = 0;
  const handleResize = () => {
    resizeCount++;
    log.debug(
      `[Test] Resize event ${resizeCount}: ${window.innerWidth}x${window.innerHeight}`
    );
  };

  window.addEventListener("resize", handleResize);

  // Clean up after 30 seconds
  setTimeout(() => {
    window.removeEventListener("resize", handleResize);
    log.debug("[Test] Resize listener removed");
  }, 30000);
}

/**
 * Test Scenario 6: Accessibility
 *
 * 1. Run: testAccessibility()
 * 2. Use screen reader
 * 3. Navigate with keyboard only
 * 4. Verify ARIA attributes
 */
export function testAccessibility() {
  log.debug("[Test Scenario 6] Accessibility");

  startTutorialForTesting();

  log.debug("[Test] Accessibility Checklist:");
  log.debug("  ✓ Use Tab to navigate buttons");
  log.debug("  ✓ Use Arrow keys to change steps");
  log.debug("  ✓ Use Enter to activate buttons");
  log.debug("  ✓ Use Escape to close tutorial");
  log.debug("  ✓ Enable screen reader and verify announcements");

  // Check ARIA attributes
  setTimeout(() => {
    const overlay = document.querySelector(
      '[role="dialog"][aria-modal="true"]'
    );
    if (overlay) {
      log.debug("[Test] ✓ Dialog role found");
      log.debug("[Test] ARIA attributes:", {
        "aria-modal": overlay.getAttribute("aria-modal"),
        "aria-labelledby": overlay.getAttribute("aria-labelledby"),
        "aria-describedby": overlay.getAttribute("aria-describedby"),
      });
    } else {
      console.error("[Test] ✗ Dialog role not found");
    }
  }, 1000);
}

// ============================================================================
// Performance Testing
// ============================================================================

/**
 * Measure tutorial rendering performance
 */
export function measurePerformance() {
  log.debug("[Test] Performance Measurement");

  // Measure start time
  performance.mark("tutorial-start");

  startTutorialForTesting();

  // Measure end time
  setTimeout(() => {
    performance.mark("tutorial-end");
    performance.measure("tutorial-render", "tutorial-start", "tutorial-end");

    const measure = performance.getEntriesByName("tutorial-render")[0];
    log.debug(`[Test] Tutorial render time: ${measure.duration.toFixed(2)}ms`);

    // Clean up marks
    performance.clearMarks();
    performance.clearMeasures();
  }, 500);
}

// ============================================================================
// Browser Console Helpers
// ============================================================================

// Attach test utilities to window for easy access in console
if (typeof window !== "undefined") {
  (window as unknown).tutorialTests = {
    // Utilities
    reset: resetOnboardingForTesting,
    start: startTutorialForTesting,
    goToStep: goToStepForTesting,
    validate: validateTourTargets,
    logState: logOnboardingState,
    testKeyboard: testKeyboardNavigation,

    // Scenarios
    basicFlow: testBasicFlow,
    skipFlow: testSkipFlow,
    navigation: testStepNavigation,
    persistence: testPersistence,
    responsive: testResponsive,
    accessibility: testAccessibility,
    simulate: simulateNewUserFlow,
    performance: measurePerformance,
  };

  log.debug("[TutorialOverlay] Test utilities loaded!");
  log.debug("[TutorialOverlay] Available commands:");
  log.debug("  tutorialTests.reset()        - Reset onboarding state");
  log.debug("  tutorialTests.start()        - Start tutorial");
  log.debug("  tutorialTests.goToStep(n)    - Jump to step n (0-indexed)");
  log.debug("  tutorialTests.validate()     - Check if all targets exist");
  log.debug("  tutorialTests.logState()     - Log current state");
  log.debug("  tutorialTests.basicFlow()    - Run basic flow test");
  log.debug("  tutorialTests.skipFlow()     - Test skip functionality");
  log.debug("  tutorialTests.navigation()   - Test step navigation");
  log.debug("  tutorialTests.persistence()  - Test state persistence");
  log.debug("  tutorialTests.responsive()   - Test responsive design");
  log.debug("  tutorialTests.accessibility()- Test accessibility");
  log.debug("  tutorialTests.simulate()     - Simulate new user flow");
  log.debug("  tutorialTests.performance()  - Measure performance");
}

// ============================================================================
// Export for testing frameworks (if needed)
// ============================================================================

export const testUtils = {
  resetOnboardingForTesting,
  startTutorialForTesting,
  goToStepForTesting,
  validateTourTargets,
  logOnboardingState,
  testKeyboardNavigation,
};

export const testScenarios = {
  testBasicFlow,
  testSkipFlow,
  testStepNavigation,
  testPersistence,
  testResponsive,
  testAccessibility,
  simulateNewUserFlow,
  measurePerformance,
};

import { describe, it, expect } from "vitest";

// This file is a collection of manual-testing utilities run from the browser
// console, not an automated test suite. Vitest still picks it up due to the
// .test.tsx extension; this smoke test keeps the file from failing as
// "no tests found".
describe("TutorialOverlay test utilities", () => {
  it("exposes the expected helper surface", () => {
    expect(testScenarios).toHaveProperty("testBasicFlow");
    expect(testScenarios).toHaveProperty("measurePerformance");
  });
});
