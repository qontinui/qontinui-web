# Multi-Level Architecture Navigation

## Overview

The architecture page now supports multi-level navigation, allowing users to drill down into individual components to view their internal architecture.

## Features

### 1. Breadcrumb Navigation

- Located at the top of the page
- Shows the current navigation path
- Clickable breadcrumbs allow quick navigation back to parent levels
- Automatically updates based on current level

### 2. Drill-Down Functionality

- Components with sub-architectures show a drill-down indicator (⤵)
- **Double-click** on any component with the indicator to navigate into its architecture
- Currently implemented for:
  - qontinui-web (shows Frontend, State Builder, Element Annotator, Mock Executor, and Backend)
  - Other components marked for future expansion

### 3. Component Interactions

- **Single click**: View detailed component information in the side panel
- **Double-click**: Navigate into component's architecture (if available)
- **Hover**: See quick tooltips with hints about available interactions

### 4. Visual Indicators

- Components with drill-down capability show a ⤵ icon in the top-right corner
- Hover tooltips indicate "Double-click to drill down" for interactive components
- Breadcrumbs highlight the current level

## Architecture Levels

### Root Level

Shows the complete Qontinui ecosystem:

- MultiState (library)
- Qontinui (library)
- Qontinui Runner (application)
- Qontinui Web (application)
- Qontinui API (service)

### Qontinui Web Level

Shows the internal architecture of Qontinui Web:

- Next.js Frontend (frontend framework)
- State Builder (component)
- Element Annotator (component)
- Mock Executor (component)
- FastAPI Backend (with drill-down to API level)

## Implementation Details

### Files Modified

1. `frontend/src/app/(app)/admin/architecture/page.tsx`
   - Added `ArchitectureLevel` type
   - Added `currentLevel` state management
   - Implemented breadcrumb navigation
   - Added drill-down handlers

2. `frontend/src/components/admin/architecture/ArchitectureDiagram.tsx`
   - Extended component interface with `hasDrillDown` property
   - Created architecture maps for different levels
   - Implemented connection maps for different levels
   - Added double-click handlers for drill-down
   - Enhanced tooltips with drill-down hints

### Component Types

The diagram now supports additional component types:

- `frontend` - Frontend applications/frameworks
- `backend` - Backend services
- `component` - UI/feature components
- `ui` - UI-specific components
- `api` - API layers
- `database` - Database layers

## Future Enhancements

### Planned Sub-Architectures

1. **Qontinui API**
   - API Routes
   - Database Models
   - Services
   - Auth System
   - Task Queue (Celery)
   - Cache (Redis)

2. **Qontinui Runner**
   - React UI
   - Tauri Backend
   - Python Bridge
   - Automation Engine

3. **Qontinui Library**
   - JSON Executor
   - State Models
   - Transition Models
   - HAL (Hardware Abstraction Layer)
   - Vision Engine

4. **MultiState Library**
   - StateManager
   - State
   - StateGroup
   - Transition
   - Pathfinder

## Usage Tips

1. Start at the root level to see the overall ecosystem
2. Double-click on "Qontinui Web" to see its internal architecture
3. Use breadcrumbs to navigate back to the root level
4. Single-click components to view detailed information
5. Look for the ⤵ icon to identify components with sub-architectures

## Technical Notes

- The architecture data is stored in component arrays mapped by level
- Connections are also mapped by level to show relationships within each architecture
- The current implementation uses static data; future versions could load this from an API
- Type safety is maintained through TypeScript interfaces
