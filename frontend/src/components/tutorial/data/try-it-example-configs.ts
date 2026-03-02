import type { TryItConfig } from "@/types/tutorial";

export const simpleUploadConfig: TryItConfig = {
  type: "upload-screenshots",
  component: "ScreenshotUploader",
};

export const singleHintConfig: TryItConfig = {
  type: "identify-element",
  component: "ElementHighlighter",
  hints: ["Look for the button labeled 'Start Automation'"],
};

export const multipleHintsConfig: TryItConfig = {
  type: "create-action",
  component: "ActionCreator",
  hints: [
    "Start by taking a screenshot of the element you want to interact with",
    "Use the highlight tool to mark the exact location on the screen",
    "Then select the type of action (click, type, drag, etc.)",
    "Verify the action is correctly configured before completing",
  ],
};

export const preloadedElementData = {
  gameScreenshot: "/screenshots/civ6-main.png",
  gameTitle: "Civilization VI",
  elementCoordinates: [1024, 512],
  elementType: "button",
  elementLabel: "End Turn",
};

export const preloadedDataConfig: TryItConfig = {
  type: "identify-element",
  component: "ElementHighlighter",
  preloadedData: preloadedElementData,
  hints: [
    "The element is already loaded in the preview",
    "Use the highlight tool to confirm the correct location",
  ],
};

export const successCriteriaConfig: TryItConfig = {
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
};

const preloadedAction = {
  type: "click",
  coordinates: [1024, 512],
  label: "End Turn",
  screenshot: "/screenshots/civ6-end-turn.png",
};

export const completeAutomationConfig: TryItConfig = {
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
  timeLimit: 600000,
  optional: false,
};

export const optionalTestingConfig: TryItConfig = {
  type: "test-automation",
  component: "AutomationTester",
  hints: [
    "Click 'Start Test' to run your automation",
    "Watch the preview to see the automation in action",
    "Check the logs for any errors or warnings",
    "Click 'Complete' when satisfied with the results",
  ],
  optional: true,
};

export const debugData = {
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

export const patternDebuggingConfig: TryItConfig = {
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
    description: "Successfully identify and fix the pattern matching issue",
    validation: {
      patternUpdated: true,
      toleranceAdjusted: true,
      testsPassed: true,
    },
  },
};

export const optimizationData = {
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

export const optimizationConfig: TryItConfig = {
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
};

export const tutorialWorkflowSteps: Array<{
  title: string;
  description: string;
  config: TryItConfig;
}> = [
  {
    title: "Step 1: Upload a Screenshot",
    description:
      "First, capture a screenshot of your game screen showing the element you want to automate.",
    config: {
      type: "upload-screenshots",
      component: "ScreenshotUploader",
      hints: [
        "Take a screenshot of your game showing the 'End Turn' button",
        "Make sure the element you want to automate is clearly visible",
        "The screenshot should be recent to ensure accuracy",
      ],
    },
  },
  {
    title: "Step 2: Identify the Element",
    description:
      "Mark the location of the button you want to automate on your screenshot.",
    config: {
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
    },
  },
  {
    title: "Step 3: Create an Action",
    description:
      "Define what action should be performed on the identified element.",
    config: {
      type: "create-action",
      component: "ActionCreator",
      hints: [
        "Select 'Click' as the action type",
        "The coordinates should already be populated from the previous step",
        "Add a meaningful label for this action",
        "Test the action to make sure it works",
      ],
    },
  },
  {
    title: "Step 4: Configure the Automation",
    description: "Set up the automation with execution rules and conditions.",
    config: {
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
    },
  },
  {
    title: "Step 5: Test Your Automation",
    description: "Run your automation to make sure it works correctly.",
    config: {
      type: "test-automation",
      component: "AutomationTester",
      hints: [
        "Start the game and let it reach a state where the automation should run",
        "Click 'Start Test' to begin testing",
        "Watch the preview to see the automation in action",
        "The automation should click the 'End Turn' button repeatedly",
      ],
    },
  },
];

export const edgeCaseConfigs: Array<{
  label: string;
  config: TryItConfig;
}> = [
  {
    label: "No Hints Provided",
    config: {
      type: "upload-screenshots",
      component: "ScreenshotUploader",
    },
  },
  {
    label: "No Preloaded Data",
    config: {
      type: "create-action",
      component: "ActionCreator",
    },
  },
  {
    label: "No Success Criteria",
    config: {
      type: "configure-automation",
      component: "AutomationConfigurator",
    },
  },
  {
    label: "Optional Exercise",
    config: {
      type: "optimize-automation",
      component: "AutomationOptimizer",
      optional: true,
    },
  },
];
