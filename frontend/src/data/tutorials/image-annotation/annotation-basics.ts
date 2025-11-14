import { Tutorial } from '@/types/tutorial';

/**
 * Image Annotation Basics Tutorial
 *
 * Teaches users how to annotate screenshots and create pattern matches in Qontinui.
 * This beginner-level tutorial guides users through the fundamentals of image annotation,
 * from uploading screenshots to creating and testing pattern matches with proper
 * search regions and confidence thresholds.
 *
 * This tutorial uses contextual mode to provide in-page guidance while users
 * work with the actual annotation tools.
 */
const annotationBasicsTutorial: Tutorial = {
  id: 'image-annotation-basics',
  title: 'Image Annotation Basics',
  description:
    'Learn how to annotate screenshots and create accurate pattern matches for automation. Master the fundamentals of identifying UI elements, defining search regions, and setting confidence thresholds.',
  duration: '20 minutes',
  difficulty: 'beginner',
  mode: 'contextual',
  targetPage: '/annotations',
  category: 'Core Skills',
  tags: ['annotation', 'pattern-matching', 'screenshots', 'beginner', 'fundamentals'],

  learningObjectives: [
    'Understand the purpose and importance of image annotation',
    'Upload and manage screenshots effectively',
    'Identify and annotate UI elements accurately',
    'Create reliable pattern matches',
    'Define optimal search regions for efficiency',
    'Set appropriate confidence thresholds',
    'Test and validate pattern matches',
    'Save and organize annotations for reuse',
  ],

  triggers: {
    automatic: false,
    manual: true,
    contextual: [
      {
        event: 'page-load',
        condition: 'return window.location.pathname === "/annotations" && !localStorage.getItem("annotation-basics-completed")',
      },
      {
        event: 'first-annotation-attempt',
        condition: 'return !localStorage.getItem("annotation-basics-started")',
      },
    ],
  },

  workflowIntegration: {
    enableRealEditing: true,
    provideSampleData: true,
    validateUserActions: true,
    sampleData: {
      sampleScreenshots: [
        '/tutorials/annotation-basics/sample-ui.png',
        '/tutorials/annotation-basics/sample-button.png',
      ],
      sampleElements: [
        {
          name: 'Login Button',
          type: 'button',
          description: 'Primary login button on authentication screen',
        },
      ],
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
      id: 'step-1-welcome',
      title: 'Welcome to Image Annotation',
      content: `
# Welcome to Image Annotation in Qontinui

Image annotation is the **foundation of visual automation**. By teaching Qontinui what UI elements look like, you enable it to recognize and interact with applications intelligently.

## What is Image Annotation?

Image annotation is the process of:
- **Capturing screenshots** of your application or game
- **Identifying UI elements** (buttons, menus, icons, text fields)
- **Creating pattern matches** that Qontinui uses to find these elements
- **Defining search regions** to optimize recognition speed
- **Setting confidence thresholds** to ensure accurate matching

## Why Does This Matter?

Traditional automation relies on brittle approaches:
- **Coordinate-based**: Click at pixel (X, Y) - breaks when window resizes
- **Hardcoded**: Specific to one resolution or UI layout
- **Fragile**: Fails with minor UI changes or updates

**Pattern matching is different**:
- ✅ **Adaptive**: Works across different resolutions and window sizes
- ✅ **Visual**: Recognizes elements by appearance, not coordinates
- ✅ **Resilient**: Tolerates minor UI changes
- ✅ **Intelligent**: Finds elements even when they move
- ✅ **Human-like**: Mirrors how you visually identify elements

## Real-World Examples

**Game Automation**:
- Find the "Attack" button in any battle scenario
- Detect when resources are available for building
- Identify unit selection states

**Application Automation**:
- Click the "Save" button in different themes
- Detect form validation errors
- Find specific menu items

**Quality Assurance**:
- Verify UI elements appear correctly
- Detect visual regressions
- Test across different environments

## What You'll Build

By the end of this tutorial, you'll:
1. Upload screenshots of UI elements
2. Annotate specific elements for pattern matching
3. Create a working pattern match with search regions
4. Set optimal confidence thresholds
5. Test and validate your annotations
6. Save them for use in automations

**Let's get started with the fundamentals!**
`,
      estimatedDuration: 2,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand what image annotation is and why it matters',
        'See the advantages of pattern matching over coordinate-based automation',
        'Learn the workflow for creating annotations',
      ],
      tips: [
        'Pattern matching is more reliable than coordinate clicking',
        'Good annotations are the foundation of robust automations',
        'Start with clear, distinct UI elements for your first annotations',
      ],
      targetElement: {
        selector: '[data-tutorial-id="annotation-welcome"]',
        highlightType: 'spotlight',
        position: 'center',
        allowInteraction: false,
        scrollIntoView: true,
      },
    },

    {
      id: 'step-2-upload-screenshot',
      title: 'Upload a Screenshot',
      content: `
# Capturing and Uploading Screenshots

The first step in creating annotations is providing Qontinui with **screenshots** of the UI you want to automate.

## What Makes a Good Screenshot?

### ✅ DO:
- **Capture the entire application window** - Include all relevant UI elements
- **Use full resolution** - Don't resize or compress screenshots
- **Keep UI clean** - Close tooltips, notifications, or overlays
- **Show the target element clearly** - The element should be visible and unobstructed
- **Capture normal states** - Use typical UI states, not edge cases (for now)
- **Use PNG format** - Best for UI screenshots (lossless, sharp text)

### ❌ DON'T:
- **Crop too tightly** - Context around elements helps pattern matching
- **Include mouse cursor** - Unless specifically needed
- **Use low quality** - Avoid JPEG compression artifacts
- **Capture during animations** - Wait for UI to settle
- **Include temporary overlays** - Close tooltips or hover states

## How to Capture Screenshots

### Windows:
- **Full window**: \`Alt + PrtScn\` or \`Win + Shift + S\`
- **Specific area**: Windows Snipping Tool

### macOS:
- **Full window**: \`Cmd + Shift + 4\`, then \`Space\`, then click window
- **Specific area**: \`Cmd + Shift + 4\`, drag to select

### Linux:
- **Full window**: \`PrtScn\` or use Screenshot tool
- **Specific area**: \`Shift + PrtScn\`, drag to select

## Organizing Your Screenshots

Create a logical structure:
\`\`\`
screenshots/
├── login/
│   ├── login-button.png
│   ├── username-field.png
│   └── password-field.png
├── dashboard/
│   ├── menu-button.png
│   └── profile-icon.png
└── game/
    ├── attack-button.png
    └── resource-counter.png
\`\`\`

## Your Turn

Upload a screenshot using the uploader below. You can either:
1. **Use the sample screenshot** provided in the tutorial
2. **Upload your own screenshot** of any UI you want to automate

**Pro tip**: If this is your first annotation, start with a simple, clearly visible button or icon.
`,
      estimatedDuration: 3,
      difficulty: 'beginner',
      screenshot: '/tutorials/annotation-basics/screenshot-example.png',
      annotations: [
        {
          type: 'highlight',
          x: 100,
          y: 100,
          width: 400,
          height: 300,
          label: 'Clear UI element\nGood for annotation',
          color: '#4CAF50',
        },
        {
          type: 'arrow',
          x: 300,
          y: 450,
          label: 'Avoid capturing tooltips',
        },
      ],
      learningObjectives: [
        'Understand what makes a good screenshot for annotation',
        'Learn how to capture screenshots on your platform',
        'Practice uploading screenshots to Qontinui',
      ],
      tryIt: {
        type: 'upload-screenshots',
        component: 'ScreenshotUploader',
        hints: [
          'Use PNG format for best quality',
          'Ensure the UI element you want to annotate is clearly visible',
          'Full window captures are better than cropped regions',
          'You can upload multiple screenshots for different UI states',
        ],
        successCriteria: {
          description: 'Upload at least one screenshot showing a clear UI element',
          validation: {
            minScreenshots: 1,
            format: 'png or jpg',
            minWidth: 400,
            minHeight: 300,
          },
        },
      },
      tips: [
        'Screenshot quality directly impacts pattern matching accuracy',
        'Multiple screenshots of the same element in different states improve recognition',
        'Name your screenshots descriptively for easy organization',
      ],
      targetElement: {
        selector: '[data-tutorial-id="screenshot-uploader"]',
        highlightType: 'border',
        position: 'top',
        allowInteraction: true,
        scrollIntoView: true,
      },
      validation: {
        type: 'action',
        condition: 'return document.querySelectorAll("[data-screenshot-uploaded]").length > 0',
        feedback: {
          success: 'Great! Screenshot uploaded successfully.',
          failure: 'Please upload a screenshot to continue.',
          hint: 'Click the upload area or drag and drop your screenshot file.',
        },
      },
    },

    {
      id: 'step-3-identify-element',
      title: 'Identify UI Elements',
      content: `
# Identifying and Annotating UI Elements

Now that you have a screenshot, it's time to **identify the specific UI element** you want Qontinui to recognize.

## What is a UI Element?

UI elements are the interactive or visual components of your application:

### Common Element Types:
- **Buttons**: Click targets (Save, Cancel, Attack, Build)
- **Icons**: Visual indicators (settings gear, notification bell)
- **Text Fields**: Input areas (username, search box)
- **Labels**: Static text (headings, descriptions)
- **Images**: Graphics (avatars, product photos)
- **Indicators**: Status displays (health bar, resource counter)
- **Menu Items**: Navigation options

## How to Identify Elements

1. **Look at your screenshot** - What element do you want to interact with?
2. **Draw a bounding box** - Select the smallest area that fully contains the element
3. **Name it clearly** - Use descriptive names: "login-button", "health-indicator"
4. **Add a description** - Note what it does or when it appears

## Best Practices

### Element Size:
- **Not too small**: Include enough visual context for matching
- **Not too large**: Avoid unnecessary background
- **Just right**: The element plus a small margin

### Element Selection:
- **Unique features**: Choose elements with distinctive appearance
- **Stable elements**: Prefer elements that don't change frequently
- **High contrast**: Elements that stand out from background

### Naming Convention:
\`\`\`
Good names:
✅ login-button
✅ main-menu-icon
✅ health-bar
✅ confirm-dialog-ok

Avoid:
❌ button1
❌ thing
❌ element
❌ xyz
\`\`\`

## Visual Identification Tool

You'll use an interactive highlighter to:
1. **Click and drag** to create a bounding box around the element
2. **Adjust the selection** to fit precisely
3. **Name the element** descriptively
4. **Confirm** when satisfied

## Your Turn

Identify a clear UI element in your screenshot:
- Draw a bounding box around it
- Give it a descriptive name
- Add a brief description of its purpose

**Tip**: Start with a button or icon - they're usually the easiest elements to annotate.
`,
      estimatedDuration: 4,
      difficulty: 'beginner',
      screenshot: '/tutorials/annotation-basics/identify-element.png',
      annotations: [
        {
          type: 'highlight',
          x: 200,
          y: 150,
          width: 120,
          height: 40,
          label: 'Example button\nGood size for annotation',
          color: '#2196F3',
        },
        {
          type: 'highlight',
          x: 200,
          y: 220,
          width: 300,
          height: 100,
          label: 'Too much context\nReduce bounding box',
          color: '#FF5722',
        },
        {
          type: 'highlight',
          x: 220,
          y: 350,
          width: 30,
          height: 15,
          label: 'Too small\nAdd more context',
          color: '#FF5722',
        },
      ],
      learningObjectives: [
        'Identify different types of UI elements',
        'Create accurate bounding boxes',
        'Name and describe elements effectively',
      ],
      tryIt: {
        type: 'identify-element',
        component: 'ElementHighlighter',
        preloadedData: {
          elementTypes: ['button', 'icon', 'text-field', 'label', 'image', 'indicator'],
        },
        hints: [
          'Click and drag to create a bounding box around the element',
          'The box should fully contain the element with a small margin',
          'Use descriptive names that indicate what the element is and does',
          'Include the element type in your description (button, icon, etc.)',
        ],
        successCriteria: {
          description: 'Successfully identify and annotate at least one UI element',
          validation: {
            minAnnotations: 1,
            hasValidBoundingBox: true,
            hasName: true,
            hasDescription: true,
          },
        },
      },
      tips: [
        'Good bounding boxes are crucial for accurate pattern matching',
        'If an element has multiple states (hover, pressed), annotate the normal state first',
        'You can always adjust the annotation later if needed',
      ],
      targetElement: {
        selector: '[data-tutorial-id="element-highlighter"]',
        highlightType: 'border',
        position: 'right',
        allowInteraction: true,
        scrollIntoView: true,
      },
      validation: {
        type: 'state',
        condition: 'return window.annotationState && window.annotationState.elements && window.annotationState.elements.length > 0',
        feedback: {
          success: 'Excellent! Element identified and annotated.',
          failure: 'Please identify at least one UI element.',
          hint: 'Use the highlighter tool to draw a box around a UI element.',
        },
      },
    },

    {
      id: 'step-4-create-pattern',
      title: 'Create a Pattern Match',
      content: `
# Creating Pattern Matches

Now that you've identified a UI element, let's create a **pattern match** that Qontinui will use to find this element during automation.

## What is a Pattern Match?

A pattern match is a visual template that describes what an element looks like:
- **The visual appearance**: Colors, shapes, text, icons
- **The surrounding context**: Nearby elements that help locate it
- **The matching algorithm**: How strictly to match the pattern

## How Pattern Matching Works

When Qontinui searches for an element:

\`\`\`
1. Load the pattern (your annotated element)
2. Scan the current screen
3. Compare each region to the pattern
4. Calculate similarity scores (0-100%)
5. Find matches above confidence threshold
6. Return the best match
\`\`\`

## Pattern Match Configuration

### Pattern Name
Give your pattern a clear, unique name:
- \`login-button-primary\`
- \`health-indicator-full\`
- \`menu-settings-icon\`

### Pattern Type
Choose based on element characteristics:
- **Exact Match**: Element looks identical (logos, specific icons)
- **Template Match**: Element is similar (buttons with text)
- **Feature Match**: Element has distinctive features (complex UI)
- **Color Match**: Element is defined by color (indicators, markers)

### Matching Algorithm
- **Normalized Cross-Correlation**: Best for most UI elements
- **Square Difference**: Fast, good for exact matches
- **Correlation Coefficient**: Handles lighting variations

## Creating Your Pattern

The pattern creator will:
1. **Extract the element** from your screenshot
2. **Generate a template** for matching
3. **Configure matching parameters** based on element type
4. **Preview the pattern** before saving

## Best Practices

### Pattern Quality:
- **Clear and distinct**: Unique visual features
- **Appropriate size**: Not too small or too large
- **Good contrast**: Element stands out from background
- **Stable appearance**: Doesn't change frequently

### Common Pitfalls:
- ❌ **Too generic**: Pattern matches many things
- ❌ **Too specific**: Only matches exact pixel arrangement
- ❌ **Includes variables**: Text that changes (user names, dates)
- ❌ **Poor quality**: Blurry or low-resolution source

## Your Turn

Create a pattern match for the element you identified:
1. Review the extracted pattern preview
2. Choose an appropriate matching algorithm
3. Name your pattern descriptively
4. Save the pattern for testing

**Pro tip**: Most buttons and icons work well with Template Match and Normalized Cross-Correlation.
`,
      estimatedDuration: 4,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand how pattern matching works',
        'Choose appropriate matching algorithms',
        'Create effective pattern templates',
        'Avoid common pattern matching mistakes',
      ],
      config: {
        patternMatchTypes: [
          {
            name: 'Template Match',
            description: 'Standard pattern matching for most UI elements',
            algorithm: 'TM_CCOEFF_NORMED',
            bestFor: 'Buttons, icons, text labels',
          },
          {
            name: 'Exact Match',
            description: 'Pixel-perfect matching for identical elements',
            algorithm: 'TM_SQDIFF_NORMED',
            bestFor: 'Logos, specific graphics',
          },
          {
            name: 'Feature Match',
            description: 'Advanced matching for complex patterns',
            algorithm: 'FEATURE_BASED',
            bestFor: 'Complex UI, variable elements',
          },
        ],
      },
      tips: [
        'Start with Template Match - it works for 90% of UI elements',
        'If matching is too loose, try Exact Match',
        'For elements with variable parts, use Feature Match',
        'Pattern names should be unique and descriptive',
      ],
      resources: [
        {
          title: 'Pattern Matching Algorithms Explained',
          url: 'https://docs.qontinui.io/concepts/pattern-matching',
          type: 'documentation',
        },
        {
          title: 'Choosing the Right Match Type',
          url: 'https://docs.qontinui.io/guides/match-types',
          type: 'article',
        },
      ],
      targetElement: {
        selector: '[data-tutorial-id="pattern-creator"]',
        highlightType: 'spotlight',
        position: 'left',
        allowInteraction: true,
        scrollIntoView: true,
      },
    },

    {
      id: 'step-5-search-region',
      title: 'Define Search Region',
      content: `
# Optimizing with Search Regions

Search regions dramatically improve pattern matching **speed and accuracy** by telling Qontinui where to look for elements.

## What is a Search Region?

A search region defines the **area of the screen** where an element can appear:

\`\`\`
Full Screen (1920x1080):
┌─────────────────────────────┐
│                             │ ← Searching everywhere
│      Where is              │    takes time and may
│      the button?           │    find false matches
│                             │
└─────────────────────────────┘

With Search Region:
┌─────────────────────────────┐
│                             │
│                  ┌────────┐ │ ← Only search here
│                  │ Button │ │    Faster & more
│                  └────────┘ │    accurate
└─────────────────────────────┘
\`\`\`

## Why Use Search Regions?

### Performance:
- **10x faster matching** - Search only where needed
- **Reduced CPU usage** - Less image processing
- **Better responsiveness** - Quicker automation execution

### Accuracy:
- **Fewer false positives** - Ignore similar elements elsewhere
- **Higher confidence scores** - Element is where expected
- **More reliable automation** - Consistent results

## Common Search Regions

### UI Location-Based:
- **Top Bar**: Menus, window controls (y: 0-100)
- **Bottom Bar**: Status, controls (y: screen.height - 100)
- **Left Sidebar**: Navigation, tools (x: 0-200)
- **Right Sidebar**: Properties, info (x: screen.width - 200)
- **Center**: Main content area

### Context-Based:
- **Dialog Boxes**: Modal dialogs, popups
- **Toolbars**: Specific toolbar regions
- **Game HUD**: Fixed UI overlay areas
- **Forms**: Input field regions

### Dynamic Regions:
- **Relative to other elements**: "Below the header"
- **Calculated**: Based on screen resolution
- **Adaptive**: Changes based on UI state

## Defining Your Search Region

Methods to define regions:

### 1. Visual Selection (Recommended for beginners):
- Draw a rectangle on the screenshot
- Qontinui calculates coordinates

### 2. Coordinate Input:
- Specify: \`x, y, width, height\`
- Example: \`100, 50, 300, 200\`

### 3. Percentage-Based:
- Relative to screen size
- Example: \`top-right-quadrant\`, \`bottom-10%\`

### 4. Element-Relative:
- "Within the dialog box"
- "Below the main menu"

## Best Practices

### Size:
- **Large enough**: Include possible movement range
- **Small enough**: Exclude unrelated areas
- **Add margin**: 10-20 pixels buffer around typical location

### Position:
- **Stable areas**: Use regions that don't resize
- **Consider responsive UI**: Account for window size changes
- **Test multiple resolutions**: Verify region works universally

## Your Turn

Define a search region for your annotated element:

1. **Look at where the element appears** on your screenshot
2. **Draw a region** that includes the element's possible locations
3. **Add appropriate margins** for variation
4. **Name the region** descriptively

Example: If annotating a "Save" button that always appears in the bottom-right corner, create a region covering that area.

**Tip**: If unsure, start with a larger region and refine it later based on performance.
`,
      estimatedDuration: 3,
      difficulty: 'beginner',
      screenshot: '/tutorials/annotation-basics/search-regions.png',
      annotations: [
        {
          type: 'highlight',
          x: 50,
          y: 50,
          width: 900,
          height: 600,
          label: 'Full screen search\nSlow, may find duplicates',
          color: '#FF9800',
        },
        {
          type: 'highlight',
          x: 700,
          y: 500,
          width: 200,
          height: 100,
          label: 'Optimized region\nFast, accurate',
          color: '#4CAF50',
        },
        {
          type: 'arrow',
          x: 750,
          y: 520,
          label: 'Element always here',
        },
      ],
      learningObjectives: [
        'Understand the purpose and benefits of search regions',
        'Define effective search regions for UI elements',
        'Balance region size for performance and reliability',
        'Use different methods to specify regions',
      ],
      config: {
        regionTypes: [
          { name: 'Full Screen', description: 'Search entire screen', performance: 'slow', accuracy: 'low' },
          { name: 'Quadrant', description: 'Top-left, top-right, bottom-left, bottom-right', performance: 'medium', accuracy: 'medium' },
          { name: 'Custom Rectangle', description: 'Specific coordinates', performance: 'fast', accuracy: 'high' },
          { name: 'Element-Relative', description: 'Relative to another element', performance: 'fast', accuracy: 'high' },
        ],
      },
      tips: [
        'Most UI elements stay in consistent screen positions - use this to your advantage',
        'For game HUDs, search regions are essential as HUD elements rarely move',
        'You can have multiple search regions for elements that appear in different contexts',
        'Test your search region at different resolutions to ensure it works universally',
      ],
      targetElement: {
        selector: '[data-tutorial-id="search-region-tool"]',
        highlightType: 'border',
        position: 'top',
        allowInteraction: true,
        scrollIntoView: true,
      },
    },

    {
      id: 'step-6-confidence-threshold',
      title: 'Set Confidence Threshold',
      content: `
# Understanding Confidence Thresholds

The confidence threshold determines **how closely a match must resemble your pattern** to be considered valid.

## What is Confidence?

Confidence is a **similarity score** between your pattern and a region on screen:

\`\`\`
100% = Pixel-perfect match (very rare)
95%  = Excellent match (nearly identical)
90%  = Very good match (typical for stable UI)
85%  = Good match (minor variations)
80%  = Acceptable match (some differences)
75%  = Loose match (significant variations)
<70% = Likely not a match
\`\`\`

## How It Works

When Qontinui searches:
1. Compares pattern to each screen region
2. Calculates similarity score (0-100%)
3. If score ≥ threshold → Match found ✓
4. If score < threshold → Keep searching

## Choosing the Right Threshold

### Too High (95%+):
- ✅ Very accurate matches
- ✅ No false positives
- ❌ May miss valid matches
- ❌ Breaks with minor UI changes
- **Use for**: Exact logos, specific graphics

### Balanced (85-90%):
- ✅ Reliable matching
- ✅ Tolerates minor variations
- ✅ Rarely false positives
- ✅ Most common choice
- **Use for**: Buttons, icons, labels

### Lower (75-85%):
- ✅ Flexible matching
- ✅ Works with UI variations
- ❌ May have false positives
- ❌ Requires good search regions
- **Use for**: Variable UI, multiple states

### Too Low (<75%):
- ❌ Many false positives
- ❌ Unreliable automation
- ❌ Not recommended
- **Use for**: Rarely appropriate

## Factors Affecting Confidence

### Screen Quality:
- **Resolution**: Higher res = more consistent matching
- **Scaling**: UI scaling affects pattern matching
- **Rendering**: Anti-aliasing can affect scores

### Element Changes:
- **State changes**: Hover, pressed, disabled states
- **Theme changes**: Dark mode, color schemes
- **Updates**: UI redesigns, icon changes

### Pattern Quality:
- **Screenshot quality**: Higher quality = better matching
- **Pattern size**: Larger patterns more distinctive
- **Uniqueness**: Unique elements easier to match

## Setting Your Threshold

### Step-by-step approach:

1. **Start at 85%** (good default)
2. **Test the pattern** in actual use
3. **Adjust based on results**:
   - Misses valid matches → Lower by 3-5%
   - False positives → Raise by 3-5%
4. **Re-test** until reliable

### Testing Strategy:

Test your pattern in multiple scenarios:
- ✓ Normal state
- ✓ After UI theme change
- ✓ Different window sizes
- ✓ After application restart
- ✓ With similar but different elements nearby

## Your Turn

Set an appropriate confidence threshold for your pattern:

1. **Review your pattern** - How unique is it?
2. **Consider variations** - What might change?
3. **Start with 85%** - Good default for most UI
4. **Prepare to adjust** - Fine-tune based on testing

**Important**: You'll test this threshold in the next step and can adjust it based on results.
`,
      estimatedDuration: 3,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand what confidence thresholds represent',
        'Choose appropriate thresholds for different element types',
        'Balance accuracy with flexibility',
        'Troubleshoot threshold-related issues',
      ],
      config: {
        recommendedThresholds: {
          logos: 95,
          buttons: 87,
          icons: 85,
          text: 82,
          indicators: 80,
          variable: 75,
        },
        thresholdExamples: [
          {
            threshold: 95,
            description: 'Company logo (exact match required)',
            pros: 'No false positives',
            cons: 'May fail with minor rendering differences',
          },
          {
            threshold: 87,
            description: 'Primary action button (standard)',
            pros: 'Reliable, tolerates minor changes',
            cons: 'Rarely an issue',
          },
          {
            threshold: 80,
            description: 'Health indicator bar (variable fill)',
            pros: 'Works with different states',
            cons: 'May match similar elements',
          },
        ],
      },
      tips: [
        'Default to 85% for most buttons and UI elements',
        'Use higher thresholds (90%+) for critical actions to avoid mistakes',
        'Lower thresholds (80-85%) work better for elements with variable content',
        'Always test your threshold in real scenarios before relying on it',
        'Keep notes on which thresholds work for different element types',
      ],
      resources: [
        {
          title: 'Confidence Threshold Guide',
          url: 'https://docs.qontinui.io/guides/confidence-thresholds',
          type: 'documentation',
        },
        {
          title: 'Troubleshooting Pattern Matching',
          url: 'https://docs.qontinui.io/guides/troubleshooting-patterns',
          type: 'article',
        },
      ],
      targetElement: {
        selector: '[data-tutorial-id="confidence-slider"]',
        highlightType: 'pulse',
        position: 'right',
        allowInteraction: true,
        scrollIntoView: true,
      },
    },

    {
      id: 'step-7-test-pattern',
      title: 'Test the Pattern Match',
      content: `
# Testing Your Pattern Match

Testing is **critical** to ensuring your annotation works reliably in real automation scenarios.

## Why Test?

What works in theory may fail in practice:
- Element may look different in different contexts
- Confidence threshold may be too high or too low
- Search region may be too restrictive
- Similar elements may cause false matches

**Testing reveals issues before they break your automation.**

## Testing Strategy

### 1. Basic Functionality Test
Verify the pattern works in the simplest case:
- ✓ Finds the element on the original screenshot
- ✓ Returns appropriate confidence score
- ✓ Identifies correct location

### 2. Variation Test
Test with different scenarios:
- ✓ Different window sizes
- ✓ Different screen positions (if window can move)
- ✓ Different UI states (if applicable)
- ✓ Different themes (light/dark mode)

### 3. False Positive Test
Ensure it doesn't match wrong elements:
- ✓ Similar but different buttons
- ✓ Elements with similar appearance
- ✓ Background patterns
- ✓ Other UI components

### 4. Performance Test
Verify matching speed:
- ✓ Returns results quickly (< 100ms typical)
- ✓ Search region is appropriately sized
- ✓ Doesn't consume excessive resources

## Using the Test Tool

The pattern test tool allows you to:

1. **Load a test screenshot** - Use the same or different screenshot
2. **Run pattern matching** - Execute the match algorithm
3. **View results** - See matches highlighted
4. **Check confidence** - Review similarity scores
5. **Iterate** - Adjust and re-test

### Test Results Interpretation:

\`\`\`
✅ Match found, confidence ≥ threshold
   → Pattern works! Ready to use.

⚠️ Match found, but confidence borderline
   → May be unreliable. Adjust threshold or pattern.

❌ No match found
   → Check pattern, search region, threshold.
   → May need to re-annotate element.

⚠️ Multiple matches found
   → Search region too large or pattern too generic.
   → Refine search region or pattern.
\`\`\`

## Common Issues and Fixes

### Issue: Pattern not found
**Possible causes**:
- Threshold too high
- Search region doesn't include element
- Element appearance changed
- Poor quality pattern

**Solutions**:
- Lower threshold by 5%
- Expand search region
- Re-capture pattern
- Use higher quality screenshot

### Issue: Multiple matches
**Possible causes**:
- Pattern too generic
- Search region too large
- Multiple similar elements

**Solutions**:
- Refine pattern to be more specific
- Reduce search region
- Add context to pattern

### Issue: Low confidence scores
**Possible causes**:
- Screenshot quality mismatch
- UI scaling differences
- Theme or color changes

**Solutions**:
- Match screenshot quality and scale
- Use template matching
- Lower threshold appropriately

## Your Turn

Test your pattern match:

1. **Click "Test Pattern"** to run matching
2. **Review the results** - Was the element found?
3. **Check confidence score** - Is it above your threshold?
4. **Verify location** - Is the match in the right place?
5. **Adjust if needed**:
   - Threshold too high/low?
   - Search region appropriate?
   - Pattern quality good?
6. **Re-test** until reliable

**Success criteria**: Pattern consistently finds the element with 85%+ confidence and no false positives.
`,
      estimatedDuration: 5,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand the importance of testing pattern matches',
        'Use the pattern testing tool effectively',
        'Interpret test results and confidence scores',
        'Troubleshoot common pattern matching issues',
        'Iterate on patterns for optimal performance',
      ],
      tryIt: {
        type: 'test-automation',
        component: 'PatternTester',
        preloadedData: {
          testScenarios: [
            {
              name: 'Basic Match',
              description: 'Test on original screenshot',
            },
            {
              name: 'Different State',
              description: 'Test with UI in different state',
            },
            {
              name: 'Similar Element Nearby',
              description: 'Verify no false positive',
            },
          ],
        },
        hints: [
          'Start by testing on the original screenshot - this should always work',
          'Try screenshots with different window sizes or positions',
          'Test with similar but different elements to check for false positives',
          'If matching fails, try lowering the threshold by 5% increments',
          'If getting false matches, increase threshold or refine search region',
        ],
        successCriteria: {
          description: 'Successfully test pattern and achieve reliable matching',
          validation: {
            patternFound: true,
            confidenceAboveThreshold: true,
            noFalsePositives: true,
          },
        },
      },
      tips: [
        'Good testing now saves hours of debugging later',
        'Test with realistic scenarios you\'ll encounter in automation',
        'Keep test screenshots for regression testing when you update patterns',
        'Document what works and what doesn\'t for future reference',
      ],
      resources: [
        {
          title: 'Pattern Testing Best Practices',
          url: 'https://docs.qontinui.io/guides/testing-patterns',
          type: 'documentation',
        },
      ],
      targetElement: {
        selector: '[data-tutorial-id="pattern-tester"]',
        highlightType: 'spotlight',
        position: 'center',
        allowInteraction: true,
        scrollIntoView: true,
      },
      validation: {
        type: 'custom',
        condition: 'return window.patternTestResults && window.patternTestResults.success === true',
        feedback: {
          success: 'Excellent! Your pattern test was successful.',
          failure: 'Pattern test incomplete. Please test your pattern.',
          hint: 'Click the Test Pattern button to validate your annotation.',
        },
        timeout: 30000,
      },
    },

    {
      id: 'step-8-save-annotation',
      title: 'Save Your Annotation',
      content: `
# Saving and Managing Annotations

You've successfully created, configured, and tested your pattern match. The final step is to **save it for use in automations**.

## What Gets Saved?

Your annotation includes:
- ✓ **Pattern template** - The visual pattern to match
- ✓ **Element metadata** - Name, description, type
- ✓ **Search region** - Where to look for the element
- ✓ **Confidence threshold** - Minimum similarity score
- ✓ **Matching configuration** - Algorithm and parameters
- ✓ **Test results** - Validation data

## Naming Conventions

Use clear, descriptive names that follow a pattern:

### Good naming:
\`\`\`
application-area-element-state

Examples:
✅ gmail-compose-send-button
✅ civ6-units-settler-icon
✅ app-menu-settings-gear
✅ game-hud-health-full
✅ dialog-confirm-ok-button
\`\`\`

### Avoid:
\`\`\`
❌ button1
❌ temp
❌ test
❌ element_final_v3
\`\`\`

## Organization

Organize annotations into logical groups:

\`\`\`
annotations/
├── authentication/
│   ├── login-button
│   ├── username-field
│   └── password-field
├── navigation/
│   ├── menu-icon
│   ├── home-button
│   └── settings-gear
└── game-ui/
    ├── attack-button
    ├── defend-button
    └── health-indicator
\`\`\`

## Annotation Metadata

Include helpful metadata:

### Description:
- What the element is
- What it does
- When it appears
- Any important context

### Tags:
- Element type (button, icon, field)
- Application (gmail, civ6, app-name)
- Category (auth, nav, combat)
- State (enabled, disabled, hover)

### Version:
- Track changes over time
- Note what changed and why

## Using Saved Annotations

Once saved, you can:

1. **Reference in workflows** - Use the annotation in automation sequences
2. **Reuse across projects** - Share patterns between automations
3. **Update as needed** - Modify if UI changes
4. **Export and share** - Share with team or community
5. **Version control** - Track changes and roll back if needed

## Best Practices

### Before Saving:
- ✓ Test thoroughly
- ✓ Use descriptive name
- ✓ Add detailed description
- ✓ Apply relevant tags
- ✓ Document any limitations

### After Saving:
- ✓ Test in actual automation
- ✓ Document usage examples
- ✓ Note any issues encountered
- ✓ Update if UI changes
- ✓ Share with team if applicable

## Annotation Library

Build a library of reusable annotations:
- **Common UI patterns** - Buttons, dialogs, menus
- **Application-specific** - Per app/game elements
- **State variations** - Different element states
- **Cross-platform** - Same element on different OS

## Your Turn

Save your annotation:

1. **Review all settings** - Pattern, region, threshold
2. **Add a descriptive name** - Follow naming convention
3. **Write a helpful description** - What, when, where
4. **Add relevant tags** - For organization
5. **Click "Save Annotation"**

**Congratulations!** You've created your first complete annotation. You can now use this in automation workflows.

## Next Steps

Now that you've mastered the basics:

1. **Create more annotations** - Build your library
2. **Build automations** - Use annotations in workflows
3. **Advanced techniques** - Multi-state patterns, dynamic regions
4. **Share knowledge** - Help others learn annotation

**Welcome to the world of visual automation!**
`,
      estimatedDuration: 3,
      difficulty: 'beginner',
      learningObjectives: [
        'Save annotations with appropriate metadata',
        'Use effective naming conventions',
        'Organize annotations logically',
        'Build reusable annotation libraries',
        'Understand annotation lifecycle management',
      ],
      config: {
        namingExamples: {
          good: [
            'gmail-compose-send-button',
            'civ6-units-settler-icon',
            'app-settings-menu-gear',
            'game-combat-attack-button',
          ],
          bad: [
            'button1',
            'element',
            'test123',
            'final_v2',
          ],
        },
        metadataFields: {
          required: ['name', 'description', 'pattern', 'threshold'],
          recommended: ['tags', 'searchRegion', 'category'],
          optional: ['version', 'author', 'notes', 'dependencies'],
        },
      },
      tips: [
        'Descriptive names and metadata make annotations easier to find and reuse',
        'Build your annotation library incrementally - quality over quantity',
        'Regularly test saved annotations to catch UI changes early',
        'Version your annotations if you need to update them',
        'Consider creating annotation templates for common patterns',
      ],
      resources: [
        {
          title: 'Annotation Management Guide',
          url: 'https://docs.qontinui.io/guides/annotation-management',
          type: 'documentation',
        },
        {
          title: 'Building Annotation Libraries',
          url: 'https://docs.qontinui.io/guides/annotation-libraries',
          type: 'article',
        },
        {
          title: 'Community Annotation Repository',
          url: 'https://github.com/qontinui/annotations',
          type: 'api-reference',
        },
      ],
      targetElement: {
        selector: '[data-tutorial-id="save-annotation"]',
        highlightType: 'pulse',
        position: 'bottom',
        allowInteraction: true,
        scrollIntoView: true,
      },
      validation: {
        type: 'action',
        condition: 'return window.annotationState && window.annotationState.saved === true',
        feedback: {
          success: 'Perfect! Your annotation has been saved successfully.',
          failure: 'Please save your annotation to complete the tutorial.',
          hint: 'Click the Save button to store your annotation.',
        },
      },
    },
  ],

  finalProject: {
    name: 'Complete UI Element Annotation',
    description:
      'A fully configured and tested annotation ready for use in automation workflows',
    components: [
      'Screenshot upload',
      'Element identification',
      'Pattern match creation',
      'Search region definition',
      'Confidence threshold configuration',
      'Pattern testing and validation',
      'Annotation saving and metadata',
    ],
    expectedOutcome:
      'Reliable pattern match that can be used in automation sequences to interact with UI elements',
  },

  prerequisites: [],
};

export default annotationBasicsTutorial;
