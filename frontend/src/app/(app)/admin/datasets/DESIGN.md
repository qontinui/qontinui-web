# Dataset Viewer Design Document

## Overview

The Dataset Viewer is a web-based tool for viewing, curating, and managing training datasets
exported from qontinui-runner's Training Data Exporter. It provides visual review capabilities,
annotation editing, and export functionality.

## Data Flow

```
qontinui-runner                    qontinui-web
┌─────────────────┐               ┌─────────────────────────────────┐
│ TrainingData    │               │ Dataset Viewer Page             │
│ Exporter        │──── Import ──▶│                                 │
│                 │               │ ┌─────────────┐ ┌─────────────┐ │
│ Output:         │               │ │ Statistics  │ │ Filters     │ │
│ - manifest.jsonl│               │ └─────────────┘ └─────────────┘ │
│ - images/       │               │ ┌─────────────────────────────┐ │
│ - annotations/  │               │ │ Annotation Browser          │ │
│ - metadata.json │               │ │ (ImageCanvas + Editor)      │ │
│                 │               │ └─────────────────────────────┘ │
└─────────────────┘               │ ┌─────────────────────────────┐ │
                                  │ │ Export (COCO, YOLO, etc.)   │ │
                                  │ └─────────────────────────────┘ │
                                  └─────────────────────────────────┘
```

## Page Structure

### Route: `/admin/datasets`

Main dataset management page with:

1. Dataset list (imported datasets)
2. Import functionality
3. Quick statistics

### Route: `/admin/datasets/[id]`

Dataset detail/viewer page with:

1. Statistics overview
2. Filters panel
3. Annotation browser with ImageCanvas
4. Annotation editor
5. Review workflow
6. Export options

## Components

### 1. DatasetList (`/admin/datasets/page.tsx`)

Shows all imported datasets with:

- Name, creation date, source
- Image count, annotation count
- Review progress (reviewed/total)
- Actions: View, Export, Delete

### 2. DatasetViewer (`/admin/datasets/[id]/page.tsx`)

Main viewer with these sections:

#### 2.1 Statistics Panel

- Total images, unique images
- Total annotations by source (user_click, template_matching, smart_click_analysis)
- Annotations by element type
- Confidence distribution histogram
- Review progress

#### 2.2 Filters Panel

- Source filter (checkboxes)
- Element type filter
- Confidence range slider
- Verified status (all/verified/unverified)
- Search by category name

#### 2.3 Image Browser

- Thumbnail grid of images
- Click to select and view in detail
- Badge showing annotation count per image
- Visual indicator for review status

#### 2.4 Annotation Canvas

- Uses existing ImageCanvas component (readonly mode for viewing)
- Shows bounding boxes with color coding:
  - Green: user_click (verified)
  - Blue: smart_click_analysis
  - Orange: template_matching (unverified)
- Click annotation to select and edit

#### 2.5 Annotation Editor

- View/edit selected annotation
- Fields: bbox, category, confidence, element_type, source
- Actions: Approve, Reject, Edit, Delete
- Notes field for reviewer comments

#### 2.6 Review Workflow

- Bulk approve/reject
- Mark as reviewed
- Flag for review
- Add to training set / exclude from training

### 3. DatasetImportDialog

Modal for importing datasets:

- Upload ZIP of Training Data Exporter output
- Or connect to runner storage directly
- Preview before import
- Validation feedback

### 4. DatasetExportDialog

Modal for exporting datasets:

- Format selection (COCO, YOLO, Pascal VOC, Custom)
- Filter options (only verified, confidence threshold)
- Split options (train/val/test percentages)
- Download or save to storage

## Data Models

### Dataset (stored in database)

```typescript
interface Dataset {
  id: string;
  name: string;
  description?: string;
  source: "runner_export" | "manual_upload" | "merged";
  created_at: string;
  updated_at: string;
  created_by: string;

  // Statistics (computed)
  total_images: number;
  total_annotations: number;
  reviewed_count: number;

  // Metadata from export
  dataset_version?: string;
  export_metadata?: Record<string, any>;
}
```

