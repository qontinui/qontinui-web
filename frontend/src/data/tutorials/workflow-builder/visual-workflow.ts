import { Tutorial } from '@/types/tutorial';

/**
 * Visual Workflow Editor Tutorial
 *
 * An intermediate-level hybrid tutorial that teaches users how to use the
 * graph-based workflow editor in Qontinui. This tutorial combines overlay
 * and contextual modes to provide an interactive learning experience.
 *
 * Users will learn to create, configure, and test visual workflows using
 * the node-based graph editor, understanding how to build complex automation
 * sequences with visual programming.
 */
export const visualWorkflowTutorial: Tutorial = {
  id: 'visual-workflow-editor',
  title: 'Visual Workflow Editor',
  description:
    'Master the graph-based workflow editor to create complex automation sequences visually. Learn to use nodes, connections, and auto-layout features for building sophisticated workflows.',
  duration: '25 minutes',
  difficulty: 'intermediate',
  mode: 'hybrid',
  category: 'Workflow Builder',
  tags: ['workflow', 'graph-editor', 'visual-programming', 'automation', 'intermediate'],
  targetPage: '/automation-builder',

  prerequisites: ['first-automation'],

  learningObjectives: [
    'Understand the difference between sequential and graph-based workflows',
    'Navigate and use the visual workflow canvas effectively',
    'Create and connect workflow nodes to build automation logic',
    'Configure node properties and validate workflow correctness',
    'Use auto-layout features for organizing complex workflows',
    'Test and debug visual workflows in real-time',
    'Import and export workflows for sharing and versioning',
  ],

  workflowIntegration: {
    enableRealEditing: true,
    provideSampleData: true,
    validateUserActions: true,
    sampleData: {
      sampleWorkflow: {
        name: 'Sample Visual Workflow',
        nodes: [
          {
            id: 'node-1',
            type: 'trigger',
            position: { x: 100, y: 100 },
            data: { label: 'Start' },
          },
          {
            id: 'node-2',
            type: 'action',
            position: { x: 300, y: 100 },
            data: { label: 'Click Button' },
          },
          {
            id: 'node-3',
            type: 'condition',
            position: { x: 500, y: 100 },
            data: { label: 'Check State' },
          },
        ],
        edges: [
          { id: 'edge-1', source: 'node-1', target: 'node-2' },
          { id: 'edge-2', source: 'node-2', target: 'node-3' },
        ],
      },
    },
    cleanup: true,
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
      id: 'step-1-introduction',
      title: 'Introduction to Visual Workflows',
      content: `
# Welcome to Visual Workflow Programming

The Visual Workflow Editor is a powerful tool that lets you build complex automation sequences using a **graph-based, node-and-wire** approach instead of linear sequential steps.

## Graph vs Sequential Workflows

### Sequential Workflows (What You've Learned)
- Actions execute in a fixed order: 1 → 2 → 3 → 4
- Simple to understand and create
- Limited flexibility for complex logic
- Like a straight road with no turns

### Graph Workflows (What We'll Learn Now)
- Actions connect in any pattern you need
- Support **branching** (if/else logic)
- Support **loops** (repeat until condition)
- Support **parallel execution** (do multiple things at once)
- Like a road network with intersections, loops, and multiple routes

## Why Use Visual Workflows?

### Perfect for Complex Scenarios:
1. **Conditional Logic** - "If element found, do A, else do B"
2. **Error Handling** - "Try action, if fails, do recovery"
3. **Parallel Actions** - "Click button AND take screenshot simultaneously"
4. **Iterative Tasks** - "Repeat action until condition is met"
5. **Multi-path Workflows** - Different outcomes based on game/app state

### Real-World Example:
Imagine automating a game's resource gathering:

\`\`\`
Sequential Approach (limited):
1. Find resource → 2. Click resource → 3. Wait → 4. Repeat

Graph Approach (powerful):
                    ┌─→ Gather wood ──┐
                    │                  │
Start → Check inventory ─→ Gather stone ──→ Check full? → Return home
                    │                  │        ↓
                    └─→ Gather food ──┘        No
                                               ↓
                                          Continue gathering
\`\`\`

## What You'll Build Today

By the end of this tutorial, you'll create a visual workflow that:
- Uses multiple node types (triggers, actions, conditions, loops)
- Handles branching logic based on UI state
- Includes error handling and recovery
- Organizes complex logic visually and clearly

**Ready to think visually? Let's dive in!**
`,
      estimatedDuration: 3,
      difficulty: 'intermediate',
      learningObjectives: [
        'Understand the fundamental differences between sequential and graph-based workflows',
        'Recognize scenarios where visual workflows provide advantages',
        'Learn the basic terminology of node-based programming',
      ],
      tips: [
        'Visual workflows may seem complex at first, but they make complex logic much easier to understand',
        'Think of nodes as LEGO blocks - each does one thing, and you connect them creatively',
        'You can always start with a sequential workflow and convert it to a graph later',
      ],
      resources: [
        {
          title: 'Visual Programming Concepts',
          url: 'https://docs.qontinui.io/concepts/visual-programming',
          type: 'documentation',
        },
        {
          title: 'When to Use Graph Workflows',
          url: 'https://docs.qontinui.io/guides/choosing-workflow-type',
          type: 'article',
        },
      ],
    },

    {
      id: 'step-2-switch-to-graph-mode',
      title: 'Switch to Graph Mode',
      content: `
# Activating the Visual Workflow Editor

Before we can build visual workflows, we need to switch the Automation Builder to **Graph Mode**.

## Finding the Mode Selector

The mode selector is located in the top toolbar of the Automation Builder page. It lets you toggle between:

- **Sequential Mode** - Traditional step-by-step workflows
- **Graph Mode** - Visual node-based workflows

## How to Switch

1. Look for the mode selector in the toolbar (usually toggle buttons or a dropdown)
2. Click on **"Graph Mode"** or **"Visual Mode"**
3. The canvas will transform to show the graph editor

## What Changes?

When you switch to Graph Mode:

✅ **Canvas appears** - A grid-based workspace for placing nodes
✅ **Node palette opens** - A panel showing available node types
✅ **Toolbar updates** - New tools for graph manipulation (zoom, pan, auto-layout)
✅ **Properties panel** - Shows selected node/edge properties

## Your Task

**Click the mode selector and switch to Graph Mode now.**

Watch how the interface transforms - this is your visual workflow workspace!
`,
      estimatedDuration: 1,
      difficulty: 'beginner',
      targetElement: {
        selector: '[data-tutorial-id="mode-selector"]',
        highlightType: 'spotlight',
        position: 'bottom',
        allowInteraction: true,
        scrollIntoView: true,
      },
      validation: {
        type: 'state',
        condition: 'document.querySelector("[data-workflow-mode=\\"graph\\"]") !== null',
        feedback: {
          success: 'Great! Graph Mode is now active. The visual canvas is ready.',
          failure: 'Mode not switched yet. Click the Graph Mode toggle in the toolbar.',
          hint: 'Look for a toggle or dropdown labeled "Mode" or "View" near the top of the page',
        },
        timeout: 30000,
      },
      learningObjectives: [
        'Locate and use the mode selector',
        'Understand the visual differences between modes',
        'Activate the graph-based editor interface',
      ],
      tips: [
        'You can switch between modes anytime - your work is preserved',
        'Some automations are easier in Sequential, others in Graph - choose what fits',
      ],
    },

    {
      id: 'step-3-understanding-canvas',
      title: 'Understanding the Canvas',
      content: `
# Exploring the Visual Workflow Canvas

Now that you're in Graph Mode, let's understand your **workspace** - the canvas where you'll build workflows.

## Canvas Features

### The Grid
- **Visual guide** for alignment and spacing
- **Snap-to-grid** (optional) for neat layouts
- **Zoomable** - scroll to zoom in/out for detail or overview

### Navigation
- **Pan** - Click and drag empty space to move around
- **Zoom** - Mouse wheel or pinch gesture to zoom
- **Fit to view** - Button to auto-frame all nodes
- **Mini-map** (if available) - Bird's eye view of entire workflow

### Canvas Toolbar
Look for these tools:
- 🔍 **Zoom controls** - +/- buttons or slider
- 🧭 **Pan/Select mode** - Toggle between moving canvas vs selecting nodes
- 📐 **Auto-layout** - Automatically organize nodes (we'll use this later)
- 🗑️ **Delete selected** - Remove nodes or connections
- ↩️ **Undo/Redo** - Fix mistakes

## Try These Actions

### Practice Navigation:
1. **Pan the canvas** - Click and drag on empty space
2. **Zoom in** - Scroll up or use the + button
3. **Zoom out** - Scroll down or use the - button
4. **Fit all** - Click the "fit to view" button (if available)

### Understanding the Workspace:
- Notice the coordinate grid
- See how zoom affects detail level
- Get comfortable moving around

## Why This Matters

A large workflow might have **dozens of nodes**. Being able to navigate efficiently means:
- Quickly finding specific parts of your logic
- Understanding overall workflow structure at a glance
- Editing details without losing context

**Take a moment to practice navigating the canvas before continuing.**
`,
      estimatedDuration: 2,
      difficulty: 'beginner',
      targetElement: {
        selector: '[data-tutorial-id="graph-canvas"]',
        highlightType: 'border',
        position: 'top',
        allowInteraction: true,
        scrollIntoView: true,
      },
      learningObjectives: [
        'Navigate the visual workflow canvas effectively',
        'Use zoom and pan controls for workflow exploration',
        'Understand the canvas coordinate system',
      ],
      tips: [
        'Keyboard shortcuts are your friend - check the help menu for canvas shortcuts',
        'Zoom out for big-picture view, zoom in for precise editing',
        'Most graph editors support space-bar + drag for panning',
      ],
      resources: [
        {
          title: 'Canvas Navigation Guide',
          url: 'https://docs.qontinui.io/editor/canvas-navigation',
          type: 'documentation',
        },
      ],
    },

    {
      id: 'step-4-node-palette',
      title: 'Using the Node Palette',
      content: `
# The Node Palette: Your Building Blocks

The **Node Palette** is where you'll find all available node types for building your workflow. Think of it as your toolbox.

## Common Node Types

### 🎯 Trigger Nodes (Start Points)
- **Manual Trigger** - Start workflow on button click
- **Scheduled Trigger** - Start at specific time/interval
- **Event Trigger** - Start when condition met (e.g., "window appears")
- **Hotkey Trigger** - Start when keyboard shortcut pressed

### ⚡ Action Nodes (Do Things)
- **Click** - Click UI element
- **Type** - Enter text into field
- **Wait** - Pause for duration
- **Screenshot** - Capture screen
- **Custom Action** - Your defined actions

### 🔀 Logic Nodes (Make Decisions)
- **Condition** - If/else branching
- **Loop** - Repeat until condition
- **Switch** - Multiple path selection (like if/else if/else)
- **Parallel** - Execute multiple branches simultaneously

### 🔗 Utility Nodes
- **Variable** - Store/retrieve data
- **Transform** - Modify data (e.g., convert text to number)
- **Log** - Output debug information
- **Subflow** - Call another workflow

## Finding Nodes

The palette typically organizes nodes by:
- **Category** (Triggers, Actions, Logic, etc.)
- **Search** - Type to filter nodes
- **Favorites** - Star frequently-used nodes
- **Recent** - Recently added nodes

## Your Task

**Explore the Node Palette:**
1. Locate the palette (usually left or right sidebar)
2. Browse different categories
3. Click on a few nodes to see their descriptions
4. Notice the icons and colors (visual coding)

**Don't add any nodes yet** - just familiarize yourself with what's available.
`,
      estimatedDuration: 3,
      difficulty: 'intermediate',
      targetElement: {
        selector: '[data-tutorial-id="node-palette-panel"]',
        highlightType: 'spotlight',
        position: 'right',
        allowInteraction: true,
        scrollIntoView: true,
      },
      learningObjectives: [
        'Identify different node types and their purposes',
        'Navigate the node palette efficiently',
        'Understand node categorization and organization',
      ],
      tips: [
        'Color-coding helps: Triggers are often green, Actions blue, Logic yellow/orange',
        'Read node descriptions - they explain inputs, outputs, and use cases',
        'Some nodes are context-specific (only appear when certain features are enabled)',
      ],
      resources: [
        {
          title: 'Complete Node Reference',
          url: 'https://docs.qontinui.io/nodes/reference',
          type: 'documentation',
        },
        {
          title: 'Node Type Guide',
          url: 'https://docs.qontinui.io/nodes/types',
          type: 'article',
        },
      ],
    },

    {
      id: 'step-5-adding-nodes',
      title: 'Adding Nodes to Canvas',
      content: `
# Building Your First Visual Workflow

Now comes the fun part - **adding nodes to the canvas** and creating your workflow structure!

## How to Add Nodes

### Method 1: Drag and Drop
1. Find a node in the palette
2. Click and hold on the node
3. Drag it onto the canvas
4. Release to place it

### Method 2: Click to Add (if supported)
1. Click a node in the palette
2. Click on the canvas where you want it
3. Node appears at that location

### Method 3: Right-Click Menu (if supported)
1. Right-click on empty canvas space
2. Select "Add Node" from context menu
3. Choose node type from submenu

## Creating Your First Workflow

Let's build a simple workflow together:

### Step-by-Step:
1. **Add a Trigger node** - Drag "Manual Trigger" to the canvas (top-left area)
2. **Add an Action node** - Drag "Click" node to the right of the trigger
3. **Add a Condition node** - Drag "Condition" node to the right of the action
4. **Add two more Action nodes** - One above the condition (success path), one below (failure path)

Don't worry about connecting them yet - we'll do that in the next step.

### Positioning Tips:
- **Left to right flow** - Standard workflow direction (easier to read)
- **Top to bottom for alternatives** - Multiple paths stack vertically
- **Leave space** - Room for connections and labels

## Your Task

**Create this node layout:**
\`\`\`
[Manual Trigger] → [Click Action] → [Condition]
                                           ↓
                                      [Success Action]
                                           ↓
                                      [Failure Action]
\`\`\`

Add these 5 nodes to your canvas. We'll connect them in the next step!
`,
      estimatedDuration: 4,
      difficulty: 'intermediate',
      screenshot: '/tutorials/workflow-builder/step5-adding-nodes.png',
      annotations: [
        {
          type: 'highlight',
          x: 50,
          y: 150,
          width: 120,
          height: 80,
          label: '1. Manual Trigger\nDrag from palette',
        },
        {
          type: 'arrow',
          x: 200,
          y: 180,
          label: 'Flow direction →',
        },
        {
          type: 'highlight',
          x: 250,
          y: 150,
          width: 120,
          height: 80,
          label: '2. Click Action',
        },
        {
          type: 'highlight',
          x: 450,
          y: 150,
          width: 120,
          height: 80,
          label: '3. Condition Node',
        },
        {
          type: 'highlight',
          x: 650,
          y: 100,
          width: 120,
          height: 60,
          label: '4. Success Path',
          color: '#22c55e',
        },
        {
          type: 'highlight',
          x: 650,
          y: 200,
          width: 120,
          height: 60,
          label: '5. Failure Path',
          color: '#ef4444',
        },
      ],
      targetElement: {
        selector: '[data-tutorial-id="drag-node"]',
        highlightType: 'pulse',
        position: 'left',
        allowInteraction: true,
      },
      validation: {
        type: 'state',
        condition: 'document.querySelectorAll("[data-node-type]").length >= 5',
        feedback: {
          success: 'Excellent! You have added 5 nodes to the canvas.',
          failure: 'Keep going! Add more nodes to reach a total of 5.',
          hint: 'Drag nodes from the palette onto the canvas. You need at least 5 nodes.',
        },
        timeout: 60000,
        optional: false,
      },
      learningObjectives: [
        'Add nodes to the canvas using drag-and-drop',
        'Position nodes logically for workflow clarity',
        'Understand basic workflow layout conventions',
      ],
      tips: [
        'Hold Shift while dragging to align nodes perfectly',
        'Double-click a node to edit its label immediately',
        'Use Ctrl+Z (Cmd+Z on Mac) to undo if you misplace a node',
        'Nodes can be moved after placement - don\'t worry about perfect positioning yet',
      ],
    },

    {
      id: 'step-6-connecting-nodes',
      title: 'Connecting Nodes',
      content: `
# Wiring Your Workflow: Node Connections

Nodes alone don't do much - the **magic happens when you connect them** to define the flow of execution.

## Understanding Connections

### Ports (Connection Points)
Each node has **ports** where connections attach:

- **Input ports** (left side) - Where data/control flows IN
- **Output ports** (right side) - Where data/control flows OUT
- **Multiple outputs** - Some nodes have multiple paths (e.g., Condition has "true" and "false")

### Connection Types
Connections can represent:
- **Control flow** - Execution order (do this, then that)
- **Data flow** - Passing information between nodes
- **Both** - Some connections carry both control and data

Visual cues:
- **Solid lines** - Active connections
- **Dashed lines** - Conditional connections
- **Colors** - May indicate data type (string, number, boolean)

## How to Connect Nodes

### Standard Method:
1. **Hover over the output port** of the source node (usually on the right)
2. **Click and drag** from the output port
3. **Drag to the input port** of the target node (usually on the left)
4. **Release** to create the connection

### Auto-Connect (if supported):
- Select a node and press a key (often Ctrl+drag) while dragging to auto-connect

### Delete Connections:
- Click on a connection line to select it
- Press Delete or Backspace
- Or right-click and choose "Delete"

## Your Task: Wire the Workflow

Connect your 5 nodes following this logic:

\`\`\`
Manual Trigger → Click Action → Condition
                                   ├─(true)──→ Success Action
                                   └─(false)─→ Failure Action
\`\`\`

### Step-by-Step:
1. **Connect Trigger to Click** - Drag from Trigger's output to Click's input
2. **Connect Click to Condition** - Drag from Click's output to Condition's input
3. **Connect Condition's "true" port** to Success Action's input
4. **Connect Condition's "false" port** to Failure Action's input

Watch as your workflow comes to life with visual connections!

## Troubleshooting

**Connection won't attach?**
- Ensure you're dragging to a valid input port
- Some ports only accept specific connection types
- Check that output → input direction is correct

**Wrong connection made?**
- Simply delete it and try again (click + Delete key)
- Or drag the connection endpoint to a different port
`,
      estimatedDuration: 3,
      difficulty: 'intermediate',
      screenshot: '/tutorials/workflow-builder/step6-connections.png',
      annotations: [
        {
          type: 'arrow',
          x: 170,
          y: 180,
          label: 'Connection 1:\nTrigger → Click',
          color: '#3b82f6',
        },
        {
          type: 'arrow',
          x: 370,
          y: 180,
          label: 'Connection 2:\nClick → Condition',
          color: '#3b82f6',
        },
        {
          type: 'arrow',
          x: 580,
          y: 150,
          label: 'True path',
          color: '#22c55e',
        },
        {
          type: 'arrow',
          x: 580,
          y: 210,
          label: 'False path',
          color: '#ef4444',
        },
        {
          type: 'pulse',
          x: 170,
          y: 180,
          width: 30,
          height: 30,
          duration: 2000,
        },
      ],
      learningObjectives: [
        'Create connections between workflow nodes',
        'Understand input and output ports',
        'Build conditional branching logic visually',
        'Manage and edit node connections',
      ],
      tips: [
        'Connections auto-route around nodes - the editor makes them look clean',
        'You can reshape connections by dragging them (if editor supports it)',
        'Hover over a connection to see what data/control it carries',
        'Disconnected nodes (no input connection) won\'t execute',
      ],
      resources: [
        {
          title: 'Working with Connections',
          url: 'https://docs.qontinui.io/editor/connections',
          type: 'documentation',
        },
      ],
    },

    {
      id: 'step-7-node-properties',
      title: 'Configuring Node Properties',
      content: `
# Fine-Tuning Nodes: The Properties Panel

Now that your nodes are connected, it's time to **configure what each node actually does**. This is where you define the details.

## The Properties Panel

When you **select a node** (click on it), the **Properties Panel** appears, typically on the right side of the screen.

### Common Properties:

#### All Nodes:
- **Name/Label** - Human-readable identifier
- **Description** - What this node does (for documentation)
- **Error Handling** - What happens if this node fails

#### Action Nodes (like Click):
- **Target Element** - CSS selector or element ID to interact with
- **Click Type** - Single, double, right-click
- **Wait After** - Delay after action (milliseconds)
- **Retry Count** - How many times to retry on failure

#### Condition Nodes:
- **Condition Type** - Element exists, text matches, value equals, etc.
- **Expected Value** - What to check for
- **Comparison** - Equals, contains, greater than, etc.
- **Timeout** - How long to wait for condition

#### Trigger Nodes:
- **Trigger Type** - Manual, scheduled, event-based
- **Parameters** - Specific trigger configuration

## Configuring Your Workflow

Let's configure each node in your workflow:

### 1. Manual Trigger
- **Name:** "Start Workflow"
- **Description:** "Manually initiated test workflow"

### 2. Click Action
- **Name:** "Click Submit Button"
- **Target Element:** \`button[id="submit-btn"]\`
- **Click Type:** Single Click
- **Wait After:** 500ms

### 3. Condition Node
- **Name:** "Check Success Message"
- **Condition Type:** Element Exists
- **Target Element:** \`.success-message\`
- **Timeout:** 5000ms

### 4. Success Action
- **Name:** "Log Success"
- **Action Type:** Log Message
- **Message:** "Form submitted successfully!"

### 5. Failure Action
- **Name:** "Log Failure"
- **Action Type:** Log Message
- **Message:** "Form submission failed - no success message found"

## Your Task

**Select each node and configure its properties** as described above. Watch how your workflow transforms from abstract structure to concrete automation logic!

## Validation

Well-configured nodes:
- Have descriptive names (not "Node 1", "Node 2")
- Have all required properties filled
- Use appropriate selectors/conditions
- Include error handling where needed
`,
      estimatedDuration: 5,
      difficulty: 'intermediate',
      targetElement: {
        selector: '[data-tutorial-id="graph-properties"]',
        highlightType: 'spotlight',
        position: 'left',
        allowInteraction: true,
        scrollIntoView: true,
      },
      learningObjectives: [
        'Access and use the node properties panel',
        'Configure node-specific settings and parameters',
        'Set up action targets and conditions properly',
        'Understand validation and error handling options',
      ],
      tips: [
        'Use meaningful names - future you will thank present you',
        'Test selectors in browser DevTools before using them in nodes',
        'Set reasonable timeouts - too short = false failures, too long = slow workflows',
        'Always configure error handling for critical nodes',
      ],
      resources: [
        {
          title: 'Node Properties Reference',
          url: 'https://docs.qontinui.io/nodes/properties',
          type: 'documentation',
        },
        {
          title: 'CSS Selectors Guide',
          url: 'https://docs.qontinui.io/guides/selectors',
          type: 'article',
        },
      ],
    },

    {
      id: 'step-8-auto-layout',
      title: 'Auto Layout for Clean Workflows',
      content: `
# Organizing Complex Workflows with Auto-Layout

As workflows grow, they can become messy and hard to read. The **Auto-Layout** feature automatically organizes your nodes for optimal clarity.

## Why Auto-Layout Matters

### Before Auto-Layout:
- Nodes overlap or are oddly spaced
- Connections cross unnecessarily
- Hard to follow the logic flow
- Looks unprofessional

### After Auto-Layout:
- Nodes aligned in logical flow (left to right, top to bottom)
- Even spacing between elements
- Minimal connection crossings
- Easy to understand at a glance

## Auto-Layout Algorithms

Different algorithms optimize for different goals:

### 🌳 Hierarchical Layout
- Best for: **Tree-like workflows** (one start, branches)
- Places nodes in layers (ranks)
- Minimizes connection crossings
- Clear top-to-bottom or left-to-right flow

### 🔷 Force-Directed Layout
- Best for: **Interconnected networks** (many connections)
- Uses physics simulation (nodes repel, connections attract)
- Organic, natural-looking arrangement
- Good for complex, non-linear workflows

### 📏 Grid Layout
- Best for: **Uniform spacing** needs
- Places nodes on a grid
- Very organized, but may not reflect logical flow
- Good for documentation screenshots

### ⚡ Quick Tidy
- Best for: **Minor adjustments**
- Aligns nodes without complete reorganization
- Preserves your general layout
- Quick cleanup after edits

## Using Auto-Layout

### Your Task:

1. **Select all nodes** - Drag a selection box or press Ctrl+A (Cmd+A on Mac)
2. **Click the Auto-Layout button** in the toolbar
3. **Choose layout algorithm** (if prompted) - Select "Hierarchical"
4. **Watch the magic** - Nodes reorganize automatically

### Fine-Tuning:
After auto-layout, you can:
- Manually adjust specific nodes
- Change spacing settings (if available)
- Re-run with different algorithm
- Undo if you don't like the result (Ctrl+Z)

## Your Task

**Apply auto-layout to your workflow now.**

Notice how the 5 nodes reorganize into a clean, logical structure. This is especially valuable when workflows grow to 20, 50, or 100+ nodes!

## Best Practices

- **Run auto-layout periodically** as you build
- **Manually adjust critical labels** for readability after layout
- **Save before auto-layout** (in case you want to revert)
- **Use consistent layouts** across related workflows (easier to compare)
`,
      estimatedDuration: 2,
      difficulty: 'beginner',
      targetElement: {
        selector: '[data-tutorial-id="auto-layout"]',
        highlightType: 'pulse',
        position: 'bottom',
        allowInteraction: true,
      },
      validation: {
        type: 'action',
        condition: 'document.querySelector("[data-layout-applied=\\"true\\"]") !== null',
        feedback: {
          success: 'Perfect! Your workflow is now beautifully organized.',
          failure: 'Click the Auto-Layout button to organize your nodes.',
          hint: 'Look for a button with an icon showing organized boxes or nodes',
        },
        timeout: 30000,
      },
      learningObjectives: [
        'Understand the importance of workflow organization',
        'Use auto-layout tools effectively',
        'Choose appropriate layout algorithms',
        'Maintain readable workflows as they grow',
      ],
      tips: [
        'Auto-layout is non-destructive - you can always undo it',
        'Different algorithms work better for different workflow shapes',
        'Consider adding comments/labels before auto-layout to preserve context',
      ],
    },

    {
      id: 'step-9-testing-workflow',
      title: 'Testing the Visual Workflow',
      content: `
# Running and Testing Your Workflow

You've built a visual workflow - now it's time to **test it** and see your creation in action!

## The Test/Run System

### Execution Modes:

#### 🏃 Run (Normal Execution)
- Executes the workflow fully
- Real actions performed
- Stops on errors (unless handled)
- Use when: Confident in your workflow

#### 🐛 Debug Mode
- Executes step-by-step
- Pauses at each node
- Shows intermediate data/state
- Highlights active node
- Use when: Testing or troubleshooting

#### ✅ Validate (Dry Run)
- Checks workflow without executing
- Validates connections
- Checks required properties
- Identifies errors
- Use when: Before first run

## Running Your Workflow

### Your Task:

1. **Click the "Run Workflow" button** in the toolbar
2. **Watch the execution** - Nodes highlight as they execute
3. **Observe the results** - Check the output/logs

### What to Watch For:

✅ **Successful Execution:**
- Nodes light up in sequence (Trigger → Click → Condition → Success/Failure)
- Appropriate branch executes based on condition
- No error messages
- Expected outcome achieved

❌ **Failed Execution:**
- Node turns red (error indicator)
- Error message in console/log
- Workflow stops (unless error handling configured)

## Debugging Tips

### If the workflow fails:

1. **Check the logs** - Read error messages carefully
2. **Inspect the failing node** - Review its properties
3. **Test the selector** - Use browser DevTools to verify target element exists
4. **Run in Debug Mode** - Step through to see where it breaks
5. **Adjust and retry** - Fix the issue and run again

### Common Issues:

**Node doesn't execute:**
- ❓ Check: Is it connected to the flow?
- ❓ Check: Does the previous node complete successfully?

**Condition always takes one path:**
- ❓ Check: Is the condition configured correctly?
- ❓ Check: Does the element/state actually exist?

**Action fails:**
- ❓ Check: Is the selector accurate?
- ❓ Check: Is there enough wait time before this action?
- ❓ Check: Is the element visible and interactable?

## Your Task

**Run your workflow in Debug Mode:**
1. Click "Debug" or "Step Through" button
2. Observe each node execute one at a time
3. Check that the condition branches correctly
4. Verify the appropriate success/failure action executes

**Goal:** Understand how control flows through your visual workflow.
`,
      estimatedDuration: 4,
      difficulty: 'intermediate',
      targetElement: {
        selector: '[data-tutorial-id="run-workflow"]',
        highlightType: 'spotlight',
        position: 'bottom',
        allowInteraction: true,
      },
      validation: {
        type: 'action',
        condition: 'document.querySelector("[data-workflow-executed=\\"true\\"]") !== null',
        feedback: {
          success: 'Excellent! You have successfully executed your visual workflow.',
          failure: 'Click the Run or Debug button to test your workflow.',
          hint: 'Look for a play button ▶ or "Run" button in the toolbar',
        },
        timeout: 60000,
      },
      learningObjectives: [
        'Execute visual workflows and observe their behavior',
        'Use debug mode for step-by-step testing',
        'Interpret execution results and error messages',
        'Troubleshoot and fix workflow issues',
      ],
      tips: [
        'Always validate before first run - catches simple errors early',
        'Debug mode is slower but invaluable for understanding execution',
        'Keep the browser console open to see detailed logs',
        'Test edge cases: What if element doesn\'t exist? What if timeout occurs?',
      ],
      resources: [
        {
          title: 'Workflow Testing Guide',
          url: 'https://docs.qontinui.io/guides/testing-workflows',
          type: 'documentation',
        },
        {
          title: 'Debugging Visual Workflows',
          url: 'https://docs.qontinui.io/guides/debugging-graph-workflows',
          type: 'article',
        },
      ],
    },

    {
      id: 'step-10-import-export',
      title: 'Import and Export Workflows',
      content: `
# Sharing and Version Control: Import/Export

Your workflow is complete and tested. Now learn how to **save, share, and version** your visual workflows.

## Why Import/Export?

### Use Cases:

📦 **Backup and Restore**
- Save workflows before major changes
- Restore if something breaks
- Keep historical versions

🤝 **Sharing with Team**
- Share workflows with colleagues
- Contribute to community library
- Collaborate on complex automations

🔄 **Version Control**
- Commit workflows to Git
- Track changes over time
- Maintain multiple variants

📋 **Templates**
- Export as starting point for similar workflows
- Create reusable patterns
- Build workflow libraries

## Export Formats

### JSON (Recommended)
- Human-readable (with formatting)
- Includes all node configurations
- Includes layout/positioning
- Easy to diff in version control
\`\`\`json
{
  "name": "My Visual Workflow",
  "version": "1.0.0",
  "nodes": [...],
  "edges": [...],
  "metadata": {...}
}
\`\`\`

### YAML (Alternative)
- Even more readable
- Smaller file size
- Popular for configuration

### Binary/Compressed
- Smallest file size
- Not human-readable
- Best for large workflows

## How to Export

### Your Task - Export Your Workflow:

1. **Click the "Export" button** in the toolbar
2. **Choose format** - Select "JSON"
3. **Name your file** - e.g., "form-validation-workflow.json"
4. **Save** - File downloads to your computer

### What's Exported:
✅ All nodes and their configurations
✅ All connections between nodes
✅ Node positions and layout
✅ Workflow metadata (name, description, version)
✅ Comments and annotations (if any)

## How to Import

### Importing Existing Workflows:

1. **Click the "Import" button** in the toolbar
2. **Select file** - Choose a .json workflow file
3. **Review** - Preview the workflow structure
4. **Confirm** - Load into editor

### Options on Import:
- **Replace current** - Clears canvas and loads new workflow
- **Merge** - Adds imported nodes to existing workflow
- **New tab** - Opens in a new editor tab (if supported)

## Your Task

**Practice Import/Export:**

1. **Export your workflow** - Save it as "test-workflow.json"
2. **Clear the canvas** - Delete all nodes (don't worry, you saved it!)
3. **Import the workflow** - Load "test-workflow.json" back
4. **Verify** - Check that everything is restored correctly

## Best Practices

### File Organization:
\`\`\`
workflows/
├── production/
│   ├── form-automation-v1.2.json
│   └── data-processing-v2.0.json
├── development/
│   ├── experimental-workflow.json
│   └── test-conditions.json
└── templates/
    ├── basic-form-template.json
    └── api-integration-template.json
\`\`\`

### Naming Conventions:
- Include version number: \`workflow-v1.0.json\`
- Be descriptive: \`customer-onboarding-automation.json\`
- Add date for snapshots: \`workflow-2024-11-14.json\`

### Version Control:
\`\`\`bash
# Add to Git
git add workflows/my-workflow.json
git commit -m "Add form validation workflow"

# Create a tag for releases
git tag -a v1.0.0 -m "Release version 1.0.0"
\`\`\`

## Congratulations!

🎉 **You've completed the Visual Workflow Editor tutorial!**

You now know how to:
- ✅ Switch between Sequential and Graph modes
- ✅ Navigate the visual canvas
- ✅ Add and connect workflow nodes
- ✅ Configure node properties
- ✅ Use auto-layout for organization
- ✅ Test and debug visual workflows
- ✅ Import and export for sharing and backup

### Next Steps:

1. **Build complex workflows** - Try multi-level conditions, loops, parallel execution
2. **Explore advanced nodes** - Variables, transforms, subflows
3. **Integrate with your apps** - Apply visual workflows to real automation tasks
4. **Share your work** - Contribute to the Qontinui community

**Happy workflow building!**
`,
      estimatedDuration: 3,
      difficulty: 'intermediate',
      targetElement: {
        selector: '[data-tutorial-id="import-workflow"], [data-tutorial-id="export-workflow"]',
        highlightType: 'spotlight',
        position: 'bottom',
        allowInteraction: true,
      },
      learningObjectives: [
        'Export workflows for backup and sharing',
        'Import existing workflows into the editor',
        'Understand workflow file formats and structure',
        'Apply version control best practices to workflows',
      ],
      tips: [
        'Export before making major changes - easy undo if needed',
        'Keep exported workflows in version control (Git) for team collaboration',
        'Use meaningful names and include version numbers in filenames',
        'Share workflows via GitHub, community forums, or internal wikis',
      ],
      resources: [
        {
          title: 'Workflow File Format Specification',
          url: 'https://docs.qontinui.io/reference/workflow-format',
          type: 'api-reference',
        },
        {
          title: 'Version Control for Workflows',
          url: 'https://docs.qontinui.io/guides/version-control',
          type: 'article',
        },
        {
          title: 'Community Workflow Library',
          url: 'https://github.com/qontinui/workflow-library',
          type: 'article',
        },
        {
          title: 'Advanced Graph Workflows',
          url: 'https://docs.qontinui.io/advanced/graph-workflows',
          type: 'documentation',
        },
      ],
    },
  ],

  finalProject: {
    name: 'Complete Visual Workflow with Branching Logic',
    description:
      'A fully functional visual workflow demonstrating trigger, action, condition, and branching logic with proper error handling',
    components: [
      'Manual Trigger node configured',
      'Click Action node with target selector',
      'Condition node with validation logic',
      'Success and Failure action branches',
      'Organized layout using auto-layout',
      'Tested and validated execution',
      'Exported workflow file for backup',
    ],
    expectedOutcome:
      'A reusable, shareable visual workflow that demonstrates mastery of the graph-based editor',
    timeToComplete: '25 minutes',
  },
};

export default visualWorkflowTutorial;
