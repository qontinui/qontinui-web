# Image Library Organization

Comprehensive guide for organizing and managing images in large automation projects (100+ images).

## Table of Contents

- [Organization Principles](#organization-principles)
- [Naming Conventions](#naming-conventions)
- [Tagging Strategies](#tagging-strategies)
- [Collections and Groups](#collections-and-groups)
- [Search Strategies](#search-strategies)
- [Bulk Operations](#bulk-operations)
- [Maintenance Workflows](#maintenance-workflows)
- [Examples](#examples)

## Organization Principles

### Core Principles

1. **Consistency**: Use consistent naming and organization patterns
2. **Discoverability**: Make images easy to find through names and metadata
3. **Maintainability**: Regular cleanup and optimization
4. **Scalability**: Organization system that works at any scale

### Organization Layers

Images can be organized using multiple complementary strategies:

1. **Naming Conventions**: Hierarchical, descriptive names
2. **Source Tracking**: Automatic categorization by creation method
3. **Usage Tracking**: Organization by where images are used
4. **Metadata**: Additional descriptive information

## Naming Conventions

### Hierarchical Naming

Use prefixes to create virtual folders:

```
Format: <feature>-<element>-<state>-<variant>

Examples:
auth/login-button-primary-normal
auth/login-button-primary-hover
auth/login-button-primary-disabled
auth/login-input-email-empty
auth/login-input-email-filled
auth/login-input-email-error

dashboard/widget-header-background
dashboard/widget-chart-icon
dashboard/navigation-menu-expanded
dashboard/navigation-menu-collapsed
```

### Component-Based Naming

Organize by UI components:

```
<component>-<part>-<state>

Examples:
button-submit-normal
button-submit-hover
button-submit-pressed
button-submit-disabled

card-header-shadow
card-body-background
card-footer-border

modal-overlay-dim
modal-container-shadow
modal-close-icon
```

### State-Based Naming

Include visual state in names:

```
<element>-<state>

States:
- normal (default)
- hover
- active/pressed
- disabled
- focus
- error
- success
- loading

Examples:
checkout-button-normal
checkout-button-hover
checkout-button-disabled

form-input-normal
form-input-focus
form-input-error
form-input-success
```

### Resolution/Size Variants

For multi-resolution support:

```
<element>-<resolution>

Examples:
logo-1x (normal)
logo-2x (retina)
logo-3x (high DPI)

icon-sm (16x16)
icon-md (24x24)
icon-lg (32x32)
```

### Naming Best Practices

**DO:**
- Use lowercase with hyphens: `login-button-hover`
- Be descriptive: `navigation-menu-icon-home`
- Include state/variant: `button-submit-disabled`
- Use consistent prefixes: `auth-*`, `dashboard-*`

**DON'T:**
- Use spaces: `login button`
- Use numbers only: `img1`, `button2`
- Be vague: `temp`, `test`, `screenshot`
- Mix naming styles: `LoginButton`, `login_button`, `login-button`

## Tagging Strategies

### Conceptual Tags

While the current implementation uses naming conventions, a tagging system would work as follows:

#### Feature Tags

Group images by application feature:

```typescript
// Conceptual tagging structure
tags: ['authentication', 'login']
tags: ['dashboard', 'analytics']
tags: ['settings', 'profile']
tags: ['checkout', 'payment']
```

#### Type Tags

Categorize by element type:

```typescript
tags: ['button']
tags: ['icon']
tags: ['background']
tags: ['text']
tags: ['form-field']
tags: ['navigation']
```

#### State Tags

Mark visual states:

```typescript
tags: ['interactive']
tags: ['disabled']
tags: ['error-state']
tags: ['success-state']
```

#### Implementation Tags

Track technical details:

```typescript
tags: ['animated']
tags: ['responsive']
tags: ['high-dpi']
tags: ['masked']
```

### Tag Naming Conventions

Use consistent, hierarchical tags:

```
<category>:<value>

Examples:
feature:login
feature:dashboard
type:button
type:icon
state:hover
state:disabled
priority:critical
priority:optional
```

## Collections and Groups

### Virtual Collections via Naming

Create collections through consistent prefixing:

```
// Login collection
login-*

// Button collection
*-button-*

// Error state collection
*-error*

// Dashboard collection
dashboard-*
```

### Search-Based Collections

Use search queries to create dynamic collections:

```typescript
// All button images
search: "button"

// All hover states
search: "hover"

// All authentication images
search: "auth"

// All error states
search: "error"
```

### Usage-Based Collections

Group by usage patterns:

```typescript
// Images used in login state
images.filter(img =>
  img.usage?.some(u =>
    u.type === 'state' && u.name.includes('Login')
  )
)

// Shared images (used in multiple places)
images.filter(img => img.usageCount > 1)

// Unused images
images.filter(img => img.usageCount === 0)
```

### Source-Based Collections

Organize by creation source:

```typescript
// Pattern-optimized images
source: 'pattern_optimization'

// Manually uploaded images
source: 'uploaded'

// Auto-discovered images
source: 'state_discovery'
```

## Search Strategies

### Basic Search

Simple name-based search:

```
// Find specific element
"login-button"

// Find category
"dashboard"

// Find state
"hover"
```

### Advanced Search Patterns

Use multiple search terms strategically:

```
// Progressive refinement
1. Search: "button"          (100 results)
2. Search: "button submit"   (20 results)
3. Search: "button submit hover" (5 results)

// Category + state
"login error"     // Error states in login
"dashboard icon"  // Icons on dashboard
"button disabled" // Disabled buttons
```

### Search by Usage

Find images based on usage:

```typescript
// High usage (shared resources)
usageCount >= 10

// Low usage (specific resources)
usageCount == 1

// Unused (cleanup candidates)
usageCount == 0
```

### Search by Date

Find recent or old images:

```typescript
// Recently added (last 7 days)
createdAt >= Date.now() - 7 * 24 * 60 * 60 * 1000

// Old unused images (30+ days, unused)
createdAt < Date.now() - 30 * 24 * 60 * 60 * 1000 &&
usageCount == 0
```

## Bulk Operations

### Conceptual Bulk Operations

For managing large image sets efficiently:

#### Bulk Renaming

```typescript
// Rename with prefix
images
  .filter(img => img.name.startsWith('old-'))
  .forEach(img => {
    updateImage(img.id, {
      name: img.name.replace('old-', 'auth-')
    });
  });
```

#### Bulk Deletion

```typescript
// Delete unused images older than 30 days
const oldUnusedImages = images.filter(img => {
  const age = Date.now() - img.createdAt.getTime();
  const daysOld = age / (1000 * 60 * 60 * 24);
  return img.usageCount === 0 && daysOld > 30;
});

// Review before deletion
console.log(`Found ${oldUnusedImages.length} old unused images`);
// Then delete
```

#### Bulk Export

```typescript
// Export images for backup
const imagesToExport = images.filter(img =>
  img.name.startsWith('auth-')
);

// Export metadata
const exportData = imagesToExport.map(img => ({
  name: img.name,
  source: img.source,
  usageCount: img.usageCount,
  createdAt: img.createdAt
}));
```

### Manual Bulk Operations

Current workflow for bulk operations:

1. **Filter**: Use search/filters to identify target images
2. **Review**: Manually review the filtered list
3. **Action**: Perform action on each image
4. **Verify**: Confirm results

## Maintenance Workflows

### Daily Maintenance

**Quick Check (5 minutes):**
- Review newly added images
- Verify naming conventions
- Check for obvious duplicates

### Weekly Maintenance

**Organization Review (15 minutes):**

1. **Review New Images**
   ```typescript
   // Images added in last 7 days
   const newImages = images.filter(img => {
     const age = Date.now() - img.createdAt.getTime();
     return age < 7 * 24 * 60 * 60 * 1000;
   });
   ```

2. **Standardize Names**
   - Find images with poor names
   - Rename following conventions
   - Update related documentation

3. **Check for Duplicates**
   - Look for similar image names
   - Compare image content
   - Consolidate duplicates

### Monthly Maintenance

**Deep Clean (30-60 minutes):**

1. **Identify Unused Images**
   ```typescript
   const unused = images.filter(img => img.usageCount === 0);
   ```

2. **Review and Archive**
   - Determine if unused images are needed
   - Export important images for backup
   - Delete confirmed unused images

3. **Optimize Storage**
   - Find large images
   - Compress or crop if possible
   - Update references

4. **Usage Analysis**
   ```typescript
   // Find heavily used images
   const shared = images.filter(img => img.usageCount > 10);

   // Consider optimization for performance
   ```

### Quarterly Maintenance

**Full Audit (2-4 hours):**

1. **Naming Audit**
   - Review all image names
   - Standardize inconsistent names
   - Update naming documentation

2. **Usage Audit**
   - Verify all usage tracking is correct
   - Identify optimization opportunities
   - Document common usage patterns

3. **Organization Audit**
   - Review organization strategy
   - Adjust naming conventions if needed
   - Update team guidelines

4. **Performance Audit**
   - Check total image count and size
   - Identify large images
   - Plan optimization work

## Examples

### Example 1: Login Feature Organization

```
Images:
auth/login-background
auth/login-logo
auth/login-button-submit-normal
auth/login-button-submit-hover
auth/login-button-submit-disabled
auth/login-input-email-empty
auth/login-input-email-filled
auth/login-input-email-error
auth/login-input-password-empty
auth/login-input-password-filled
auth/login-link-forgot-password
auth/login-divider
auth/login-social-google
auth/login-social-facebook
```

**Benefits:**
- All login images start with `auth/login-`
- Easy to find all login-related images
- Clear hierarchy: feature → element → state
- Consistent naming makes automation easier

### Example 2: Dashboard Organization

```
Dashboard Images:
dashboard/header-background
dashboard/header-logo
dashboard/header-menu-icon
dashboard/header-profile-icon
dashboard/header-notification-icon

dashboard/sidebar-background
dashboard/sidebar-item-normal
dashboard/sidebar-item-hover
dashboard/sidebar-item-active

dashboard/widget-container
dashboard/widget-header
dashboard/widget-body
dashboard/widget-chart-line
dashboard/widget-chart-bar
dashboard/widget-chart-pie
```

**Benefits:**
- Clear component hierarchy
- Easy to find specific dashboard elements
- Scalable as dashboard grows
- Separates states clearly

### Example 3: Button Library

```
Buttons:
button-primary-normal
button-primary-hover
button-primary-active
button-primary-disabled

button-secondary-normal
button-secondary-hover
button-secondary-active
button-secondary-disabled

button-success-normal
button-success-hover

button-danger-normal
button-danger-hover

button-icon-close
button-icon-menu
button-icon-search
```

**Benefits:**
- Consistent structure for all button types
- All states captured
- Easy to find specific button variants
- Scalable for new button types

### Example 4: Multi-Resolution Assets

```
Assets:
logo-1x
logo-2x
logo-3x

icon-home-sm
icon-home-md
icon-home-lg

avatar-user-thumb
avatar-user-small
avatar-user-medium
avatar-user-large
```

**Benefits:**
- Clear size indicators
- Easy to find specific resolutions
- Consistent naming across all assets
- Supports responsive design

## Tools and Scripts

### Image Audit Script

```typescript
// Conceptual audit script
function auditImageLibrary(images: ImageAsset[]) {
  return {
    total: images.length,
    bySource: {
      uploaded: images.filter(img => img.source === 'uploaded').length,
      patterns: images.filter(img => img.source === 'pattern_optimization').length,
      extracted: images.filter(img => img.source === 'image_extraction').length,
      discovered: images.filter(img => img.source === 'state_discovery').length
    },
    usage: {
      unused: images.filter(img => img.usageCount === 0).length,
      lowUsage: images.filter(img => img.usageCount === 1).length,
      shared: images.filter(img => img.usageCount > 5).length,
      highlyShared: images.filter(img => img.usageCount > 10).length
    },
    size: {
      totalBytes: images.reduce((sum, img) => sum + img.size, 0),
      averageBytes: images.reduce((sum, img) => sum + img.size, 0) / images.length,
      largeImages: images.filter(img => img.size > 1024 * 1024).length // >1MB
    },
    naming: {
      wellNamed: images.filter(img => img.name.includes('-')).length,
      poorlyNamed: images.filter(img => !img.name.includes('-')).length
    }
  };
}
```

### Usage Report

```typescript
// Generate usage report
function generateUsageReport(images: ImageAsset[]) {
  return images.map(img => ({
    name: img.name,
    usage: img.usageCount,
    usedIn: img.usage?.map(u => `${u.type}:${u.name}`).join(', '),
    source: img.source,
    age: Math.floor(
      (Date.now() - img.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    )
  })).sort((a, b) => b.usage - a.usage);
}
```

### Cleanup Recommendations

```typescript
// Get cleanup recommendations
function getCleanupRecommendations(images: ImageAsset[]) {
  const recommendations = [];

  // Unused images older than 30 days
  const oldUnused = images.filter(img => {
    const age = (Date.now() - img.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    return img.usageCount === 0 && age > 30;
  });

  if (oldUnused.length > 0) {
    recommendations.push({
      type: 'DELETE',
      count: oldUnused.length,
      message: `${oldUnused.length} unused images older than 30 days`
    });
  }

  // Large images
  const large = images.filter(img => img.size > 1024 * 1024);
  if (large.length > 0) {
    recommendations.push({
      type: 'OPTIMIZE',
      count: large.length,
      message: `${large.length} images over 1MB should be optimized`
    });
  }

  // Poorly named images
  const poorNames = images.filter(img =>
    !img.name.includes('-') || img.name.length < 5
  );
  if (poorNames.length > 0) {
    recommendations.push({
      type: 'RENAME',
      count: poorNames.length,
      message: `${poorNames.length} images have poor naming`
    });
  }

  return recommendations;
}
```

## Related Documentation

- **[Image Library Overview](./README.md)** - Main image library guide
- **[State Builder](../state-builder/README.md)** - Using images in states
- **[Best Practices - Large Projects](../best-practices/large-projects.md)** - Overall organization
- **[Project Management](../project-management/README.md)** - Project-wide optimization

---

**Key Takeaways:**
- Use consistent, hierarchical naming conventions
- Organize using prefixes and search
- Perform regular maintenance (weekly/monthly)
- Track usage to identify cleanup opportunities
- Scale organization strategies as project grows
