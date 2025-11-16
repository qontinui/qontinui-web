# State Organization

Comprehensive guide for organizing and managing states in large automation projects with 50+ states.

## Table of Contents

- [Organization Principles](#organization-principles)
- [Naming Conventions](#naming-conventions)
- [State Grouping](#state-grouping)
- [Visual Organization](#visual-organization)
- [Search and Navigation](#search-and-navigation)
- [Dependency Management](#dependency-management)
- [Maintenance Workflows](#maintenance-workflows)
- [Examples](#examples)

## Organization Principles

### Core Principles

1. **Hierarchical Naming**: Use prefixes to create logical groups
2. **Consistent Patterns**: Apply naming consistently across project
3. **Discoverability**: Make states easy to find
4. **Scalability**: System that works from 5 to 500+ states
5. **Maintainability**: Regular cleanup and optimization

### Organization Layers

States can be organized using multiple strategies:

1. **Naming Conventions**: Hierarchical prefixes
2. **Visual Layout**: Canvas positioning
3. **Transitions**: Relationship mapping
4. **Documentation**: External organization system

## Naming Conventions

### Hierarchical Naming

Use prefixes to create virtual folders:

```
Format: <feature>-<screen>-<variant>

Examples:
auth-login
auth-signup
auth-reset-password
auth-verify-email
auth-two-factor

dashboard-home
dashboard-analytics
dashboard-reports
dashboard-settings

checkout-cart
checkout-shipping
checkout-payment
checkout-review
checkout-confirmation
```

### Feature-Based Organization

Group by application feature:

```
User Management:
users-list
users-detail
users-create
users-edit
users-delete-confirm

Product Catalog:
products-list
products-grid
products-detail
products-create
products-edit
```

### Screen Type Organization

Organize by screen pattern:

```
Lists:
list-users
list-products
list-orders
list-customers

Details:
detail-user
detail-product
detail-order
detail-customer

Forms:
form-user-create
form-user-edit
form-product-create
form-product-edit
```

### State Type Organization

Categorize by purpose:

```
Primary Screens:
main-dashboard
main-profile
main-settings

Dialogs:
dialog-confirm-delete
dialog-error-network
dialog-success-saved

Overlays:
overlay-loading
overlay-menu
overlay-notification

Error States:
error-404
error-500
error-network
error-auth
```

### Naming Best Practices

**DO:**
- Use lowercase with hyphens: `user-profile`
- Be descriptive: `checkout-payment-credit-card`
- Use consistent prefixes: `auth-*`, `admin-*`
- Include context: `dashboard-analytics-monthly`

**DON'T:**
- Use spaces: `user profile`
- Use camelCase: `userProfile`
- Use numbers only: `state1`, `screen2`
- Be vague: `page`, `screen`, `temp`

## State Grouping

### Virtual Groups via Naming

Create logical groups through consistent prefixing:

```typescript
// Authentication group
const authStates = states.filter(s =>
  s.name.startsWith('auth-')
);

// Dashboard group
const dashboardStates = states.filter(s =>
  s.name.startsWith('dashboard-')
);

// All forms
const formStates = states.filter(s =>
  s.name.includes('form-')
);
```

### Feature-Based Groups

Organize by application feature:

```
E-commerce Features:

┌─ Product Discovery
│  ├─ products-search
│  ├─ products-list
│  ├─ products-grid
│  └─ products-filter
│
┌─ Product Details
│  ├─ product-detail
│  ├─ product-reviews
│  └─ product-related
│
┌─ Shopping Cart
│  ├─ cart-empty
│  ├─ cart-items
│  └─ cart-summary
│
└─ Checkout Flow
   ├─ checkout-cart
   ├─ checkout-shipping
   ├─ checkout-payment
   └─ checkout-confirmation
```

### Workflow-Based Groups

Group states by user workflow:

```
User Registration Workflow:
1. signup-start
2. signup-email
3. signup-password
4. signup-profile
5. signup-verify
6. signup-complete

Order Processing Workflow:
1. order-cart
2. order-shipping
3. order-payment
4. order-review
5. order-processing
6. order-confirmation
```

### Conceptual State Groups

While not yet implemented, conceptual grouping structure:

```typescript
interface StateGroup {
  id: string;
  name: string;
  description: string;
  stateIds: string[];
  color?: string;
  icon?: string;
  collapsed?: boolean;
}

// Example groups
const groups: StateGroup[] = [
  {
    id: "auth",
    name: "Authentication",
    description: "Login, signup, password reset",
    stateIds: ["auth-login", "auth-signup", "auth-reset"],
    color: "blue"
  },
  {
    id: "dashboard",
    name: "Dashboard",
    description: "Main dashboard screens",
    stateIds: ["dashboard-home", "dashboard-analytics"],
    color: "green"
  }
];
```

## Visual Organization

### Canvas Layout Strategies

#### Left-to-Right Flow

Arrange states in workflow order:

```
[Login] → [Dashboard] → [Profile] → [Settings]
```

Good for:
- Linear workflows
- Sequential processes
- Onboarding flows

#### Top-to-Bottom Hierarchy

Organize by importance/frequency:

```
Top:    [Dashboard] [Home] [Main]
Middle: [Feature1] [Feature2] [Feature3]
Bottom: [Settings] [Help] [Error States]
```

Good for:
- Feature hierarchy
- Priority-based organization
- Information architecture

#### Grid Layout

Organize in a grid by category:

```
┌─────────────┬─────────────┬─────────────┐
│  Auth       │  Dashboard  │  Profile    │
├─────────────┼─────────────┼─────────────┤
│  Products   │  Orders     │  Customers  │
├─────────────┼─────────────┼─────────────┤
│  Reports    │  Settings   │  Admin      │
└─────────────┴─────────────┴─────────────┘
```

Good for:
- Feature modules
- Equal-priority areas
- Large projects (50+ states)

#### Cluster Layout

Group related states visually:

```
      ┌─ signup ─┐
      │  verify  │
[auth]│  reset   │
      │  2fa     │
      └──────────┘

      ┌─ home ────┐
[dash]│ analytics │
      │  reports  │
      │  settings │
      └───────────┘
```

Good for:
- Feature grouping
- Complex relationships
- Modular applications

### Auto-Layout

Use automatic layout for clean organization:

1. **Hierarchical Layout**: Top-down tree structure
2. **Force-Directed**: Physics-based positioning
3. **Circular**: States in a circle
4. **Grid**: Organized grid pattern

```typescript
// Conceptual auto-layout
function autoLayout(states: State[], style: LayoutStyle) {
  switch (style) {
    case 'hierarchical':
      return hierarchicalLayout(states);
    case 'grid':
      return gridLayout(states);
    case 'circular':
      return circularLayout(states);
  }
}
```

### Color Coding

Use visual markers for categories:

```typescript
// Conceptual color coding
const colorMap = {
  'auth-*': 'blue',
  'dashboard-*': 'green',
  'admin-*': 'red',
  'error-*': 'orange',
  'dialog-*': 'purple'
};
```

## Search and Navigation

### Quick Search

Find states quickly by name:

```
Search: "login"
Results: auth-login, admin-login, user-login

Search: "dashboard"
Results: dashboard-home, dashboard-analytics, dashboard-settings

Search: "error"
Results: error-404, error-network, error-auth
```

### Advanced Search

Filter by properties:

```typescript
// Conceptual advanced search
{
  name: "login",                    // Name contains
  hasImages: true,                  // Has StateImages
  hasStrings: true,                 // Has StateStrings
  isInitial: false,                 // Not initial state
  usedInWorkflows: ["checkout"],    // Used in workflows
  createdAfter: "2024-01-01"        // Created after date
}
```

### Navigation Shortcuts

Quick navigation between related states:

- **Follow Transitions**: Click transition to go to target state
- **Go to Usage**: Click workflow usage to navigate
- **Recent States**: List of recently edited states
- **Favorites**: Mark frequently accessed states

```typescript
// Conceptual navigation
interface NavigationHistory {
  recent: string[];        // Recently viewed state IDs
  favorites: string[];     // Favorited state IDs
  breadcrumbs: string[];   // Navigation path
}
```

## Dependency Management

### State Dependencies

Track which states depend on others:

```typescript
// Conceptual dependency tracking
interface StateDependencies {
  stateId: string;
  dependsOn: string[];      // States this depends on
  dependents: string[];     // States that depend on this
  workflows: string[];      // Workflows using this state
  transitions: {
    incoming: string[];     // Transitions into this state
    outgoing: string[];     // Transitions from this state
  };
}
```

### Finding Unused States

Identify states that can be removed:

```typescript
// States with no incoming transitions
const orphanStates = states.filter(state => {
  const hasIncoming = transitions.some(t =>
    t.type === 'OutgoingTransition' && t.toState === state.id
  );
  return !hasIncoming && !state.initial;
});

// States not used in any workflow
const unusedStates = states.filter(state => {
  const workflows = findWorkflowsUsingState(state.id);
  return workflows.length === 0;
});
```

### Circular Dependencies

Detect circular transition loops:

```typescript
// Conceptual circular dependency detection
function findCircularDependencies(states: State[]): string[][] {
  const cycles: string[][] = [];

  function dfs(stateId: string, visited: Set<string>, path: string[]) {
    if (visited.has(stateId)) {
      // Found cycle
      const cycleStart = path.indexOf(stateId);
      if (cycleStart >= 0) {
        cycles.push(path.slice(cycleStart));
      }
      return;
    }

    visited.add(stateId);
    path.push(stateId);

    const outgoing = getOutgoingTransitions(stateId);
    outgoing.forEach(transition => {
      if (transition.toState) {
        dfs(transition.toState, new Set(visited), [...path]);
      }
    });
  }

  states.forEach(state => {
    dfs(state.id, new Set(), []);
  });

  return cycles;
}
```

## Maintenance Workflows

### Daily Maintenance

**Quick Review (5 minutes):**

1. Check newly created states
2. Verify naming conventions
3. Review recent changes

```typescript
// Get today's new states
const newStates = states.filter(state => {
  const created = state.createdAt || new Date();
  const today = new Date();
  return created.toDateString() === today.toDateString();
});
```

### Weekly Maintenance

**Organization Review (15-30 minutes):**

1. **Review New States**
   - Verify consistent naming
   - Check StateImage configuration
   - Ensure proper transitions

2. **Clean Up Canvas**
   - Run auto-layout
   - Group related states
   - Remove clutter

3. **Update Documentation**
   - Document new state groups
   - Update state descriptions
   - Note important changes

### Monthly Maintenance

**Deep Clean (1-2 hours):**

1. **Naming Audit**
   ```typescript
   // Find poorly named states
   const poorlyNamed = states.filter(state =>
     !state.name.includes('-') ||
     state.name.length < 5 ||
     /\d+$/.test(state.name)  // Ends with number
   );
   ```

2. **Unused State Cleanup**
   ```typescript
   // Find and review unused states
   const unused = findUnusedStates(states, transitions, workflows);
   ```

3. **Duplicate Detection**
   ```typescript
   // Find potentially duplicate states
   const duplicates = findSimilarStates(states);
   ```

4. **Relationship Review**
   - Verify all transitions are valid
   - Check for orphaned states
   - Identify circular dependencies

### Quarterly Maintenance

**Full Audit (2-4 hours):**

1. **Complete Naming Standardization**
   - Review all state names
   - Apply consistent conventions
   - Update related documentation

2. **Reorganization**
   - Reassess grouping strategy
   - Update visual layout
   - Optimize state machine structure

3. **Performance Optimization**
   - Simplify complex states
   - Reduce StateImage count
   - Optimize search regions

4. **Documentation Update**
   - Update all state descriptions
   - Document state relationships
   - Create visual diagrams

## Examples

### Example 1: E-Commerce Organization

```
States organized by customer journey:

Discovery (15 states):
├─ home-landing
├─ products-search
├─ products-list-grid
├─ products-list-table
├─ products-filter
├─ products-sort
├─ product-detail
├─ product-reviews
├─ product-images
├─ product-description
├─ product-specs
├─ product-related
├─ product-recommendations
└─ product-compare

Shopping (8 states):
├─ cart-empty
├─ cart-items
├─ cart-summary
├─ cart-edit
├─ cart-apply-coupon
├─ wishlist-empty
├─ wishlist-items
└─ wishlist-move-to-cart

Checkout (6 states):
├─ checkout-cart
├─ checkout-shipping
├─ checkout-payment
├─ checkout-review
├─ checkout-processing
└─ checkout-confirmation

Account (12 states):
├─ account-login
├─ account-signup
├─ account-verify
├─ account-dashboard
├─ account-profile
├─ account-orders
├─ account-order-detail
├─ account-addresses
├─ account-payment-methods
├─ account-preferences
├─ account-security
└─ account-delete

Total: 41 states, organized in 4 groups
```

### Example 2: Admin Dashboard Organization

```
States organized by admin function:

Core (5 states):
├─ admin-login
├─ admin-dashboard
├─ admin-profile
├─ admin-settings
└─ admin-logout

User Management (8 states):
├─ admin-users-list
├─ admin-users-create
├─ admin-users-detail
├─ admin-users-edit
├─ admin-users-delete
├─ admin-users-permissions
├─ admin-users-roles
└─ admin-users-activity

Content Management (10 states):
├─ admin-content-posts
├─ admin-content-post-create
├─ admin-content-post-edit
├─ admin-content-pages
├─ admin-content-page-create
├─ admin-content-page-edit
├─ admin-content-media
├─ admin-content-categories
├─ admin-content-tags
└─ admin-content-comments

Analytics (6 states):
├─ admin-analytics-overview
├─ admin-analytics-users
├─ admin-analytics-content
├─ admin-analytics-performance
├─ admin-analytics-reports
└─ admin-analytics-export

System (4 states):
├─ admin-system-logs
├─ admin-system-backup
├─ admin-system-updates
└─ admin-system-maintenance

Total: 33 states, organized in 5 groups
```

### Example 3: Multi-App Organization

```
States for multiple related applications:

Public Site (15 states):
├─ public-home
├─ public-about
├─ public-features
├─ public-pricing
├─ public-contact
├─ public-blog
├─ public-blog-post
├─ public-docs
├─ public-doc-page
├─ public-support
├─ public-faq
├─ public-login
├─ public-signup
├─ public-reset-password
└─ public-verify-email

Customer App (25 states):
├─ app-dashboard
├─ app-projects
├─ app-project-detail
├─ [... 20 more states]
└─ app-settings

Admin Portal (18 states):
├─ admin-dashboard
├─ admin-users
├─ admin-analytics
├─ [... 13 more states]
└─ admin-system

Total: 58 states across 3 applications
```

## Tools and Scripts

### State Audit Report

```typescript
// Generate comprehensive state audit
function generateStateAudit(states: State[]) {
  return {
    total: states.length,
    byNamingConvention: {
      wellNamed: states.filter(s => s.name.includes('-')).length,
      poorlyNamed: states.filter(s => !s.name.includes('-')).length
    },
    byComponents: {
      withImages: states.filter(s => s.stateImages.length > 0).length,
      withRegions: states.filter(s => s.regions.length > 0).length,
      withLocations: states.filter(s => s.locations.length > 0).length,
      withStrings: states.filter(s => s.strings.length > 0).length,
      empty: states.filter(s =>
        s.stateImages.length === 0 &&
        s.regions.length === 0 &&
        s.locations.length === 0 &&
        s.strings.length === 0
      ).length
    },
    groups: extractStateGroups(states),
    orphans: findOrphanStates(states),
    duplicates: findDuplicateNames(states)
  };
}
```

### State Organization Recommendations

```typescript
// Get actionable recommendations
function getOrganizationRecommendations(states: State[]) {
  const recommendations = [];

  // Poorly named states
  const poorNames = states.filter(s =>
    !s.name.includes('-') || s.name.length < 5
  );
  if (poorNames.length > 0) {
    recommendations.push({
      type: 'NAMING',
      severity: 'HIGH',
      count: poorNames.length,
      message: `${poorNames.length} states have poor naming`,
      states: poorNames.map(s => s.name)
    });
  }

  // Empty states
  const empty = states.filter(s =>
    s.stateImages.length === 0 &&
    s.regions.length === 0
  );
  if (empty.length > 0) {
    recommendations.push({
      type: 'INCOMPLETE',
      severity: 'MEDIUM',
      count: empty.length,
      message: `${empty.length} states have no components`,
      states: empty.map(s => s.name)
    });
  }

  // Orphaned states
  const orphans = findOrphanStates(states);
  if (orphans.length > 0) {
    recommendations.push({
      type: 'ORPHANED',
      severity: 'MEDIUM',
      count: orphans.length,
      message: `${orphans.length} states have no transitions`,
      states: orphans.map(s => s.name)
    });
  }

  return recommendations;
}
```

## Related Documentation

- **[State Builder Overview](./README.md)** - Main state builder guide
- **[State Templates](./templates.md)** - Using templates
- **[Transitions](../transitions/README.md)** - Managing transitions
- **[Best Practices - Large Projects](../best-practices/large-projects.md)** - Overall strategies

---

**Key Takeaways:**
- Use hierarchical naming with consistent prefixes
- Organize visually on canvas for clarity
- Perform regular maintenance (weekly/monthly)
- Track dependencies and usage
- Scale organization strategies as project grows
- Document organization decisions for team
