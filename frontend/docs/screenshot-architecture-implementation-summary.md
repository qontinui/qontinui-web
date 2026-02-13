# Screenshot Architecture Implementation Summary

## What Was Implemented

A comprehensive screenshot infrastructure visualization has been added to the admin architecture page. This provides an interactive guide showing:

1. **How screenshots are obtained** (manual upload vs WebSocket streaming)
2. **Where screenshots are stored** (IndexedDB, S3/MinIO, PostgreSQL)
3. **Storage differences** between manual and WebSocket uploads
4. **All operations** that can be performed with screenshots

## How to Access

**Navigation Path:**
1. Go to Admin Panel (`/admin`)
2. Click "Architecture" in the navigation
3. Click the "📸 Screenshots" button in the top-right corner

Or navigate directly to: `/admin/architecture` and click "Screenshots"

## Architecture Diagram Components

### Upload Methods (Top Layer)
- **Manual Upload** - User file selection and upload
- **Runner WebSocket** - Real-time streaming from qontinui-runner

### Storage Layer (Middle)
- **IndexedDB** - Browser local storage for offline access
- **S3/MinIO** - Cloud object storage for persistent files
- **PostgreSQL** - Metadata and associations database

### Usage/Processing (Bottom Layer)
- **Annotations** - Region and location marking
- **State Discovery** - Pattern extraction from screenshots
- **Mock Execution** - Test automation with screenshots
- **Export/Download** - JSON and Python code generation
- **CV Analysis** - Computer vision background processing

## Visual Data Flow

The diagram shows connections between all components:
- Solid lines = primary data flow
- Dashed lines = metadata/secondary flow
- Labels indicate the type of operation

### Example Flows

**Manual Upload Flow:**
```
Manual Upload → IndexedDB (store local)
             → S3/MinIO (upload)
             → PostgreSQL (metadata)
```

**WebSocket Upload Flow:**
```
Runner WebSocket → S3/MinIO (stream)
                → PostgreSQL (metadata)
```

**Usage Flow:**
```
IndexedDB → Annotations (load)
S3/MinIO → State Discovery (fetch)
        → Mock Execution (fetch)
        → CV Analysis (process)
PostgreSQL → Export/Download (query)
```

## Interactive Features

### Hover Interactions
- Hover over any component to see a tooltip with description
- Related components highlight when hovering
- Connection labels show data flow type

### Click Interactions
- Click on any component to see details (if available)
- Visual indicators show the current selection

### Navigation
- Breadcrumb trail shows current location
- Click breadcrumbs to navigate back
- "Screenshots" button in top-right for quick access

## Documentation

### Comprehensive Guide
A detailed guide is available at:
`frontend/docs/screenshot-infrastructure-guide.md`

This guide covers:
- Detailed explanation of each component
- Storage architecture and differences
- All screenshot operations
- Code locations and file paths
- API endpoints
- Common use cases
- Best practices
- Troubleshooting

### Quick Reference

**Key Files:**
- Upload: `src/components/ScreenshotTab/ScreenshotUploadTab.tsx`
- Annotations: `src/components/screenshot-annotation/ScreenshotAnnotationTab.tsx`
- Storage: `src/lib/screenshot-db.ts`
- WebSocket: `src/lib/runner-websocket.ts`
- Backend: `backend/app/api/v1/endpoints/images.py`

**Key Pages:**
- Upload: `/automation-builder/screenshots`
- Annotations: `/automation-builder/annotations`
- State Discovery: `/automation-builder/state-discovery`

## Implementation Details

### Files Modified

1. **page.tsx** - Architecture page
   - Added 'screenshots' to `ArchitectureLevel` type
   - Added screenshot button to navigation
   - Added title mapping for screenshot level

2. **ArchitectureDiagram.tsx** - Diagram component
   - Created `screenshotComponents` array with 10 components
   - Created `screenshotConnections` array with 11 connections
   - Added to architecture and connection maps
   - Extended component type support (ui, database, service)

3. **screenshot-infrastructure-guide.md** - Comprehensive documentation
   - Complete guide to screenshot infrastructure
   - All operations and use cases
   - Code references and API endpoints
   - Best practices and troubleshooting

