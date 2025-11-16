# Global Search

Comprehensive guide for using global search to quickly find and navigate resources across your automation project.

## Table of Contents

- [Overview](#overview)
- [Quick Search (Cmd+K)](#quick-search-cmdk)
- [Search Syntax](#search-syntax)
- [Search Operators](#search-operators)
- [Searching by Resource Type](#searching-by-resource-type)
- [Advanced Filters](#advanced-filters)
- [Quick Actions](#quick-actions)

## Overview

Global search provides instant access to any resource in your project, essential for projects with 100+ resources.

### Key Features

- **Universal Search**: Search across all resource types
- **Keyboard Shortcut**: Quick access with Cmd/Ctrl+K
- **Fuzzy Matching**: Find resources even with typos
- **Type Filtering**: Filter by resource type
- **Quick Actions**: Perform actions directly from search
- **Recent Items**: Access recently used resources

## Quick Search (Cmd+K)

### Opening Search

**Keyboard Shortcuts:**
- macOS: `Cmd + K`
- Windows/Linux: `Ctrl + K`

**Alternative:**
- Click search icon in header
- Use search box in any view

### Basic Search

Simply type to search across all resources:

```
// Find login-related resources
"login"

Results:
- State: auth-login
- Transition: trans-login-to-dashboard
- Workflow: workflow-submit-login
- Image: login-button-normal
- Image: login-background
```

### Fuzzy Matching

Search works with partial matches and typos:

```
// Search: "dashbrd"
Matches:
- State: dashboard-home
- State: dashboard-analytics
- Workflow: load-dashboard-data

// Search: "usr prof"
Matches:
- State: user-profile
- Workflow: update-user-profile
```

## Search Syntax

### Basic Syntax

```
<query> [type:<resource-type>] [filter:value]

Examples:
login                    // Find all resources with "login"
login type:state         // Find states with "login"
unused                   // Find unused resources
type:image size:large    // Find large images
```

### Search Modifiers

**Exact Match:**
```
"login screen"     // Exact phrase
```

**Prefix Match:**
```
auth-*             // All resources starting with "auth-"
```

**Exclude:**
```
dashboard -analytics    // Dashboard but not analytics
```

## Search Operators

### Type Operator

Filter by resource type:

```
type:image          // Only images
type:state          // Only states
type:transition     // Only transitions
type:workflow       // Only workflows
```

**Shorthand:**
```
i:logo             // Same as type:image logo
s:login            // Same as type:state login
t:login            // Same as type:transition login
w:submit           // Same as type:workflow submit
```

### Usage Operator

Filter by usage:

```
unused             // All unused resources
used               // All used resources
usage:>10          // Used more than 10 times
usage:<1           // Unused
usage:=0           // Exactly 0 usage
```

### Date Operator

Filter by creation/modification date:

```
created:today      // Created today
created:week       // Created this week
created:month      // Created this month
created:>30d       // Created more than 30 days ago

modified:today     // Modified today
modified:week      // Modified this week
```

### Size Operator

Filter by size (images only):

```
size:large         // > 1MB
size:medium        // 100KB - 1MB
size:small         // < 100KB
size:>500KB        // Larger than 500KB
```

### Source Operator

Filter images by source:

```
source:uploaded             // Manually uploaded
source:pattern_optimization // Pattern optimization
source:image_extraction     // Image extraction
source:state_discovery      // State discovery
```

## Searching by Resource Type

### Search Images

```
// All images
type:image

// Unused images
type:image unused

// Large images
type:image size:large

// Images from pattern optimization
type:image source:pattern_optimization

// Images created this week
type:image created:week
```

### Search States

```
// All states
type:state

// Authentication states
type:state auth

// States with no components
type:state empty

// Unreachable states
type:state unreachable

// States created recently
type:state created:week
```

### Search Transitions

```
// All transitions
type:transition

// Transitions from login
type:transition from:login

// Transitions to dashboard
type:transition to:dashboard

// Broken transitions
type:transition broken

// Transitions with specific workflow
type:transition workflow:submit-form
```

### Search Workflows

```
// All workflows
type:workflow

// Unused workflows
type:workflow unused

// Workflows in checkout
type:workflow checkout

// Complex workflows (many actions)
type:workflow complex

// Recently modified
type:workflow modified:week
```

## Advanced Filters

### Combining Filters

Use multiple filters together:

```
// Large unused images
type:image unused size:large

// Login states created this week
type:state login created:week

// Broken transitions
type:transition broken

// Recent auth resources
auth created:week
```

### Filter Examples

**Find cleanup candidates:**
```
unused created:>30d
```

**Find recent work:**
```
created:today
```

**Find specific feature:**
```
checkout type:state
```

**Find problems:**
```
broken
```

**Find large resources:**
```
type:image size:>1MB
```

## Quick Actions

### Actions from Search Results

When you find a resource, perform quick actions:

**Images:**
- View: See full image
- Edit: Rename image
- Delete: Remove image
- Usage: See where used

**States:**
- View: Open in state builder
- Edit: Modify properties
- Delete: Remove state
- Transitions: See all transitions

**Transitions:**
- View: See details
- Edit: Modify properties
- Delete: Remove transition
- Validate: Check for errors

**Workflows:**
- View: Open workflow
- Edit: Modify actions
- Delete: Remove workflow
- Execute: Test workflow

### Keyboard Shortcuts in Search

- `↑ ↓`: Navigate results
- `Enter`: Open selected resource
- `Cmd/Ctrl + Enter`: Open in new tab/window
- `Escape`: Close search
- `Tab`: Cycle through filters

## Search Tips

### Effective Searching

**Start Broad, Then Narrow:**
```
1. "button"           (500 results)
2. "button type:image" (200 results)
3. "button type:image unused" (15 results)
```

**Use Prefixes:**
```
// Find all auth resources
"auth-"

// Find all dashboard states
"dashboard-" type:state
```

**Search by Feature:**
```
// All checkout-related resources
"checkout"

// All login-related resources
"login" or "auth-"
```

**Find Problems:**
```
// Unused resources
"unused"

// Broken references
"broken"

// Large files
"size:large"
```

### Search Patterns

**Daily Use:**
```
// Recently modified
modified:today

// Recently created
created:today

// My recent work
author:me created:week
```

**Cleanup:**
```
// Old unused resources
unused created:>30d

// Large images
type:image size:>1MB

// Empty states
type:state empty
```

**Debugging:**
```
// Broken transitions
type:transition broken

// Unreachable states
type:state unreachable

// Missing workflows
type:workflow missing
```

## Search Results

### Result Display

```
┌─────────────────────────────────────────┐
│ Search: "login"                     ✕   │
├─────────────────────────────────────────┤
│ States (3)                              │
│ ○ auth-login                            │
│   Login screen with email/password      │
│                                         │
│ ○ admin-login                           │
│   Admin portal login                    │
│                                         │
│ Transitions (2)                         │
│ ○ trans-login-to-dashboard              │
│   From: auth-login → dashboard          │
│                                         │
│ Images (5)                              │
│ ○ login-button-normal                   │
│   120KB • Used in 3 states              │
│                                         │
│ Workflows (4)                           │
│ ○ workflow-submit-login                 │
│   5 actions • Used in 2 transitions     │
└─────────────────────────────────────────┘
```

### Result Information

Each result shows:
- **Name**: Resource name
- **Type**: Resource type icon/badge
- **Description**: Brief description
- **Metadata**: Size, usage, dates, etc.
- **Usage**: Where resource is used

### Result Ordering

Results ordered by:
1. Exact matches first
2. Recent items
3. Frequently used
4. Alphabetical

## Examples

### Example 1: Find Unused Resources

```
// Step 1: Search for unused
"unused"

// Step 2: Filter by type
"unused type:image"

// Step 3: Filter by age
"unused type:image created:>30d"

// Result: Old unused images ready for deletion
```

### Example 2: Find Feature Resources

```
// Find all checkout resources
"checkout"

// Results show:
- States: checkout-cart, checkout-payment, etc.
- Transitions: Between checkout states
- Workflows: Checkout actions
- Images: Checkout UI elements
```

### Example 3: Debug Broken References

```
// Find broken transitions
"type:transition broken"

// Results show:
- Transitions with deleted states
- Transitions with missing workflows
- Invalid state references
```

### Example 4: Audit Recent Changes

```
// See what changed today
"modified:today"

// Filter to specific type
"modified:today type:state"

// See who made changes
"modified:today author:john"
```

## Related Documentation

- **[Project Management](./README.md)** - Project overview
- **[Optimization](./optimization.md)** - Finding and fixing issues
- **[Best Practices](../best-practices/large-projects.md)** - Search strategies

---

**Key Takeaways:**
- Use Cmd/Ctrl+K for quick search
- Combine filters to narrow results
- Use search for daily navigation
- Find problems with specific queries
- Learn keyboard shortcuts for efficiency