### DatasetImage (stored in database)

```typescript
interface DatasetImage {
  id: string;
  dataset_id: string;
  image_hash: string;
  filename: string;
  width: number;
  height: number;
  storage_path: string;

  // From manifest
  action_type?: string;
  active_states?: string[];
  timestamp?: string;

  // Review status
  reviewed: boolean;
  reviewed_by?: string;
  reviewed_at?: string;
}
```

### DatasetAnnotation (stored in database)

```typescript
interface DatasetAnnotation {
  id: string;
  dataset_id: string;
  image_id: string;

  // Bounding box
  x: number;
  y: number;
  width: number;
  height: number;

  // Category
  category_id: number;
  category_name: string;

  // Metadata
  confidence: number;
  source:
    | "user_click"
    | "template_matching"
    | "smart_click_analysis"
    | "manual";
  element_type?: string;
  verified: boolean;

  // Smart analysis metadata
  inference_metadata?: {
    strategy_used: string;
    element_type: string;
    used_fallback: boolean;
    processing_time_ms: number;
  };

  // Review
  review_status: "pending" | "approved" | "rejected" | "flagged";
  reviewer_notes?: string;
  reviewed_by?: string;
  reviewed_at?: string;
}
```

## API Endpoints

### Dataset Management

```
GET    /api/v1/datasets/                    # List all datasets
POST   /api/v1/datasets/                    # Create new dataset
GET    /api/v1/datasets/{id}                # Get dataset details
PUT    /api/v1/datasets/{id}                # Update dataset
DELETE /api/v1/datasets/{id}                # Delete dataset

POST   /api/v1/datasets/import              # Import from ZIP
POST   /api/v1/datasets/{id}/merge          # Merge another dataset
```

### Dataset Images

```
GET    /api/v1/datasets/{id}/images         # List images (paginated, filterable)
GET    /api/v1/datasets/{id}/images/{img_id}  # Get image details
PUT    /api/v1/datasets/{id}/images/{img_id}  # Update image (review status)
```

### Dataset Annotations

```
GET    /api/v1/datasets/{id}/annotations    # List annotations (paginated, filterable)
GET    /api/v1/datasets/{id}/annotations/{ann_id}  # Get annotation
PUT    /api/v1/datasets/{id}/annotations/{ann_id}  # Update annotation
DELETE /api/v1/datasets/{id}/annotations/{ann_id}  # Delete annotation

POST   /api/v1/datasets/{id}/annotations/bulk  # Bulk update (approve/reject)
```

### Dataset Statistics

```
GET    /api/v1/datasets/{id}/stats          # Get statistics
GET    /api/v1/datasets/{id}/stats/confidence-histogram  # Confidence distribution
GET    /api/v1/datasets/{id}/stats/by-source  # Breakdown by source
GET    /api/v1/datasets/{id}/stats/by-category  # Breakdown by category
```

### Dataset Export

```
POST   /api/v1/datasets/{id}/export         # Export dataset
GET    /api/v1/datasets/{id}/export/{job_id}  # Get export status/download
```

