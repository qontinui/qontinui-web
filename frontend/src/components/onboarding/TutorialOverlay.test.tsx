/**
 * TutorialOverlay Test Utilities and Examples
 *
 * This file provides test utilities and examples for testing the TutorialOverlay component.
 * Note: This is not a full test suite (no test runner), but rather a collection of
 * utilities and manual testing helpers.
 */

import { useOnboardingStore } from '@/stores/onboarding-store';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Reset all onboarding state for testing
 */
export function resetOnboardingForTesting() {
  const { resetOnboarding } = useOnboardingStore.getState();
  resetOnboarding();
  console.log('[Test] Onboarding state reset');
}

/**
 * Start tutorial for testing
 */
export function startTutorialForTesting() {
  const { startTour } = useOnboardingStore.getState();
  startTour();
  console.log('[Test] Tutorial started');
}

/**
 * Skip to specific step for testing
 */
export function goToStepForTesting(step: number) {
  const { setTourStep } = useOnboardingStore.getState();
  setTourStep(step);
  console.log(`[Test] Jumped to step ${step + 1}`);
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
      console.log(`[Test] ✓ Found: ${selector}`, element);
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
  console.group('[Test] Onboarding State');
  console.log('Tutorial Active:', state.showTutorialOverlay);
  console.log('Current Step:', state.currentTourStep + 1);
  console.log('Has Started Tour:', state.hasStartedTour);
  console.log('Has Completed Welcome:', state.hasCompletedWelcome);
  console.log('Welcome Modal Visible:', state.showWelcomeModal);
  console.log('Don\'t Show Again:', state.dontShowWelcomeAgain);
  console.groupEnd();
}

/**
 * Test keyboard navigation programmatically
 */
export function testKeyboardNavigation() {
  console.group('[Test] Keyboard Navigation');

  // Test Right Arrow
  console.log('Testing Right Arrow...');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

  setTimeout(() => {
    // Test Left Arrow
    console.log('Testing Left Arrow...');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  }, 1000);

  setTimeout(() => {
    // Test Enter
    console.log('Testing Enter...');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  }, 2000);

  setTimeout(() => {
    // Test Escape
    console.log('Testing Escape...');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  }, 3000);

  console.groupEnd();
}

/**
 * Test tooltip positioning at different viewport sizes
 */
export function testTooltipPositioning() {
  const viewportSizes = [
    { width: 1920, height: 1080, name: 'Desktop Large' },
    { width: 1366, height: 768, name: 'Desktop Medium' },
    { width: 768, height: 1024, name: 'Tablet' },
    { width: 375, height: 667, name: 'Mobile' },
  ];

  console.group('[Test] Tooltip Positioning');

  viewportSizes.forEach((size, index) => {
    setTimeout(() => {
      console.log(`Testing ${size.name} (${size.width}x${size.height})`);
      // Note: This won't actually resize the window in most browsers
      // Manual testing required for different viewport sizes
      console.log('Manual test required: Resize window to test positioning');
    }, index * 1000);
  });

  console.groupEnd();
}

/**
 * Simulate new user flow
 */
