/**
 * TryItButton Component Examples
 *
 * Demonstrates various use cases and configurations for the TryItButton component
 * used in interactive tutorial steps.
 */

import { TryItButton } from "./try-it-button";

/**
 * Example 1: Simple Screenshot Upload Exercise
 *
 * Basic usage with just the required configuration.
 * No hints or preloaded data.
 */
export function SimpleUploadScreenshotExample() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">
        Example 1: Simple Screenshot Upload
      </h3>
      <TryItButton
        config={{
          type: "upload-screenshots",
          component: "ScreenshotUploader",
        }}
      />
    </div>
  );
}

/**
 * Example 2: Exercise with Single Hint
 *
 * Demonstrates how hints help guide users through an exercise.
 */
export function ExerciseWithHintExample() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Example 2: Exercise with Hint</h3>
      <TryItButton
        config={{
          type: "identify-element",
          component: "ElementHighlighter",
          hints: ["Look for the button labeled 'Start Automation'"],
        }}
      />
    </div>
  );
}

/**
 * Example 3: Exercise with Multiple Hints
 *
 * Shows how users can navigate through multiple hints
 * for progressive guidance.
 */
export function MultipleHintsExample() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">
        Example 3: Multiple Hints with Navigation
      </h3>
      <TryItButton
        config={{
          type: "create-action",
          component: "ActionCreator",
          hints: [
            "Start by taking a screenshot of the element you want to interact with",
            "Use the highlight tool to mark the exact location on the screen",
            "Then select the type of action (click, type, drag, etc.)",
            "Verify the action is correctly configured before completing",
          ],
        }}
        onComplete={(result) => {
          console.log("Action created:", result);
        }}
      />
    </div>
  );
}

/**
 * Example 4: Exercise with Preloaded Data
 *
 * Demonstrates providing initial data to the exercise component.
 * Useful for exercises that build on previous steps.
 */
export function PreloadedDataExample() {
  const preloadedData = {
    gameScreenshot: "/screenshots/civ6-main.png",
    gameTitle: "Civilization VI",
    elementCoordinates: [1024, 512],
    elementType: "button",
    elementLabel: "End Turn",
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Example 4: Preloaded Data</h3>
      <TryItButton
        config={{
          type: "identify-element",
          component: "ElementHighlighter",
          preloadedData,
          hints: [
            "The element is already loaded in the preview",
            "Use the highlight tool to confirm the correct location",
          ],
        }}
      />
    </div>
  );
}

/**
 * Example 5: Exercise with Success Criteria
 *
 * Shows how to define what constitutes successful completion
 * of the exercise.
 */
export function SuccessCriteriaExample() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Example 5: Success Criteria</h3>
      <TryItButton
        config={{
          type: "configure-automation",
          component: "AutomationConfigurator",
          successCriteria: {
            description:
              "Successfully configure an automation that runs the End Turn action every 30 seconds",
            validation: {
              hasGameTitle: true,
              hasActions: true,
              actionInterval: 30000,
              hasSuccessCondition: true,
            },
          },
        }}
      />
    </div>
  );
}

/**
 * Example 6: Complete Automation Configuration Exercise
 *
 * Full-featured example with hints, preloaded data, and success criteria.
 * This is a typical workflow for creating game automations.
 */
export function CompleteAutomationExample() {
  const preloadedAction = {
    type: "click",
    coordinates: [1024, 512],
    label: "End Turn",
    screenshot: "/screenshots/civ6-end-turn.png",
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">
        Example 6: Complete Automation Configuration
      </h3>
      <TryItButton
        config={{
          type: "configure-automation",
          component: "AutomationConfigurator",
          preloadedData: {
            gameName: "Civilization VI",
            actions: [preloadedAction],
            existingAutomations: 2,
          },
          hints: [
            "First, verify the game name is correct: 'Civilization VI'",
            "You have 1 action already created (End Turn)",
            "Add success conditions to ensure the action completes",
            "Set the execution interval to control how often the action runs",
            "Test the automation with the preview button before completing",
          ],
          successCriteria: {
            description:
              "Create a functional automation that ends turns in Civilization VI at a regular interval",
            validation: {
              hasGameName: true,
              hasMinimumActions: 1,
              hasSuccessCondition: true,
              hasInterval: true,
              intervalRange: { min: 5000, max: 60000 },
            },
          },
          timeLimit: 600000, // 10 minutes
          optional: false,
        }}
        onComplete={(result) => {
          console.log("Automation configured:", result);
          // Here you would typically:
          // 1. Save the automation
          // 2. Mark the tutorial step as complete
          // 3. Update user progress
        }}
      />
    </div>
  );
}

