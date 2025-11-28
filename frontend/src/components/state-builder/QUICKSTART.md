# Enhanced State Builder - Quick Start Guide

Get up and running with the Enhanced State Builder in 5 minutes.

## 1. Basic Setup (30 seconds)

### Add to Your Page

Create or edit a page file:

```tsx
// frontend/src/app/(app)/states/page.tsx
"use client";

import { EnhancedStateBuilder } from "@/components/state-builder";

export default function StatesPage() {
  return <EnhancedStateBuilder />;
}
```

That's it! The component will automatically:

- Connect to AutomationContext
- Load all states from the current project
- Provide full editing capabilities

## 2. Create Your First State (1 minute)

### From the UI

1. Click the **"New State"** button in the top right
2. Edit the name in the properties panel
3. Click **"Add Image"** to add a StateImage
4. Select an image from your library

### From a Template

1. Click **"From Template"** button
2. Choose "Login Form State" or "Basic Menu State"
3. Edit the generated state to fit your needs

## 3. Organize States (2 minutes)

### Search and Filter

```tsx
// Type in the search box
"login"; // Finds all states with "login" in name or description
```

### Multi-Select for Bulk Actions

1. Check the boxes next to multiple states
2. Click the count badge (e.g., "3 selected")
3. Choose an operation:
   - **Duplicate All** - Create copies
   - **Export All** - Download as JSON
   - **Delete All** - Remove (with confirmation)

## 4. Edit State Properties (1 minute)

### Overview Tab

- Edit name and description
- Mark as initial state
- View complexity score

### Images Tab

- Add/remove StateImages
- View pattern count
- See image previews

### Regions Tab

- Add regions for screen areas
- View region dimensions
- Edit region properties

### Locations Tab

- Add locations for click targets
- Set anchor and fixed flags
- View coordinates

## 5. Advanced Features (30 seconds)

### Validate States

```tsx
import { validateState } from "@/components/state-builder/state-utils";

const issues = validateState(myState);
// Returns array of validation issues
```

### Calculate Complexity

```tsx
import { calculateStateComplexity } from "@/components/state-builder/state-utils";

const score = calculateStateComplexity(myState);
// Returns numerical complexity score
```

### Compare States

```tsx
import { compareStates } from "@/components/state-builder/state-utils";

const comparison = compareStates(state1, state2);
console.log(`Similarity: ${comparison.similarity * 100}%`);
```

### Find Similar States

```tsx
import { findSimilarStates } from "@/components/state-builder/state-utils";

const similar = findSimilarStates(myState, allStates, 0.7);
// Returns states with >= 70% similarity
```

## Common Workflows

### Workflow 1: Create a Complete State

```
1. Click "New State"
2. Set name: "MainMenu"
3. Add description: "Main menu with play button"
4. Switch to "Images" tab
5. Click "Add" to add StateImage
6. Select image from library
7. Switch to "Regions" tab
8. Click "Add" to add region
9. Set region name: "PlayButton"
10. Done! State is auto-saved via AutomationContext
```

### Workflow 2: Bulk Export States

```
1. Check boxes for states to export
2. Click "[N] selected" badge
3. Click "Export All"
4. JSON file downloads automatically
```

### Workflow 3: Find and Fix Issues

```tsx
// In your code
const state = states[0];
const issues = validateState(state);

if (issues.length > 0) {
  console.log("Issues found:");
  issues.forEach((issue) => {
    console.log(`[${issue.type}] ${issue.message}`);
    if (issue.suggestion) {
      console.log(`  → ${issue.suggestion}`);
    }
  });
}
```

## Keyboard Shortcuts (Coming Soon)

| Shortcut | Action             |
| -------- | ------------------ |
| `Ctrl+N` | New state          |
| `Ctrl+F` | Focus search       |
| `Ctrl+A` | Select all         |
| `Delete` | Delete selected    |
| `Ctrl+D` | Duplicate selected |
| `Ctrl+E` | Export selected    |

## Tips & Tricks

### 1. Keep Complexity Low

- Aim for complexity score < 15
- Split complex states into multiple simpler ones
- Use regions and locations sparingly

### 2. Use Descriptive Names

```tsx
// Good
name: "LoginScreen_SubmitButton_Highlighted";

// Bad
name: "State1";
```

### 3. Validate Before Publishing

```tsx
const issues = validateState(state);
const errors = issues.filter((i) => i.type === "error");

if (errors.length > 0) {
  console.error("Cannot publish - has errors");
  return;
}
```

### 4. Use Templates for Consistency

- Create states from templates when possible
- Add your own templates for common patterns
- Templates ensure consistency across your project

### 5. Regular Exports

- Export states regularly as backup
- Use JSON format for easy version control
- Include date in export filename

## Troubleshooting

### States Not Showing

**Problem**: State list is empty

**Solutions**:

1. Check AutomationContext is initialized
2. Verify project has states
3. Clear search filters
4. Check browser console for errors

### Can't Edit State

**Problem**: Changes don't save

**Solutions**:

1. Check state is selected (highlighted in list)
2. Verify AutomationContext has `updateState` method
3. Check browser console for errors
4. Try refreshing the page

### Performance Issues

**Problem**: UI is slow with many states

**Solutions**:

1. Use search to narrow results
2. Apply filters to reduce visible states
3. Clear browser cache
4. Try in Chrome (best performance)

### Images Not Displaying

**Problem**: StateImage thumbnails are blank

**Solutions**:

1. Verify image exists in library
2. Check pattern has `imageId` set
3. Ensure `getImageById` returns valid image
4. Check browser console for 404 errors

## Next Steps

### Learn More

- Read the full [README.md](./README.md) for detailed documentation
- Check [USAGE_EXAMPLE.md](./USAGE_EXAMPLE.md) for code examples
- Review [types.ts](./types.ts) for all available types

### Extend the Component

1. Add custom filters
2. Create custom templates
3. Add new property tabs
4. Implement graph visualization
5. Add your own bulk operations

### Contribute

Found a bug or have an enhancement?

1. Check existing issues
2. Create a new issue with details
3. Submit a pull request

## Getting Help

### Documentation

- [README.md](./README.md) - Full documentation
- [USAGE_EXAMPLE.md](./USAGE_EXAMPLE.md) - Code examples
- [COMPONENT_SUMMARY.md](./COMPONENT_SUMMARY.md) - Overview

### Code Reference

- [EnhancedStateBuilder.tsx](./EnhancedStateBuilder.tsx) - Main component
- [types.ts](./types.ts) - TypeScript types
- [state-utils.ts](./state-utils.ts) - Helper functions

### Support

- Check browser console for errors
- Review AutomationContext setup
- Verify all dependencies installed
- Test with simple state first

---

**You're all set!** Start building amazing state machines with the Enhanced State Builder. 🚀
