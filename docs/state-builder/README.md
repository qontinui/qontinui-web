# State Builder

The State Builder is a visual tool for creating and managing application states in your automation project. It provides powerful features for handling projects with 50+ states efficiently.

## Table of Contents

- [Overview](#overview)
- [Key Concepts](#key-concepts)
- [Getting Started](#getting-started)
- [State Components](#state-components)
- [State Templates](#state-templates)
- [State Groups](#state-groups)
- [Transitions](#transitions)
- [Best Practices](#best-practices)
- [Related Documentation](#related-documentation)

## Overview

States represent distinct screens or conditions in your automation target application. The State Builder helps you model your application's structure visually using a node-based interface.

### Key Capabilities

- **Visual State Modeling**: Drag-and-drop interface for creating state machines
- **Rich State Components**: StateImages, Regions, Locations, and Strings
- **Auto-Layout**: Automatic graph layout for clarity
- **State Templates**: Reusable state patterns
- **Transition Management**: Define navigation between states
- **Usage Tracking**: Track which workflows use each state
- **Export/Import**: Share states across projects

## Key Concepts

### What is a State?

A **State** represents a distinct condition or screen in your application:

```typescript
interface State {
  id: string;              // Unique identifier
  name: string;            // Human-readable name
  description: string;     // What this state represents
  initial?: boolean;       // Is this the starting state?
  stateImages: StateImage[];    // Visual elements
  regions: StateRegion[];       // Areas of interest
  locations: StateLocation[];   // Specific points
  strings: StateString[];       // Text elements
  position: { x: number; y: number };  // Canvas position
}
```

**Examples of states:**
- Login Screen
- Dashboard
- Settings Page
- Error Dialog
- Loading State
- Confirmation Modal

### State Components

States are composed of four main component types:

1. **StateImages**: Visual elements to identify the state
2. **StateRegions**: Rectangular areas (search regions, UI sections)
3. **StateLocations**: Specific points (click targets, anchors)
4. **StateStrings**: Text content (labels, input values)

## Getting Started

### Creating Your First State

1. **Open State Builder**
   - Navigate to the "State Machine" tab
   - You'll see an empty canvas

2. **Add a New State**
   - Click the "Add State" button
   - A new state node appears on the canvas

3. **Configure the State**
   - Click the state node to select it
   - In the properties panel, set:
     - **Name**: "Login Screen"
     - **Description**: "Main login page"
     - **Initial**: Check if this is the starting state

4. **Add StateImages**
   - Click "Add StateImage" in the properties panel
   - Select an image from your Image Library
   - Configure pattern matching settings

5. **Position the State**
   - Drag the state node to position it
   - Use auto-layout for automatic organization

### Understanding the Canvas

The State Builder canvas shows:

- **State Nodes**: Blue rectangles representing states
- **Transition Nodes**: Connections between states
- **Edges**: Lines showing state relationships
- **Controls**: Zoom, pan, and fit view controls

### State Properties Panel

When a state is selected, the properties panel shows:

- **Basic Info**: Name, description, initial state flag
- **StateImages**: Visual identifiers
- **Regions**: Search regions and UI areas
- **Locations**: Click points and anchors
- **Strings**: Text elements
- **Usage**: Where this state is used

## State Components

### StateImages

Visual elements that identify the state:

```typescript
interface StateImage {
  id: string;
  name: string;
  patterns: Pattern[];     // Multiple visual variations
  shared: boolean;         // Also appears in other states
  searchRegions?: SearchRegion[];  // Where to look
  probability?: number;    // For mock testing
}
```

**Use StateImages for:**
- Unique UI elements that identify the state
- Buttons, icons, logos
- Background elements
- Navigation items

**Example:**
```typescript
{
  name: "Login Button",
  patterns: [
    {
      imageId: "login-button-normal",
      fixed: false,
      similarity: 0.95
    },
    {
      imageId: "login-button-hover",
      fixed: false,
      similarity: 0.95
    }
  ],
  shared: false
}
```

### StateRegions

Rectangular areas within the state:

```typescript
interface StateRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isSearchRegion?: boolean;   // Use as search constraint
  referenceImageId?: string;  // Position relative to image
  position?: Position;        // Relative position
  offsetX?: number;           // Pixel offset
  offsetY?: number;
}
```

**Use StateRegions for:**
- Search constraints (limit pattern matching area)
- UI sections (header, sidebar, content area)
- Dynamic content areas
- Relative positioning anchors

**Example:**
```typescript
{
  name: "Login Form Area",
  x: 100,
  y: 200,
  width: 400,
  height: 300,
  isSearchRegion: true
}
```

### StateLocations

Specific points within the state:

```typescript
interface StateLocation {
  id: string;
  name: string;
  x: number;
  y: number;
  fixed: boolean;             // Absolute vs. relative
  anchor: boolean;            // Is anchor point
  referenceImageId?: string;  // Position relative to image
  position?: Position;        // Relative position
  offsetX?: number;
  offsetY?: number;
}
```

**Use StateLocations for:**
- Click targets
- Anchor points for relative positioning
- Specific coordinates to monitor
- Reference points for measurements

**Example:**
```typescript
{
  name: "Submit Button Center",
  x: 300,
  y: 450,
  fixed: false,
  anchor: false,
  referenceImageId: "login-button",
  position: { percentW: 0.5, percentH: 0.5 }
}
```

### StateStrings

Text content within the state:

```typescript
interface StateString {
  id: string;
  name: string;
  value: string;
  identifier?: boolean;    // OCR verification
  inputText?: boolean;     // Text to type
  expectedText?: boolean;  // Validation text
  regexPattern?: boolean;  // Regex pattern
}
```

**Use StateStrings for:**
- Expected text to verify state
- Text to input (username, password)
- OCR validation
- Dynamic text patterns (regex)

**Example:**
```typescript
{
  name: "Username Input",
  value: "test@example.com",
  inputText: true
}
```

## State Templates

### What are State Templates?

State templates are reusable state patterns that can be quickly instantiated with customization.

### Built-in Templates

**Basic Screen Template:**
```typescript
{
  name: "Basic Screen",
  description: "Empty state with standard setup",
  stateImages: [],
  regions: [],
  locations: [],
  strings: []
}
```

**Login Screen Template:**
```typescript
{
  name: "Login Screen",
  description: "Standard login page",
  stateImages: [
    { name: "Logo", patterns: [] },
    { name: "Login Button", patterns: [] }
  ],
  regions: [
    { name: "Form Area", isSearchRegion: true }
  ],
  strings: [
    { name: "Username", inputText: true },
    { name: "Password", inputText: true }
  ]
}
```

**Dashboard Template:**
```typescript
{
  name: "Dashboard",
  description: "Application dashboard",
  regions: [
    { name: "Header", y: 0, height: 80 },
    { name: "Sidebar", x: 0, width: 250 },
    { name: "Content", x: 250, width: 950 }
  ]
}
```

### Creating Custom Templates

1. **Create a Model State**
   - Build a state with the desired structure
   - Include typical components

2. **Export as Template**
   ```typescript
   // Conceptual template creation
   const template = {
     name: "My Custom Template",
     description: "Describe the template",
     ...extractStateStructure(modelState)
   };
   ```

3. **Use Template**
   - Select "New State from Template"
   - Choose your custom template
   - Customize the instance

### Template Best Practices

See [State Templates Guide](./templates.md) for detailed information.

## State Groups

### Organizing States

For projects with 50+ states, organization is critical:

**Virtual Grouping with Naming:**
```
Format: <feature>-<screen>

Examples:
auth-login
auth-signup
auth-reset-password
auth-verify-email

dashboard-home
dashboard-analytics
dashboard-settings

checkout-cart
checkout-shipping
checkout-payment
checkout-confirmation
```

**Group Properties:**
```typescript
// Conceptual state groups
{
  name: "Authentication",
  states: ["auth-login", "auth-signup", "auth-reset-password"],
  color: "blue"
}
```

### Search and Filter

Find states quickly:

```
// By name prefix
search: "auth-"    // All auth states
search: "dashboard-"  // All dashboard states

// By component
hasImages: true    // States with images
hasStrings: true   // States with text
```

## Transitions

States are connected by transitions that define navigation:

### Outgoing Transitions

From current state to next state:

```typescript
interface OutgoingTransition {
  fromState: string;        // Source state ID
  toState?: string;         // Target state ID
  activateStates: string[]; // States to activate
  staysVisible: boolean;    // Source stays visible
  deactivateStates: string[]; // States to deactivate
  workflows: string[];      // Actions to execute
  timeout: number;
  retryCount: number;
}
```

### Incoming Transitions

Into a state from any source:

```typescript
interface IncomingTransition {
  toState: string;      // Target state ID
  workflows: string[];  // Actions to execute
  timeout: number;
  retryCount: number;
}
```

### Creating Transitions

See [Transitions Documentation](../transitions/README.md) for details.

## Best Practices

### Naming States

**Good Names:**
```
login-screen
dashboard-home
settings-profile
checkout-payment
error-dialog-network
```

**Bad Names:**
```
state1
screen
page
temp
```

### State Granularity

**Too Fine:**
```
login-username-field-empty
login-username-field-filled
login-password-field-empty
login-password-field-filled
```

**Too Coarse:**
```
application
main-screen
```

**Just Right:**
```
login-screen
dashboard
settings
```

### When to Create a New State

Create a new state when:
- **Distinct Visual Appearance**: Screen looks significantly different
- **Different Functionality**: User can do different things
- **Navigation Point**: Common navigation target
- **Error Condition**: Important error state to handle

Don't create a new state for:
- Minor visual changes (hover effects, animations)
- Temporary loading indicators
- Tooltip appearances
- Minor validation messages

### StateImage Guidelines

1. **Unique Identifiers**: Use images unique to the state
2. **Multiple Patterns**: Include variations (normal, hover, etc.)
3. **Appropriate Similarity**: 0.95+ for UI elements, 0.85+ for complex images
4. **Search Regions**: Constrain searches for performance
5. **Shared Flag**: Mark images that appear in multiple states

### Region Guidelines

1. **Meaningful Names**: Describe purpose clearly
2. **Search Regions**: Use to constrain image searches
3. **Relative Positioning**: Use for dynamic layouts
4. **Appropriate Size**: Not too small (hard to find) or too large (slow)

### Location Guidelines

1. **Use for Click Targets**: Define specific click points
2. **Anchor Points**: Mark reference points for relative positioning
3. **Fixed vs. Relative**: Use fixed sparingly (responsive issues)
4. **Descriptive Names**: Indicate purpose

### String Guidelines

1. **Flag Types Correctly**: identifier, inputText, expectedText
2. **Regex for Patterns**: Use for dynamic text
3. **Multiple Strings**: Capture all important text in state
4. **Validation**: Use expectedText to verify state

## Advanced Features

### Relative Positioning

Position components relative to StateImages:

```typescript
{
  name: "Click Below Logo",
  referenceImageId: "company-logo",
  position: {
    percentW: 0.5,   // Centered horizontally
    percentH: 1.0,   // Bottom of logo
  },
  offsetY: 20        // 20 pixels below
}
```

**Benefits:**
- Responsive to layout changes
- More maintainable
- Handles different screen sizes

### Mock Testing Support

StateImages can have probability values for simulation:

```typescript
{
  name: "Success Dialog",
  probability: 0.95  // 95% chance to appear in mock test
}
```

### Action History

Track automation actions performed on components:

```typescript
interface ActionHistory {
  snapshots: ActionSnapshot[];
  lastUpdated?: Date;
}
```

## Troubleshooting

### State Not Found

**Problem**: Automation can't find state
**Solutions:**
- Verify StateImages exist and are current
- Check similarity thresholds (try lowering)
- Add more StateImages for better identification
- Use search regions to constrain search

### Wrong State Detected

**Problem**: Wrong state is identified
**Solutions:**
- Make StateImages more unique
- Increase similarity threshold
- Add additional StateImages
- Use `shared: false` flag

### Performance Issues

**Problem**: State detection is slow
**Solutions:**
- Use search regions to constrain searches
- Reduce number of StateImages
- Optimize image sizes
- Use fixed positioning where appropriate

### Complex State Relationships

**Problem**: Hard to manage many states
**Solutions:**
- Use consistent naming conventions
- Group states by feature
- Use search/filter to find states
- Document state relationships
- Use auto-layout regularly

## Related Documentation

- **[State Templates](./templates.md)** - Template guide and reference
- **[State Organization](./organization.md)** - Organizing large state sets
- **[Transitions](../transitions/README.md)** - Managing transitions
- **[Image Library](../image-library/README.md)** - Managing images for states
- **[Best Practices](../best-practices/large-projects.md)** - Large project strategies

## Quick Reference

### Common Tasks

**Create State:**
1. Click "Add State"
2. Set name and description
3. Add StateImages from library
4. Define regions/locations as needed

**Add StateImage:**
1. Select state
2. Click "Add StateImage"
3. Select image from library
4. Configure pattern settings

**Find State:**
1. Use search box
2. Filter by name
3. Or click on canvas

**Delete State:**
1. Select state
2. Click delete button
3. Confirm (removes transitions too)

### Keyboard Shortcuts

- `Ctrl/Cmd + Click`: Multi-select states
- `Delete`: Delete selected state
- `F`: Fit view to all states
- `Ctrl/Cmd + F`: Search states
- `Ctrl/Cmd + D`: Duplicate state
- `Arrow Keys`: Nudge selected state

---

**Next Steps:**
- Learn about [State Templates](./templates.md)
- Read [Organization Strategies](./organization.md)
- Explore [Transition Management](../transitions/README.md)
- Review [Best Practices for Large Projects](../best-practices/large-projects.md)