4. **screenshot-architecture-implementation-summary.md** - This file
   - Quick reference for the implementation
   - How to access and use the feature

## Storage Architecture Summary

### Three-Tier System

**1. IndexedDB (Browser)**
- Purpose: Local caching and offline access
- Used by: Manual uploads
- Database: `qontinui-screenshots-db`
- Operations: CRUD with project filtering

**2. S3/MinIO (Cloud)**
- Purpose: Persistent cloud storage
- Used by: All uploads (manual + WebSocket)
- Features: Presigned URLs, validation, encryption
- Expiration: 7-day URL validity

**3. PostgreSQL (Metadata)**
- Purpose: Relational metadata and associations
- Stores: Project links, dimensions, automation context
- Indexed by: Project, upload date, tags

### Storage Differences

| Feature | Manual Upload | WebSocket Stream |
|---------|--------------|------------------|
| Local Storage | ✅ IndexedDB | ❌ None |
| Cloud Storage | ✅ S3/MinIO | ✅ S3/MinIO |
| Metadata | Basic | Rich (automation) |
| Access | Offline + Online | Online only |
| Use Case | State definition | Runtime monitoring |

## Component Breakdown

### 10 Components in the Diagram

1. **Manual Upload** - User-initiated file upload
2. **Runner WebSocket** - Real-time runner streaming
3. **IndexedDB** - Browser local storage
4. **S3/MinIO** - Cloud object storage
5. **PostgreSQL** - Metadata database
6. **Annotations** - Region/location marking tool
7. **State Discovery** - Pattern extraction service
8. **Mock Execution** - Test automation engine
9. **Export/Download** - JSON/Python exporter
10. **CV Analysis** - Computer vision processing

### 11 Connections Showing Data Flow

1. Manual Upload → IndexedDB
2. Manual Upload → S3/MinIO
3. Manual Upload → PostgreSQL
4. Runner WebSocket → S3/MinIO
5. Runner WebSocket → PostgreSQL
6. IndexedDB → Annotations
7. S3/MinIO → State Discovery
8. S3/MinIO → Mock Execution
9. PostgreSQL → Export/Download
10. S3/MinIO → CV Analysis
11. CV Analysis → PostgreSQL

## Usage Examples

### View Screenshot Architecture
1. Navigate to `/admin/architecture`
2. Click "📸 Screenshots" button
3. Explore the interactive diagram
4. Hover over components for details

### Understand Upload Flow
1. Look at "Manual Upload" component
2. Follow the connections to storage layers
3. See where data is stored (IndexedDB, S3, PostgreSQL)

### Trace Processing Flow
1. Start at storage layer (S3/MinIO)
2. Follow connections to processing components
3. See how screenshots are used in different features

### Find Code Locations
1. Click on a component to see details
2. Refer to the comprehensive guide
3. Look up file paths and code references

## Next Steps for Users

### To Learn More
1. Read `screenshot-infrastructure-guide.md` for complete details
2. Explore the interactive architecture diagram
3. Review code files referenced in the guide

### To Work with Screenshots
1. Upload: `/automation-builder/screenshots`
2. Annotate: `/automation-builder/annotations`
3. Discover States: `/automation-builder/state-discovery`
4. Monitor: Use Runner WebSocket connection

### To Extend Functionality
1. Review existing components in the diagram
2. Check code locations in the guide
3. Follow established patterns for storage and processing
4. Add new connections to the architecture as needed

## Benefits of This Implementation

1. **Comprehensive Visualization** - Shows entire screenshot infrastructure in one view
2. **Clear Data Flow** - Understand how screenshots move through the system
3. **Storage Clarity** - See differences between manual and WebSocket uploads
4. **Quick Reference** - Find components and code locations easily
5. **Educational** - Learn the architecture by exploring the diagram
6. **Maintainable** - Easy to update as the system evolves

## Future Enhancements

Potential additions to the screenshot architecture:
- Additional processing components (ML analysis, duplicate detection)
- More detailed storage metrics
- Performance optimization paths
- Caching strategies visualization
- Backup and recovery flows
- Integration with external services
