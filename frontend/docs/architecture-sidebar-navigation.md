# Architecture Sidebar Navigation

## Overview

The Architecture section in the Admin sidebar now has nested navigation items for easy access to different architecture views.

## Sidebar Structure

```
Admin
├── Dashboard
├── Annotations
├── GUI Analysis
├── Region Analysis
├── Architecture
│   ├── Qontinui Overall  → /admin/architecture
│   └── Screenshots       → /admin/architecture?view=screenshots
└── Mobile Admin
```

## Navigation Paths

### Qontinui Overall
- **Route:** `/admin/architecture`
- **Icon:** Layers
- **View:** Root ecosystem architecture with drill-down capability
- **Shows:**
  - MultiState library
  - Qontinui library
  - Qontinui Runner application
  - Qontinui Web application
  - Qontinui API service

### Screenshots
- **Route:** `/admin/architecture?view=screenshots`
- **Icon:** Camera
- **View:** Screenshot infrastructure architecture
- **Shows:**
  - Upload methods (Manual, WebSocket)
  - Storage layers (IndexedDB, S3/MinIO, PostgreSQL)
  - Processing components (Annotations, State Discovery, etc.)

## Usage

### From Sidebar
1. Navigate to Admin section
2. Expand "Architecture" item (click the chevron)
3. Select either:
   - "Qontinui Overall" for ecosystem view
   - "Screenshots" for screenshot infrastructure

### Direct URL Access
- Ecosystem: `https://your-domain.com/admin/architecture`
- Screenshots: `https://your-domain.com/admin/architecture?view=screenshots`

### In-Page Navigation
- Use the "📸 Screenshots" button in the top-right
- Use breadcrumbs to navigate between levels
- Click on drillable components (marked with ⤵) to go deeper

## Implementation Details

### Sidebar Configuration
**File:** `src/components/navigation/unified-sidebar.tsx`

The Architecture item now has nested children:

```typescript
{
  id: 'admin-architecture',
  label: 'Architecture',
  icon: <Network size={22} />,
  route: '/admin/architecture',
  color: '#FF6B6B',
  adminOnly: true,
  children: [
    {
      id: 'admin-architecture-overall',
      label: 'Qontinui Overall',
      icon: <Layers size={18} />,
      route: '/admin/architecture',
      color: '#FF6B6B',
      adminOnly: true,
    },
    {
      id: 'admin-architecture-screenshots',
      label: 'Screenshots',
      icon: <Camera size={18} />,
      route: '/admin/architecture?view=screenshots',
      color: '#FF6B6B',
      adminOnly: true,
    },
  ],
}
```

### Query Parameter Handling
**File:** `src/app/(app)/admin/architecture/page.tsx`

The page automatically detects the `view` query parameter:

```typescript
const searchParams = useSearchParams()

useEffect(() => {
  const view = searchParams.get('view')
  if (view === 'screenshots') {
    setCurrentLevel('screenshots')
  }
}, [searchParams])
```

This ensures that clicking "Screenshots" in the sidebar automatically loads the screenshot architecture view.

## Features

### Nested Navigation
- Parent item shows expandable indicator (chevron icon)
- Click parent to navigate to default view
- Click chevron to expand/collapse children
- Click child items for direct navigation

### Active State
- Current page is highlighted in the sidebar
- Parent item shows as active when child is selected
- Visual feedback for user's current location

### Admin-Only Access
- Both parent and children require admin privileges
- Non-admin users will not see the Architecture section
- Protected by authentication middleware

## Keyboard Navigation

The sidebar supports keyboard navigation:
- **Tab** - Move between items
- **Enter/Space** - Activate selected item
- **Arrow Up/Down** - Navigate through items
- **Arrow Right** - Expand nested menu
- **Arrow Left** - Collapse nested menu

## Mobile Behavior

On mobile devices:
- Sidebar collapses to icon-only view
- Nested items shown in popover menu
- Touch-friendly tap targets
- Swipe to open/close sidebar

## Future Enhancements

Potential additions:
- More architecture views (API, Runner, Libraries)
- Quick view switcher dropdown
- Recent views history
- Bookmarked architecture diagrams
- Search within architecture views
- Custom diagram creation

## Troubleshooting

### Nested Menu Not Expanding
- Check if JavaScript is enabled
- Verify no console errors
- Try refreshing the page

### Query Parameter Not Working
- Ensure URL is properly encoded
- Check for conflicting query parameters
- Verify searchParams hook is working

### Navigation Not Highlighting
- Check route matching logic
- Verify pathname extraction
- Review active state conditions

## Related Documentation

- [Multi-Level Architecture Navigation](./architecture-multi-level-navigation.md)
- [Screenshot Infrastructure Guide](./screenshot-infrastructure-guide.md)
- [Screenshot Architecture Implementation](./screenshot-architecture-implementation-summary.md)
