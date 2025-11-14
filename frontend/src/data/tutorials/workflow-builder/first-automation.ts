import { Tutorial } from '@/types/tutorial';

/**
 * First Automation Tutorial
 *
 * A comprehensive beginner-level contextual tutorial that guides users through
 * creating their first automation workflow in the Qontinui Automation Builder.
 *
 * This tutorial uses in-page tooltips, spotlights, and real-time validation to
 * teach users the fundamentals of workflow creation, from naming and configuring
 * a workflow to adding actions, testing, and saving.
 *
 * Mode: Contextual (embedded in the Automation Builder page)
 * Target: New users on their first visit to /automation-builder
 */
const firstAutomationTutorial: Tutorial = {
  id: 'first-automation',
  title: 'Create Your First Automation',
  description:
    'Learn the fundamentals of building automation workflows in Qontinui. This hands-on tutorial walks you through creating, configuring, testing, and saving your first automation step-by-step.',
  duration: '10 minutes',
  difficulty: 'beginner',
  mode: 'contextual',
  targetPage: '/automation-builder',

  category: 'Workflow Builder',
  tags: ['automation', 'beginner', 'workflow', 'getting-started', 'basics'],

  learningObjectives: [
    'Understand the basic structure of an automation workflow',
    'Learn how to name and configure workflow settings',
    'Master adding and configuring actions',
    'Practice testing workflows before deployment',
    'Save and manage your automation projects',
  ],

  triggers: {
    automatic: true,
    manual: true,
    contextual: [
      {
        event: 'page_load',
        condition: 'user.visitCount === 1 && page.route === "/automation-builder"',
      },
      {
        event: 'workflow_created',
        condition: 'user.workflows.length === 0',
      },
    ],
  },

  workflowIntegration: {
    enableRealEditing: true,
    provideSampleData: false,
    validateUserActions: true,
    cleanup: false,
  },

  author: {
    name: 'Qontinui Team',
  },

  metadata: {
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: '1.0.0',
  },

  isPublished: true,

  steps: [
    {
      id: 'step-1-welcome',
      title: 'Welcome to Automation Builder',
      content: `
# Welcome to Your First Automation! 🎉

You're about to discover the power of visual automation with Qontinui. In this tutorial, you'll learn how to create a complete automation workflow from scratch.

## What You'll Build

By the end of this tutorial, you'll have created a working automation that:
- Has a clear, descriptive name
- Runs actions in a logical sequence
- Can be tested before deployment
- Is saved for future use

## What Makes Qontinui Special?

Unlike traditional automation tools that require coding or brittle coordinate-based scripts, Qontinui uses:

- **Visual Recognition** - Identifies UI elements by appearance, not hardcoded positions
- **Sequential Workflows** - Clear, step-by-step action sequences
- **Real-time Testing** - Test your automation before deploying it
- **Adaptive Intelligence** - Works even when UI layouts change slightly

## How This Tutorial Works

This is an **interactive tutorial** that guides you through the actual Automation Builder interface. You'll:
1. Follow tooltips highlighting important UI elements
2. Complete real actions in the builder (not just reading!)
3. Receive validation feedback as you progress
4. Build a working automation you can use immediately

**Ready to get started?** Click "Next" to begin!
`,
      estimatedDuration: 1,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand the purpose of the Automation Builder',
        'Learn what makes Qontinui unique',
        'Get familiar with the tutorial format',
      ],
      tips: [
        'Take your time - you can pause the tutorial at any point',
        'You can always restart if you make a mistake',
        'Your progress is automatically saved',
      ],
      targetElement: {
        selector: 'body',
        highlightType: 'spotlight',
        position: 'center',
        allowInteraction: false,
        scrollIntoView: false,
      },
      resources: [
        {
          title: 'Qontinui Documentation',
          url: 'https://docs.qontinui.io',
          type: 'documentation',
        },
        {
          title: 'Automation Best Practices',
          url: 'https://docs.qontinui.io/guides/best-practices',
          type: 'article',
        },
      ],
    },

    {
      id: 'step-2-name-workflow',
      title: 'Name Your Workflow',
      content: `
# Give Your Automation a Descriptive Name

Every automation starts with a good name. A clear, descriptive name helps you:
- **Remember** what the automation does
- **Find** it quickly when you have multiple workflows
- **Share** it with team members (if applicable)
- **Maintain** it months later when you need updates

## Naming Best Practices

**Good names are:**
- **Descriptive** - "Morning Email Check" not "Workflow 1"
- **Action-oriented** - Start with a verb: "Generate Daily Report"
- **Specific** - "Click Login and Enter Credentials" not "Login Thing"
- **Concise** - Aim for 2-5 words when possible

**Examples:**
- ✅ "Inventory Data Export"
- ✅ "User Onboarding Sequence"
- ✅ "Daily Backup Process"
- ❌ "My Automation"
- ❌ "Test 123"
- ❌ "The thing that does the stuff on the website every morning"

## Your Task

Click on the **Workflow Name** input field (highlighted above) and enter a descriptive name for your first automation.

**Suggested name:** "My First Workflow" or "Practice Automation"

*Don't worry - you can always rename it later!*
`,
      estimatedDuration: 1,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand the importance of descriptive naming',
        'Learn naming best practices',
        'Practice using the workflow name input',
      ],
      tips: [
        'If you\'re unsure what to name it, "My First Workflow" is perfectly fine for practice',
        'You can rename workflows later from the workflow management page',
        'Use consistent naming patterns if you plan to create many workflows',
      ],
      targetElement: {
        selector: '[data-tutorial-id="workflow-name-input"]',
        highlightType: 'spotlight',
        position: 'bottom',
        allowInteraction: true,
        scrollIntoView: true,
        offset: { x: 0, y: 10 },
      },
      validation: {
        type: 'input',
        condition: 'document.querySelector("[data-tutorial-id=workflow-name-input]").value.length >= 3',
        feedback: {
          success: 'Great name! Your workflow is now properly identified.',
          failure: 'Please enter a name with at least 3 characters.',
          hint: 'Try something like "My First Workflow" or "Practice Automation"',
        },
        timeout: 30000,
        optional: false,
      },
      waitForUserAction: true,
    },

    {
      id: 'step-3-mode-selector',
      title: 'Choose Sequential Mode',
      content: `
# Understanding Workflow Execution Modes

Qontinui offers different ways to run your automation actions. For your first workflow, we'll use **Sequential Mode** - the most intuitive and commonly used approach.

## What is Sequential Mode?

Sequential mode runs actions **one after another**, in order, like following a recipe:

\`\`\`
Step 1: Open application
  ↓
Step 2: Enter credentials
  ↓
Step 3: Click login
  ↓
Step 4: Navigate to dashboard
  ↓
Complete!
\`\`\`

Each action must complete before the next one starts. This is perfect for:
- **Login sequences** - Where order matters
- **Data entry workflows** - Fill form fields in sequence
- **Navigation tasks** - Go from page A → B → C
- **File processing** - Load, transform, save

## Other Modes (For Later)

- **Parallel Mode** - Run multiple actions simultaneously (advanced)
- **Conditional Mode** - Branch based on conditions (requires logic)
- **Loop Mode** - Repeat actions until a condition is met (advanced)

For now, **Sequential Mode** is all you need to create powerful automations.

## Your Task

Click the **Mode Selector** dropdown (highlighted) and choose **"Sequential"** mode.

*This tells Qontinui to run your actions in the order you add them.*
`,
      estimatedDuration: 1,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand different workflow execution modes',
        'Learn when to use Sequential mode',
        'Practice using the mode selector',
      ],
      tips: [
        'Sequential mode is the default for good reason - it\'s simple and powerful',
        'You can change the mode later if your workflow needs parallel execution',
        'Most automation workflows use Sequential mode',
      ],
      targetElement: {
        selector: '[data-tutorial-id="mode-selector"]',
        highlightType: 'pulse',
        position: 'bottom',
        allowInteraction: true,
        scrollIntoView: true,
        delay: 300,
      },
      validation: {
        type: 'state',
        condition: 'document.querySelector("[data-tutorial-id=mode-selector]").value === "sequential"',
        feedback: {
          success: 'Perfect! Sequential mode is set. Your actions will run in order.',
          failure: 'Please select "Sequential" from the mode dropdown.',
          hint: 'Look for "Sequential" in the dropdown options',
        },
        timeout: 30000,
        optional: false,
      },
      waitForUserAction: true,
    },

    {
      id: 'step-4-add-action',
      title: 'Add Your First Action',
      content: `
# Building Your Automation with Actions

Actions are the **building blocks** of your automation. Each action represents a specific task or interaction:

- Click a button
- Enter text into a field
- Wait for an element to appear
- Navigate to a URL
- Take a screenshot
- Validate content

## How Actions Work

When your automation runs, it executes each action you've added:

1. **Action Detection** - Qontinui identifies the UI element
2. **Action Execution** - Performs the specified interaction
3. **Validation** - Confirms the action succeeded
4. **Next Action** - Proceeds to the next step

If any action fails, the workflow stops and reports the issue.

## Your First Action

Let's start simple. Click the **"Add Action"** button (highlighted above) to add your first action to the workflow.

*Don't worry about configuring it perfectly - we'll do that in the next step!*

## What Happens Next?

After clicking "Add Action":
1. A new action card will appear
2. You'll see configuration options
3. The action will be added to your workflow sequence
4. You can configure the action details

**Click the button to continue!**
`,
      estimatedDuration: 1,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand what actions are in automation workflows',
        'Learn how actions are executed',
        'Practice adding actions to a workflow',
      ],
      tips: [
        'You can add as many actions as you need - there\'s no limit',
        'Actions can be reordered by dragging and dropping',
        'Each action can be edited or deleted after adding it',
      ],
      targetElement: {
        selector: '[data-tutorial-id="add-action-button"]',
        highlightType: 'pulse',
        position: 'left',
        allowInteraction: true,
        scrollIntoView: true,
        offset: { x: -10, y: 0 },
      },
      validation: {
        type: 'state',
        condition: 'document.querySelectorAll(".action-card, [data-action-item]").length > 0',
        feedback: {
          success: 'Excellent! You\'ve added your first action. Let\'s configure it next.',
          failure: 'Click the "Add Action" button to add an action to your workflow.',
          hint: 'Look for the button labeled "Add Action" or with a plus (+) icon',
        },
        timeout: 45000,
        optional: false,
      },
      waitForUserAction: true,
    },

    {
      id: 'step-5-configure-action',
      title: 'Configure Action Properties',
      content: `
# Configuring Action Details

Now that you've added an action, let's configure it. Every action has **properties** that define exactly what it should do.

## Common Action Properties

Most actions include these configurable options:

### 1. **Action Type**
The kind of interaction to perform:
- Click / Tap
- Type / Enter Text
- Wait / Pause
- Navigate
- Validate / Check

### 2. **Target Element**
What to interact with:
- Button with text "Submit"
- Input field with label "Email"
- Image with alt text "Logo"
- Link containing "Learn More"

### 3. **Action Details**
Specific parameters:
- Text to enter: "username@example.com"
- Wait duration: 2 seconds
- URL to navigate: "https://example.com"
- Validation expected: "Success message"

### 4. **Error Handling**
What to do if it fails:
- Retry (with delay)
- Skip and continue
- Stop workflow
- Take screenshot and report

## Your Task

Look at the **Properties Panel** (highlighted on the right). This is where you configure action settings.

For your first action, you can:
- **Change the action type** if needed
- **Add a description** to remember what it does
- **Set any required parameters**

*Or simply review the default settings - we'll test the workflow in the next step!*

**Tip:** For practice, try changing the action description to something like "My first test action"
`,
      estimatedDuration: 2,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand action configuration options',
        'Learn about common action properties',
        'Practice using the properties panel',
        'Understand error handling in actions',
      ],
      tips: [
        'The Properties Panel shows different options depending on action type',
        'You can collapse/expand the panel to see more of the workflow',
        'Action descriptions help you understand your workflow when reviewing it later',
        'Required fields are usually marked with an asterisk (*)',
      ],
      targetElement: {
        selector: '[data-tutorial-id="properties-panel"]',
        highlightType: 'spotlight',
        position: 'left',
        allowInteraction: true,
        scrollIntoView: true,
        offset: { x: -15, y: 0 },
      },
      validation: {
        type: 'state',
        condition: 'true', // Auto-advance - no specific validation needed
        feedback: {
          success: 'Great! You\'ve explored the properties panel. Ready to test?',
          failure: 'Review the properties panel settings.',
        },
        timeout: 60000,
        optional: true,
      },
    },

    {
      id: 'step-6-test-workflow',
      title: 'Test Your Workflow',
      content: `
# Testing Before Deployment

One of Qontinui's most powerful features is the ability to **test your automation before using it in production**. This saves time and prevents errors.

## Why Test?

Testing helps you:
- **Verify actions work** as expected
- **Identify errors** before they cause problems
- **Validate timing** and sequencing
- **Check element detection** accuracy
- **Refine configurations** based on results

## What Happens During a Test?

When you click "Run Workflow" in test mode:

1. **Dry Run** - The workflow simulates execution
2. **Element Detection** - Verifies all target elements can be found
3. **Action Validation** - Checks that each action is properly configured
4. **Sequence Check** - Confirms actions run in the correct order
5. **Results Report** - Shows what succeeded and what needs adjustment

## Test Results

You'll see color-coded feedback:
- 🟢 **Green** - Action succeeded
- 🟡 **Yellow** - Action completed with warnings
- 🔴 **Red** - Action failed (needs fixing)
- ⚪ **Gray** - Action not yet executed

## Your Task

Click the **"Run Workflow"** button (highlighted above) to test your automation.

Watch as Qontinui executes your action(s) and provides feedback. This is a safe test - nothing is permanently changed.

**Don't worry if something doesn't work perfectly!** That's what testing is for. You can adjust and test again.
`,
      estimatedDuration: 2,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand the importance of testing workflows',
        'Learn how to run workflow tests',
        'Interpret test results and feedback',
        'Practice iterative testing and refinement',
      ],
      tips: [
        'Always test workflows before deploying them to production',
        'If a test fails, check the error message for hints on what went wrong',
        'You can test individual actions or the entire workflow',
        'Test with different data inputs to ensure robustness',
      ],
      targetElement: {
        selector: '[data-tutorial-id="run-workflow"]',
        highlightType: 'pulse',
        position: 'bottom',
        allowInteraction: true,
        scrollIntoView: true,
        delay: 200,
      },
      validation: {
        type: 'action',
        condition: 'window.workflowTestRun === true || document.querySelector(".test-results, [data-test-results]")',
        feedback: {
          success: 'Excellent! You\'ve run your first workflow test. Check the results!',
          failure: 'Click the "Run Workflow" button to test your automation.',
          hint: 'Look for a button with "Run", "Test", or a play icon (▶)',
        },
        timeout: 60000,
        optional: true,
      },
      waitForUserAction: true,
      resources: [
        {
          title: 'Debugging Workflows',
          url: 'https://docs.qontinui.io/guides/debugging',
          type: 'documentation',
        },
        {
          title: 'Testing Best Practices',
          url: 'https://docs.qontinui.io/guides/testing',
          type: 'article',
        },
      ],
    },

    {
      id: 'step-7-save-workflow',
      title: 'Save Your Work',
      content: `
# Saving Your Automation

You've successfully created and tested your first automation! Now it's time to **save your work** so you can use it anytime.

## Why Save?

Saving your workflow allows you to:
- **Reuse it** whenever needed
- **Edit and improve** it over time
- **Share it** with team members (if applicable)
- **Deploy it** to production environments
- **Track versions** and changes

## What Gets Saved?

When you save a workflow, Qontinui stores:
- ✅ Workflow name and description
- ✅ All actions and their configurations
- ✅ Execution mode (Sequential, Parallel, etc.)
- ✅ Error handling settings
- ✅ Test results and validation data
- ✅ Metadata (created date, last modified, etc.)

## Saving Options

Depending on your setup, you might be able to:
- **Save Locally** - Store on your device for personal use
- **Save to Cloud** - Sync across devices and share
- **Export** - Download as a file for backup or sharing
- **Publish** - Make available to your team or organization

## Your Task

Click the **"Save Workflow"** button (highlighted above) to save your automation.

You'll be prompted to confirm the save. Once saved, your workflow will appear in your workflow library, ready to use!

**Congratulations!** You're about to complete your first automation workflow! 🎉
`,
      estimatedDuration: 1,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand workflow persistence',
        'Learn how to save workflows',
        'Know what data is stored when saving',
        'Practice workflow management',
      ],
      tips: [
        'Save early and save often - especially when making significant changes',
        'Use descriptive names to make workflows easy to find later',
        'Consider exporting important workflows as backups',
        'You can create copies of workflows to experiment without affecting originals',
      ],
      targetElement: {
        selector: '[data-tutorial-id="save-workflow"]',
        highlightType: 'pulse',
        position: 'bottom',
        allowInteraction: true,
        scrollIntoView: true,
        offset: { x: 0, y: 10 },
      },
      validation: {
        type: 'action',
        condition: 'window.workflowSaved === true || localStorage.getItem("workflowSaved") === "true"',
        feedback: {
          success: 'Perfect! Your workflow is saved and ready to use!',
          failure: 'Click the "Save Workflow" button to save your automation.',
          hint: 'Look for a "Save" button, often with a disk or floppy icon',
        },
        timeout: 45000,
        optional: false,
      },
      waitForUserAction: true,
    },

    {
      id: 'step-8-completion',
      title: 'Congratulations! 🎉',
      content: `
# You've Created Your First Automation!

**Well done!** You've successfully completed the "First Automation" tutorial and learned the fundamentals of building workflows in Qontinui.

## What You've Learned

In this tutorial, you:
- ✅ Named and configured a workflow
- ✅ Selected Sequential execution mode
- ✅ Added and configured actions
- ✅ Tested your automation safely
- ✅ Saved your work for future use

## Your Next Steps

Now that you understand the basics, here's how to continue your automation journey:

### 1. **Build More Complex Workflows**
Try creating automations with multiple actions:
- Login sequences (navigate → enter username → enter password → click login)
- Data collection workflows (open page → extract data → save to file)
- Form filling automations (load form → fill fields → submit)

### 2. **Explore Advanced Features**
- **Conditional logic** - Branch based on conditions
- **Loops** - Repeat actions until a goal is met
- **Variables** - Store and reuse data across actions
- **Error recovery** - Handle failures gracefully

### 3. **Join the Community**
- **Share your workflows** - Help others learn
- **Get inspired** - Browse community automations
- **Ask questions** - Connect with other users
- **Contribute** - Improve Qontinui together

### 4. **Take More Tutorials**
- **"Working with Screenshots"** - Advanced element detection
- **"Building Complex Workflows"** - Multi-step automations
- **"Error Handling"** - Making robust workflows
- **"Game Automation"** - Specific examples (like Civ 6)

## Quick Tips to Remember

- **Start simple** - Master basic actions before complex workflows
- **Test frequently** - Catch issues early
- **Use descriptive names** - Your future self will thank you
- **Iterate and improve** - Workflows can always be refined
- **Document your work** - Add descriptions and comments

## Need Help?

If you get stuck or have questions:
- 📚 **Read the docs** - [docs.qontinui.io](https://docs.qontinui.io)
- 💬 **Ask the community** - [community.qontinui.io](https://community.qontinui.io)
- 🎥 **Watch tutorials** - [youtube.com/qontinui](https://youtube.com/qontinui)
- ✉️ **Contact support** - support@qontinui.io

## One More Thing...

You can **replay this tutorial** anytime from the Help menu. Feel free to practice until you're completely comfortable.

**Welcome to the world of intelligent automation!** 🚀

*Now go build something amazing!*
`,
      estimatedDuration: 2,
      difficulty: 'beginner',
      learningObjectives: [
        'Celebrate completing the first automation',
        'Understand next learning steps',
        'Know where to find additional resources',
        'Feel confident building more workflows',
      ],
      tips: [
        'Bookmark the documentation for quick reference',
        'Start with simple automations that solve real problems for you',
        'Don\'t be afraid to experiment - you can always undo changes',
        'Share your success with the community - beginners helping beginners!',
      ],
      targetElement: {
        selector: 'body',
        highlightType: 'spotlight',
        position: 'center',
        allowInteraction: false,
        scrollIntoView: false,
      },
      resources: [
        {
          title: 'Complete Documentation',
          url: 'https://docs.qontinui.io',
          type: 'documentation',
        },
        {
          title: 'Tutorial Library',
          url: 'https://docs.qontinui.io/tutorials',
          type: 'documentation',
        },
        {
          title: 'Community Forum',
          url: 'https://community.qontinui.io',
          type: 'article',
        },
        {
          title: 'Video Tutorials',
          url: 'https://youtube.com/qontinui',
          type: 'video',
        },
        {
          title: 'API Reference',
          url: 'https://docs.qontinui.io/api',
          type: 'api-reference',
        },
      ],
    },
  ],

  finalProject: {
    name: 'My First Workflow',
    description: 'A complete beginner automation workflow created in the Automation Builder',
    components: [
      'Workflow configuration (name, mode)',
      'At least one configured action',
      'Testing validation',
      'Saved workflow',
    ],
    expectedOutcome:
      'A working automation workflow that demonstrates understanding of the Automation Builder interface and basic workflow concepts',
    timeToAutomate: 'Foundation for building any automation workflow',
  },

  prerequisites: [],
};

export default firstAutomationTutorial;
