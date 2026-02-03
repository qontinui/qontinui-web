/**
 * Test Tutorial for Verification
 *
 * A simple 3-step tutorial to test:
 * - Spotlight highlighting
 * - Tooltip positioning
 * - Event-driven progression
 * - Progress persistence
 * - Keyboard navigation
 */

import type { Tutorial } from "@/types/tutorial";

export const testTutorial: Tutorial = {
  id: "test-tutorial",
  title: "Tutorial System Test",
  description:
    "A test tutorial to verify the tutorial system is working correctly.",
  duration: "1 minute",
  estimatedTime: 1,
  difficulty: "beginner",
  mode: "contextual",
  focusPage: "dashboard",
  category: "Testing",
  tags: ["test", "verification"],
  learningObjectives: [
    "Verify spotlight highlighting works",
    "Verify tooltip positioning works",
    "Verify event-driven progression works",
  ],
  steps: [
    {
      id: "step-1-welcome",
      title: "Step 1: Welcome",
      content:
        "This is a test tutorial to verify the tutorial system is working. " +
        "This step has no target element, so it should appear as a centered modal.",
      action: 'Click "Next" to continue to step 2.',
      tips: [
        "You can use keyboard navigation: Arrow keys to navigate, Escape to close",
      ],
    },
    {
      id: "step-2-spotlight",
      title: "Step 2: Spotlight Test",
      content:
        "This step targets a sidebar element. You should see a spotlight effect " +
        "highlighting the navigation area.",
      targetElement: {
        selector: "[data-tutorial-id='sidebar-nav']",
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
        scrollIntoView: true,
      },
      action: 'Click "Next" to continue to the final step.',
    },
    {
      id: "step-3-complete",
      title: "Step 3: Complete!",
      content:
        "The tutorial system is working correctly! You can now use the " +
        "tutorial system to create interactive tutorials for your users.",
      tips: [
        "Tutorials support event-driven progression using wait conditions",
        "Progress is automatically saved to localStorage",
        "Keyboard shortcuts: → (next), ← (previous), Esc (close)",
      ],
      action: 'Click "Finish" to complete this test tutorial.',
    },
  ],
};

/**
 * Tutorial with event-driven progression
 */
export const eventDrivenTestTutorial: Tutorial = {
  id: "event-driven-test",
  title: "Event-Driven Tutorial Test",
  description:
    "Tests event-driven step progression with wait conditions and timeouts.",
  duration: "2 minutes",
  estimatedTime: 2,
  difficulty: "intermediate",
  mode: "contextual",
  focusPage: "dashboard",
  category: "Testing",
  tags: ["test", "events", "advanced"],
  steps: [
    {
      id: "event-step-1",
      title: "Event-Driven Step",
      content:
        "This step waits for you to click a specific element. " +
        "Click the sidebar navigation to continue.",
      targetElement: {
        selector: "[data-tutorial-id='sidebar-nav']",
        highlightType: "spotlight",
        position: "right",
        allowInteraction: true,
      },
      interactive: true,
      wait: {
        type: "dom-event",
        event: "click",
        selector: "[data-tutorial-id='sidebar-nav']",
        timeout: 10000,
        onTimeout: "show-hint",
        hint: "Click on the sidebar navigation to continue",
        advanceDelay: 500,
      },
    },
    {
      id: "event-step-2",
      title: "App Action Step",
      content:
        "This step waits for a custom app action. The application can " +
        "trigger this by calling notifyAction('test-action').",
      action:
        "This step will auto-advance in 5 seconds if no action is received.",
      wait: {
        type: "app-action",
        actionName: "test-action",
        timeout: 5000,
        onTimeout: "allow-skip",
        hint: "No action received. You can skip this step.",
      },
    },
    {
      id: "event-step-3",
      title: "Event Test Complete",
      content:
        "You've completed the event-driven tutorial test. " +
        "The system correctly handles wait conditions and timeouts.",
    },
  ],
};