## UI Wireframe

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Dataset: session_001_training_data                    [Export] [Settings]  │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│ ┌─────────────────────────────────────────────────────────────────────────┐│
│ │ Statistics                                                              ││
│ │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ ││
│ │ │ Images   │ │Annotations│ │ Reviewed │ │Confidence│ │ By Source      │ ││
│ │ │   247    │ │   1,842   │ │  45%     │ │ Avg: 0.82│ │ ▓▓▓ click: 60% │ ││
│ │ │          │ │           │ │ 112/247  │ │          │ │ ░░░ smart: 35% │ ││
│ │ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │ ░░ templ: 5%   │ ││
│ │                                                     └────────────────┘ ││
│ └─────────────────────────────────────────────────────────────────────────┘│
│                                                                            │
│ ┌──────────────────────┐ ┌────────────────────────────────────────────────┐│
│ │ Filters              │ │ Image Browser                                  ││
│ │                      │ │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐     ││
│ │ Source:              │ │ │ ■3 │ │ ■5 │ │ ■2 │ │ ■8 │ │ ■1 │ │ ■4 │     ││
│ │ ☑ user_click         │ │ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘     ││
│ │ ☑ smart_analysis     │ │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐     ││
│ │ ☑ template_matching  │ │ │ ■6 │ │ ■2 │ │ ■9 │ │ ■3 │ │ ■7 │ │ ■4 │     ││
│ │                      │ │ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘     ││
│ │ Confidence:          │ │                                                ││
│ │ [====●=======] 0.5-1 │ │ Page 1 of 42  [<] [1] [2] [3] ... [42] [>]    ││
│ │                      │ └────────────────────────────────────────────────┘│
│ │ Review Status:       │                                                   │
│ │ ○ All                │ ┌────────────────────────────────────────────────┐│
│ │ ○ Pending            │ │ Selected Image                                 ││
│ │ ○ Approved           │ │ ┌──────────────────────────────────────────┐   ││
│ │ ○ Rejected           │ │ │                                          │   ││
│ │                      │ │ │     [ImageCanvas with bounding boxes]    │   ││
│ │ Element Type:        │ │ │                                          │   ││
│ │ ☑ button             │ │ │  ┌────────┐                              │   ││
│ │ ☑ icon               │ │ │  │ Login  │  ← Green box (user_click)    │   ││
│ │ ☑ text               │ │ │  └────────┘                              │   ││
│ │ ☑ unknown            │ │ │                                          │   ││
│ │                      │ │ └──────────────────────────────────────────┘   ││
│ │ Category:            │ │                                                ││
│ │ [Search...        ]  │ │ Annotations (8):                              ││
│ │                      │ │ ┌────────────────────────────────────────────┐││
│ │ [Apply Filters]      │ │ │ 1. login_button (user_click) ✓ [Approve]  │││
│ │ [Reset]              │ │ │    Conf: 0.95 | Type: button | 120×40     │││
│ └──────────────────────┘ │ ├────────────────────────────────────────────┤││
│                          │ │ 2. submit_icon (smart) ○ [Approve][Reject]│││
│                          │ │    Conf: 0.78 | Type: icon | 32×32        │││
│                          │ └────────────────────────────────────────────┘││
│                          │                                                ││
│                          │ [Bulk Approve Selected] [Bulk Reject Selected]││
│                          └────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────────────┘
```

## Implementation Priority

### Phase 1: Core Viewing (MVP)

1. Dataset list page
2. Dataset import from ZIP
3. Basic statistics
4. Image browser with thumbnails
5. Annotation viewing with ImageCanvas

### Phase 2: Curation Workflow

1. Annotation editing
2. Review status (approve/reject)
3. Filters (source, confidence, status)
4. Bulk operations

### Phase 3: Advanced Features

1. Dataset export (COCO, YOLO)
2. Dataset merging
3. Confidence histogram
4. Category management
5. Train/val/test splitting

## File Structure

```
frontend/src/
├── app/(app)/admin/datasets/
│   ├── page.tsx                    # Dataset list
│   ├── [id]/
│   │   └── page.tsx                # Dataset viewer
│   └── DESIGN.md                   # This document
├── components/datasets/
│   ├── DatasetCard.tsx             # Card in list view
│   ├── DatasetStatistics.tsx       # Statistics panel
│   ├── DatasetFilters.tsx          # Filter controls
│   ├── DatasetImageBrowser.tsx     # Thumbnail grid
│   ├── DatasetAnnotationList.tsx   # Annotation list for image
│   ├── DatasetAnnotationEditor.tsx # Edit single annotation
│   ├── DatasetImportDialog.tsx     # Import modal
│   └── DatasetExportDialog.tsx     # Export modal
├── services/
│   └── dataset-service.ts          # API client
└── types/
    └── dataset.ts                  # TypeScript types
```