export function simulateNewUserFlow() {
  console.group('[Test] New User Flow Simulation');

  // Step 1: Reset state
  console.log('Step 1: Resetting onboarding state...');
  resetOnboardingForTesting();

  // Step 2: Show welcome modal
  setTimeout(() => {
    console.log('Step 2: Showing welcome modal...');
    const { toggleWelcomeModal } = useOnboardingStore.getState();
    toggleWelcomeModal(true);
  }, 1000);

  // Step 3: Start tour from welcome modal
  setTimeout(() => {
    console.log('Step 3: Starting tour from welcome modal...');
    const { completeWelcome, startTour } = useOnboardingStore.getState();
    completeWelcome();
    startTour();
  }, 3000);

  // Step 4: Navigate through steps
  setTimeout(() => {
    console.log('Step 4: Auto-navigating through steps...');
    let currentStep = 0;
    const maxSteps = 5;

    const interval = setInterval(() => {
      if (currentStep < maxSteps - 1) {
        currentStep++;
        goToStepForTesting(currentStep);
      } else {
        clearInterval(interval);
        console.log('Step 5: Tour completed!');
        const { completeTour } = useOnboardingStore.getState();
        completeTour();
      }
    }, 2000);
  }, 5000);

  console.groupEnd();
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
  console.log('[Test Scenario 1] Basic Flow');

  // Validate targets first
  const validation = validateTourTargets();
  if (!validation.valid) {
    console.error('[Test] Missing targets:', validation.missing);
    return;
  }

  // Start tutorial
  startTutorialForTesting();

  console.log('[Test] Use arrow keys or click "Next" to navigate');
  console.log('[Test] Press ESC to exit');
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
  console.log('[Test Scenario 2] Skip Flow');

  // Start tutorial
  startTutorialForTesting();

  // Skip after 2 seconds
  setTimeout(() => {
    console.log('[Test] Skipping tutorial...');
    const { skipTour } = useOnboardingStore.getState();
    skipTour();

    // Verify state
    setTimeout(() => {
      const state = useOnboardingStore.getState();
      console.log('[Test] Tutorial active:', state.showTutorialOverlay);
      console.log('[Test] Expected: false');
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
  console.log('[Test Scenario 3] Step Navigation');

  // Start tutorial
  startTutorialForTesting();

  // Jump to different steps
  const steps = [0, 2, 4, 1, 3];
  steps.forEach((step, index) => {
    setTimeout(() => {
      console.log(`[Test] Jumping to step ${step + 1}`);
      goToStepForTesting(step);
    }, index * 2000);
  });

  // Complete after all jumps
  setTimeout(() => {
    const { completeTour } = useOnboardingStore.getState();
    completeTour();
    console.log('[Test] Tour completed');
  }, steps.length * 2000 + 1000);
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
  console.log('[Test Scenario 4] Persistence');

  // Start tutorial and go to step 3
  startTutorialForTesting();
  setTimeout(() => {
    goToStepForTesting(2); // Step 3 (0-indexed)

    console.log('[Test] Now refresh the page and check localStorage');
    console.log('[Test] State should be preserved');

    // Log localStorage
    const stored = localStorage.getItem('qontinui-onboarding-state');
    if (stored) {
      console.log('[Test] Stored state:', JSON.parse(stored));
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
  console.log('[Test Scenario 5] Responsive Design');

  startTutorialForTesting();

  console.log('[Test] Manually resize browser window to test responsiveness');
  console.log('[Test] Check:');
  console.log('  - Tooltip stays in viewport');
  console.log('  - Spotlight follows target element');
  console.log('  - No horizontal scroll');
  console.log('  - Buttons are accessible');

  // Listen for resize events
  let resizeCount = 0;
  const handleResize = () => {
    resizeCount++;
    console.log(`[Test] Resize event ${resizeCount}: ${window.innerWidth}x${window.innerHeight}`);
  };

  window.addEventListener('resize', handleResize);

  // Clean up after 30 seconds
  setTimeout(() => {
    window.removeEventListener('resize', handleResize);
    console.log('[Test] Resize listener removed');
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
  console.log('[Test Scenario 6] Accessibility');

  startTutorialForTesting();

  console.log('[Test] Accessibility Checklist:');
  console.log('  ✓ Use Tab to navigate buttons');
  console.log('  ✓ Use Arrow keys to change steps');
  console.log('  ✓ Use Enter to activate buttons');
  console.log('  ✓ Use Escape to close tutorial');
  console.log('  ✓ Enable screen reader and verify announcements');

  // Check ARIA attributes
  setTimeout(() => {
    const overlay = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (overlay) {
      console.log('[Test] ✓ Dialog role found');
      console.log('[Test] ARIA attributes:', {
        'aria-modal': overlay.getAttribute('aria-modal'),
        'aria-labelledby': overlay.getAttribute('aria-labelledby'),
        'aria-describedby': overlay.getAttribute('aria-describedby'),
      });
    } else {
      console.error('[Test] ✗ Dialog role not found');
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
  console.log('[Test] Performance Measurement');

  // Measure start time
  performance.mark('tutorial-start');

  startTutorialForTesting();

  // Measure end time
  setTimeout(() => {
    performance.mark('tutorial-end');
    performance.measure('tutorial-render', 'tutorial-start', 'tutorial-end');

    const measure = performance.getEntriesByName('tutorial-render')[0];
    console.log(`[Test] Tutorial render time: ${measure.duration.toFixed(2)}ms`);

    // Clean up marks
    performance.clearMarks();
    performance.clearMeasures();
  }, 500);
}

// ============================================================================
// Browser Console Helpers
// ============================================================================

// Attach test utilities to window for easy access in console
if (typeof window !== 'undefined') {
  (window as any).tutorialTests = {
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

  console.log('[TutorialOverlay] Test utilities loaded!');
  console.log('[TutorialOverlay] Available commands:');
  console.log('  tutorialTests.reset()        - Reset onboarding state');
  console.log('  tutorialTests.start()        - Start tutorial');
  console.log('  tutorialTests.goToStep(n)    - Jump to step n (0-indexed)');
  console.log('  tutorialTests.validate()     - Check if all targets exist');
  console.log('  tutorialTests.logState()     - Log current state');
  console.log('  tutorialTests.basicFlow()    - Run basic flow test');
  console.log('  tutorialTests.skipFlow()     - Test skip functionality');
  console.log('  tutorialTests.navigation()   - Test step navigation');
  console.log('  tutorialTests.persistence()  - Test state persistence');
  console.log('  tutorialTests.responsive()   - Test responsive design');
  console.log('  tutorialTests.accessibility()- Test accessibility');
  console.log('  tutorialTests.simulate()     - Simulate new user flow');
  console.log('  tutorialTests.performance()  - Measure performance');
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
