# Click-to-Template Workflow

The Click-to-Template feature enables automatic creation of template images for GUI automation by simply clicking on UI elements. Instead of manually cropping screenshots and configuring detection parameters, you can record your clicks and let the system automatically detect element boundaries.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step-by-Step Workflow](#step-by-step-workflow)
4. [Application Profiles](#application-profiles)
5. [Tips and Best Practices](#tips-and-best-practices)
6. [Troubleshooting](#troubleshooting)

---

## Overview

### What is Click-to-Template Automation?

Click-to-Template is a streamlined approach to creating visual automation templates. Traditional template creation requires:

1. Taking screenshots of your target application
2. Manually cropping each button, icon, or element
3. Configuring similarity thresholds and detection parameters
4. Testing and adjusting until templates work reliably

Click-to-Template simplifies this to:

1. Start a capture session
2. Click on the elements you want to automate
3. Review and approve detected templates
4. Generate a state machine configuration

### Benefits Over Manual Template Creation

| Manual Approach | Click-to-Template |
|----------------|-------------------|
| Time-consuming screenshot cropping | Automatic boundary detection |
| Guessing at detection parameters | Confidence scores guide decisions |
| Trial and error for thresholds | Auto-tuned settings per application |
| Separate tools for capture and config | Integrated end-to-end workflow |
| No context about click locations | Click positions preserved for transitions |

### When to Use This Feature

Click-to-Template is ideal when:

- Setting up automation for a new application
- Adding new UI elements to existing automation
- The target application has distinct visual elements (buttons, icons, panels)
- You want to quickly prototype automation workflows

Consider manual template creation when:

- Elements have very subtle visual differences
- You need pixel-perfect control over template boundaries
- Working with dynamic or animated UI elements

---

## Prerequisites

Before starting a capture session, ensure the following:

### 1. Qontinui Runner is Running and Connected

The capture system requires the Qontinui Runner desktop application:

- Start the runner with `npm run tauri dev` in the qontinui-runner directory
- Verify the connection status badge shows "Runner Connected" (green)
- If showing "Runner Offline" (red), start or restart the runner

### 2. A Project is Selected

- Navigate to your project in the web interface
- The Template Capture page requires an active project context
- If prompted, select or create a project first

### 3. Target Application is Visible

- Have your target application open and visible on screen
- Position windows so the UI elements you want to capture are accessible
- Avoid overlapping windows that might interfere with click capture

---

## Step-by-Step Workflow

### Starting a Capture Session

1. **Navigate to Template Capture**
   - Go to Automation Builder > Template Capture in the web interface
   - You will see three tabs: Capture, Review Templates, and App Profiles

2. **Enter Application Name (Optional)**
   - In the "Application Name" field, enter the name of your target application
   - Examples: "Civilization 6", "Calculator", "Chrome"
   - This helps optimize detection parameters and groups captures by application

3. **Click "Start Capture"**
   - The button changes to "Stop & Process" and a recording indicator appears
   - A duration timer shows how long you have been recording
   - The system is now monitoring all your clicks

### During Capture

While the capture session is active:

**Click naturally on UI elements you want to automate:**

- Buttons and clickable controls
- Icons and navigation elements
- Menu items and dropdown triggers
- Any visual element you want to detect later

**What gets recorded:**

- Click position (X, Y coordinates)
- Mouse button used (left, right, middle)
- Timestamp for each click
- Screenshot frame at the moment of click

**Best practices for clicking:**

- Click in the center of elements, not on edges
- Avoid clicking while dragging (single clicks only)
- Wait for UI animations to complete before clicking
- Click each unique element at least once
- Capture elements in different states if relevant (hover, active, etc.)

### Stopping Capture

1. **Click "Stop & Process"**
   - The button shows "Processing..." while analyzing your clicks
   - The system applies boundary detection algorithms to each click location

2. **Processing Steps:**
   - Video and input events are analyzed
   - Multiple detection strategies run on each click location
   - Primary and alternative boundaries are computed
   - Confidence scores are calculated

3. **Automatic Navigation**
   - When processing completes, you are automatically switched to the Review tab
   - A toast notification shows how many candidates were detected
   - If no clicks were detected, you will see a helpful message

### Reviewing Candidates

The Review Templates tab shows a grid of all detected template candidates.

**Understanding the Review Panel:**

- **Grid View**: Candidates displayed as cards with thumbnails
- **Status Badges**: Color-coded status (pending, approved, rejected, modified)
- **Confidence Scores**: Percentage indicating detection quality
- **Filter Dropdown**: Show all, pending, approved, or rejected candidates
- **Stats Bar**: Quick counts of total, pending, approved, and rejected

**Confidence Scores Explained:**

| Score | Color | Meaning |
|-------|-------|---------|
| 80%+ | Green | High confidence - likely accurate boundary |
| 50-79% | Yellow | Medium confidence - review carefully |
| Below 50% | Red | Low confidence - may need adjustment |

**Reviewing Individual Candidates:**

1. **Quick Actions (hover over card):**
   - **Approve** (checkmark): Accept the detected boundary as-is
   - **Reject** (X): Mark as false positive or unwanted
   - **Edit** (pencil): Open boundary adjustment editor

2. **Click on a pending candidate** to open the Boundary Adjustment Editor

**Bulk Operations:**

- Click "Select all pending" to select all pending candidates
- Use "Approve Selected" or "Reject Selected" for batch operations
- "Set State Hint" assigns a state hint to multiple templates at once

### Adjusting Boundaries

When a detection is not quite right, use the Boundary Adjustment Editor:

**Editor Features:**

- **Zoom Controls**: Zoom in/out for precise adjustments
- **Drag to Move**: Click and drag the boundary to reposition
- **Corner Handles**: Drag corners to resize the boundary
- **Alternative Boundaries**: Click on dashed rectangles to select alternative detections
- **Reset Button**: Return to the original detected boundary

**Making Adjustments:**

1. Open the editor by clicking on a candidate or the edit button
2. Zoom in for detailed work on small elements
3. Drag the boundary to cover exactly the element you want
4. Use corner handles to fine-tune the size
5. Check alternative boundaries - they may be more accurate
6. Click "Save & Approve" when satisfied

**Info Bar Shows:**

- Current position (X, Y)
- Current size (width x height)
- Detection strategy used
- Original click position

### Setting State Hints

State hints group templates into logical states for state machine generation.

**What are State Hints?**

State hints are labels you assign to templates indicating which application state (screen, dialog, menu) they belong to. Templates with the same state hint will be grouped together.

**Why State Hints Matter:**

- Essential for "State Hints" grouping method
- Helps organize complex applications
- Enables meaningful state machine generation
- Provides context for transitions between states

**How to Assign State Hints:**

1. **Single Template:**
   - Select templates and click "Set State Hint" in the bulk actions bar

2. **Multiple Templates:**
   - Use checkbox selection to pick related templates
   - Click "Set State Hint"
   - Choose an existing hint or create a new one

3. **In the Dialog:**
   - Select from existing state hints (shown as badges)
   - Or click "Create new state" to add a custom hint
   - Examples: "Main Menu", "Settings Screen", "Game Board", "Inventory"

**Grouping Related Templates:**

Think about which elements appear together on the same screen:

- All main menu buttons -> "Main Menu"
- Settings toggles and sliders -> "Settings"
- Inventory grid items -> "Inventory Screen"
- Dialog buttons and text -> "Confirmation Dialog"

### Generating the State Machine

Once you have approved templates (optionally with state hints), generate a state machine configuration.

**Access the Generator:**

- Click "Generate State Machine" button (appears when you have approved templates)

**Grouping Methods:**

| Method | Description | Best For |
|--------|-------------|----------|
| **State Hints** | Groups by assigned state hints | When you have organized templates with hints |
| **Co-Occurrence** | Automatic grouping by which templates appear together in video | When you have capture video and want automatic analysis |
| **Single State** | All templates in one state | Simple applications or quick prototyping |
| **One per Template** | Each template becomes its own state | When each element represents a distinct state |
| **Manual Assignments** | Manually specify state assignments | Full control over grouping |

**Configuring Options:**

1. **State Machine Name**: Give your configuration a descriptive name

2. **For State Hints Method:**
   - Requires templates to have state hints assigned
   - Preview shows which hints exist and template counts

3. **For Co-Occurrence Method:**
   - Set co-occurrence threshold (default 80%)
   - Higher values require templates to appear together more frequently
   - Requires original capture video

4. **For Single State Method:**
   - Enter the name for the single state

5. **Advanced Options:**
   - "Generate transitions between states" - creates click-based transitions

**Generating:**

1. Click "Generate" to start processing
2. Results show:
   - Number of states created
   - Total state images
   - Number of transitions
   - Any ungrouped templates
   - Processing time

### Importing to Project

After generation, import the configuration into your project.

**Import Options:**

1. **Download**: Export as JSON file for manual editing or backup

2. **Import to Project**: Merge into your project's configuration
   - Opens existing project configuration
   - Merges states and transitions
   - Preserves existing configuration
   - Shows success confirmation

**After Import:**

- Navigate to your project's state machine editor to see the results
- States appear with their assigned images
- Transitions connect states based on click actions
- You can further edit, add conditions, or refine the automation

---

## Application Profiles

Application profiles store optimized detection settings for specific applications.

### What are Application Profiles?

Profiles contain:

- Preferred detection strategies
- Tuned threshold parameters
- Average element sizes for the application
- Color range overrides
- Success rate metrics

### How Auto-Tuning Works

1. **Collect Samples**: The system analyzes your approved templates
2. **Test Strategies**: Different detection strategies are evaluated
3. **Measure Accuracy**: Boundary accuracy is calculated
4. **Optimize Parameters**: Thresholds are adjusted for best results
5. **Save Configuration**: Optimal settings are stored in the profile

### Creating and Managing Profiles

**Creating a Profile:**

1. Go to the "App Profiles" tab
2. Click "New Profile"
3. Enter the application name
4. Optionally select preferred detection strategies
5. Click "Create"

**Editing a Profile:**

- Click the settings icon on a profile card
- Modify preferred strategies
- View tuning metrics (if tuned)
- Save changes

**Triggering Auto-Tune:**

1. Click the magic wand icon on a profile
2. Click "Start Tuning"
3. Wait for analysis to complete
4. Review recommended strategies
5. Results are automatically applied to the profile

### When to Use Profiles

Create a profile when:

- Automating an application you will return to frequently
- Detection accuracy varies between applications
- You want consistent results across capture sessions
- Specific strategies work better for your target application

---

## Tips and Best Practices

### Capture Tips

1. **Capture multiple examples** of buttons in different states (normal, hover, pressed)

2. **Use consistent click positioning** - aim for element centers

3. **Avoid captures during animations** - wait for UI to settle

4. **Capture in representative conditions** - same resolution, same theme settings

5. **Keep capture sessions focused** - one workflow or screen at a time

### Review Tips

1. **Review low-confidence candidates carefully** - they may need boundary adjustment

2. **Check element types** - verify button vs icon vs panel classification

3. **Use bulk operations** for efficiency when many candidates are similar

4. **Reject obvious false positives** immediately to keep your workspace clean

### State Hint Tips

1. **Be consistent with naming** - use the same hint for related elements

2. **Think in screens** - group by what appears together

3. **Keep hints descriptive** - "Main Menu" is better than "State 1"

4. **Plan for transitions** - hints should reflect navigation structure

### Generation Tips

1. **Choose the right grouping method** for your use case

2. **Start with State Hints** if you have organized your templates

3. **Use Co-Occurrence** when analyzing complex capture videos

4. **Review generated transitions** - they may need manual refinement

5. **Test the generated config** before using in production automation

---

## Troubleshooting

### Common Issues

#### "Runner Offline" Status

**Problem**: Cannot start capture session

**Solutions**:
- Start the Qontinui Runner desktop application
- Check if the runner is running on the correct port (9876)
- Restart the runner if it becomes unresponsive
- Verify network connectivity between web app and runner

#### No Candidates Detected

**Problem**: Capture session produces zero candidates

**Solutions**:
- Ensure you clicked on visible UI elements during capture
- Check that clicks were single-clicks, not drags
- Verify the target application was in focus
- Try a longer capture session with more clicks
- Check the runner logs for errors

#### Poor Boundary Detection

**Problem**: Detected boundaries are too small, too large, or misaligned

**Solutions**:
- Use the Boundary Adjustment Editor to manually correct
- Try alternative boundaries shown in the editor
- Create an application profile and run auto-tuning
- Click in the center of elements, not edges
- Ensure good contrast between element and background

#### State Hints Method Shows Warning

**Problem**: "No state hints have been assigned"

**Solutions**:
- Go back to the Review tab
- Select templates and click "Set State Hint"
- Assign hints to all templates you want to include
- Alternatively, choose a different grouping method

#### Co-Occurrence Method Not Available

**Problem**: "Co-occurrence analysis requires the original video file"

**Solutions**:
- This method requires the capture video
- If video is unavailable, use State Hints or another method
- Future captures will save video if enabled

#### Import Fails

**Problem**: "Failed to import to project"

**Solutions**:
- Check that you have an active project selected
- Verify you have permission to edit the project
- Check the browser console for detailed error messages
- Try downloading the JSON and importing manually

### Improving Detection Accuracy

1. **Create an Application Profile** and run auto-tuning

2. **Select appropriate detection strategies**:
   - `contour` - Best for solid-colored elements with clear borders
   - `edge` - Works well with elements that have distinct edges
   - `color_segmentation` - Good for elements with consistent colors
   - `flood_fill` - Effective for connected regions
   - `gradient` - Useful for elements with smooth color transitions

3. **Capture in optimal conditions**:
   - Consistent lighting/colors
   - High contrast UI themes
   - Standard zoom/DPI settings

4. **Provide feedback through approvals and rejections** - this improves profile tuning

### Getting Help

If you encounter issues not covered here:

1. Check the runner logs in `.dev-logs/runner-general.jsonl`
2. Review backend logs in `.dev-logs/backend.log`
3. Open an issue on the Qontinui repository with:
   - Steps to reproduce
   - Screenshots of the issue
   - Relevant log excerpts