/**
 * Example 7: Testing Exercise with Optional Flag
 *
 * Demonstrates an optional exercise that users can skip.
 */
export function OptionalTestingExerciseExample() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">
        Example 7: Optional Testing Exercise
      </h3>
      <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <p className="text-sm text-blue-900 dark:text-blue-100 mb-4">
          This exercise is optional. You can skip it and continue to the next
          step.
        </p>
        <TryItButton
          config={{
            type: "test-automation",
            component: "AutomationTester",
            hints: [
              "Click 'Start Test' to run your automation",
              "Watch the preview to see the automation in action",
              "Check the logs for any errors or warnings",
              "Click 'Complete' when satisfied with the results",
            ],
            optional: true,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Example 8: Pattern Debugging Exercise
 *
 * More advanced exercise for debugging automation patterns.
 */
export function PatternDebuggingExample() {
  const debugData = {
    automationId: "auto-123",
    automationName: "Civ6 Turn Ender",
    lastError: "Element not found after game update",
    errorLocation: "pattern matching at coordinates (1024, 512)",
    logs: [
      "Starting automation...",
      "Waiting for screen stabilization...",
      "Pattern not matched - retrying with adjusted tolerance",
      "Pattern found after 3 attempts",
      "Error: Element coordinates changed",
    ],
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Example 8: Pattern Debugging</h3>
      <TryItButton
        config={{
          type: "debug-pattern",
          component: "PatternDebugger",
          preloadedData: debugData,
          hints: [
            "Examine the error logs to understand what went wrong",
            "The automation couldn&apos;t find the expected element",
            "Try adjusting the pattern matching tolerance",
            "Or update the pattern with a fresh screenshot",
            "Test again to verify the fix",
          ],
          successCriteria: {
            description:
              "Successfully identify and fix the pattern matching issue",
            validation: {
              patternUpdated: true,
              toleranceAdjusted: true,
              testsPassed: true,
            },
          },
        }}
      />
    </div>
  );
}

/**
 * Example 9: Optimization Exercise
 *
 * Exercise for improving automation performance.
 */
export function OptimizationExerciseExample() {
  const optimizationData = {
    automationId: "auto-456",
    currentMetrics: {
      averageExecutionTime: 2500,
      successRate: 0.92,
      errorRecoveryRate: 0.85,
    },
    performanceIssues: [
      "Screen capture is slow (800ms)",
      "Pattern matching timeout too high (2000ms)",
      "Multiple redundant waits",
    ],
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">
        Example 9: Automation Optimization
      </h3>
      <TryItButton
        config={{
          type: "optimize-automation",
          component: "AutomationOptimizer",
          preloadedData: optimizationData,
          hints: [
            "Current execution time is 2.5 seconds - can we improve this?",
            "Screen capture configuration might be too conservative",
            "Pattern matching timeout could be reduced",
            "Check for redundant wait statements",
            "Run performance test after each optimization",
          ],
          successCriteria: {
            description:
              "Reduce average execution time to under 2 seconds while maintaining > 90% success rate",
            validation: {
              targetExecutionTime: 2000,
              minSuccessRate: 0.9,
              improvements: ["screenCapture", "patternMatching"],
            },
          },
        }}
      />
    </div>
  );
}

/**
 * Example 10: Complete Tutorial Workflow
 *
 * Demonstrates how multiple TryItButton exercises would be used
 * throughout a tutorial to create a complete learning experience.
 */
export function CompleteTutorialWorkflowExample() {
  return (
    <div className="space-y-12">
      <div>
        <h3 className="text-lg font-semibold mb-4">
          Tutorial: Create Your First Game Automation
        </h3>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          This tutorial walks you through creating a complete automation for
          Civilization VI.
        </p>
      </div>

      {/* Step 1: Upload Screenshot */}
      <div className="space-y-4">
        <h4 className="font-semibold text-md">Step 1: Upload a Screenshot</h4>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          First, capture a screenshot of your game screen showing the element
          you want to automate.
        </p>
        <TryItButton
          config={{
            type: "upload-screenshots",
            component: "ScreenshotUploader",
            hints: [
              "Take a screenshot of your game showing the 'End Turn' button",
              "Make sure the element you want to automate is clearly visible",
              "The screenshot should be recent to ensure accuracy",
            ],
          }}
        />
      </div>

      {/* Step 2: Identify Element */}
      <div className="space-y-4">
        <h4 className="font-semibold text-md">Step 2: Identify the Element</h4>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Mark the location of the button you want to automate on your
          screenshot.
        </p>
        <TryItButton
          config={{
            type: "identify-element",
            component: "ElementHighlighter",
            preloadedData: {
              screenshot: "/screenshots/civ6-uploaded.png",
            },
            hints: [
              "Use the highlight tool to mark the 'End Turn' button",
              "Be precise - the automation will look for this exact location",
              "You can adjust the highlight area if needed",
            ],
          }}
        />
      </div>

      {/* Step 3: Create Action */}
      <div className="space-y-4">
        <h4 className="font-semibold text-md">Step 3: Create an Action</h4>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Define what action should be performed on the identified element.
        </p>
        <TryItButton
          config={{
            type: "create-action",
            component: "ActionCreator",
            hints: [
              "Select 'Click' as the action type",
              "The coordinates should already be populated from the previous step",
              "Add a meaningful label for this action",
              "Test the action to make sure it works",
            ],
          }}
        />
      </div>

      {/* Step 4: Configure Automation */}
      <div className="space-y-4">
        <h4 className="font-semibold text-md">
          Step 4: Configure the Automation
        </h4>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Set up the automation with execution rules and conditions.
        </p>
        <TryItButton
          config={{
            type: "configure-automation",
            component: "AutomationConfigurator",
            hints: [
              "Name your automation something descriptive like 'Civ6 Auto Turn'",
              "Set the action to repeat every 30 seconds",
              "Add a success condition to detect when the turn has ended",
              "Enable the 'Stop on error' option for safety",
            ],
            successCriteria: {
              description:
                "Create a working automation configuration ready to be tested",
              validation: {
                hasName: true,
                hasActions: true,
                hasInterval: true,
              },
            },
          }}
        />
      </div>

      {/* Step 5: Test Automation */}
      <div className="space-y-4">
        <h4 className="font-semibold text-md">Step 5: Test Your Automation</h4>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Run your automation to make sure it works correctly.
        </p>
        <TryItButton
          config={{
            type: "test-automation",
            component: "AutomationTester",
            hints: [
              "Start the game and let it reach a state where the automation should run",
              "Click 'Start Test' to begin testing",
              "Watch the preview to see the automation in action",
              "The automation should click the 'End Turn' button repeatedly",
            ],
          }}
        />
      </div>

      <div className="p-6 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
        <h4 className="font-semibold text-green-900 dark:text-green-100 mb-2">
          Congratulations!
        </h4>
        <p className="text-green-800 dark:text-green-200">
          You&apos;ve successfully created your first game automation! You can now
          use this automation in Qontinui to automate your gameplay.
        </p>
      </div>
    </div>
  );
}

/**
 * Demonstration of error handling and edge cases
 */
export function EdgeCasesExample() {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">
        Example 11: Edge Cases and Error Handling
      </h3>

      {/* No hints */}
      <div className="space-y-3">
        <h4 className="font-semibold text-sm">No Hints Provided</h4>
        <TryItButton
          config={{
            type: "upload-screenshots",
            component: "ScreenshotUploader",
            // No hints array
          }}
        />
      </div>

      {/* No preloaded data */}
      <div className="space-y-3">
        <h4 className="font-semibold text-sm">No Preloaded Data</h4>
        <TryItButton
          config={{
            type: "create-action",
            component: "ActionCreator",
            // No preloadedData
          }}
        />
      </div>

      {/* No success criteria */}
      <div className="space-y-3">
        <h4 className="font-semibold text-sm">No Success Criteria</h4>
        <TryItButton
          config={{
            type: "configure-automation",
            component: "AutomationConfigurator",
            // No successCriteria
          }}
        />
      </div>

      {/* Optional exercise */}
      <div className="space-y-3">
        <h4 className="font-semibold text-sm">Optional Exercise</h4>
        <TryItButton
          config={{
            type: "optimize-automation",
            component: "AutomationOptimizer",
            optional: true,
          }}
        />
      </div>
    </div>
  );
}
