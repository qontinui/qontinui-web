# Deficiency Management Components

Comprehensive UI components for managing software deficiencies (bugs) with workflow, assignment, and collaboration features.

## Components

### DeficiencyWorkflow

Status workflow UI for deficiency lifecycle management.

**Features:**

- Visual status badges with colors
- Workflow state transitions (new → acknowledged → investigating → fixed → closed)
- Status change actions with validation
- Activity timeline showing status change history
- User information for each status change

**Usage:**

```tsx
import { DeficiencyWorkflow } from "@/components/testing/deficiencies";

<DeficiencyWorkflow
  deficiency={deficiency}
  activities={activities}
  onStatusChange={handleStatusChange}
/>;
```

---

### DeficiencyDetails

Full defect details modal with comprehensive information display.

**Features:**

- Tabbed interface (Overview, Workflow, Comments, Activity)
- Screenshot gallery integration
- Reproduction steps visualization
- Assignment and workflow management
- Export and share functionality
- Keyboard navigation support

**Usage:**

```tsx
import { DeficiencyDetails } from "@/components/testing/deficiencies";

<DeficiencyDetails
  deficiency={deficiency}
  comments={comments}
  activities={activities}
  open={isOpen}
  onOpenChange={setIsOpen}
  onStatusChange={handleStatusChange}
  onAssignmentChange={handleAssignment}
  onCommentAdd={handleCommentAdd}
/>;
```

---

### DeficiencyComments

Team comments and discussion thread.

**Features:**

- Add new comments with rich text
- @mention team members
- File attachments (images, documents)
- Comment thread chronological display
- User avatars and timestamps
- File download functionality
- Keyboard shortcuts (Ctrl+Enter to submit)

**Usage:**

```tsx
import { DeficiencyComments } from "@/components/testing/deficiencies";

<DeficiencyComments
  deficiencyId={deficiency.id}
  comments={comments}
  onCommentAdd={handleCommentAdd}
/>;
```

---

### DeficiencyAssignment

Assign deficiency to team members.

**Features:**

- Assign/unassign deficiencies to users
- Display currently assigned user with avatar
- Show assignment date
- User selection dropdown
- Email notification option (optional)
- Loading states during assignment changes

**Usage:**

```tsx
import { DeficiencyAssignment } from "@/components/testing/deficiencies";

<DeficiencyAssignment
  deficiency={deficiency}
  availableUsers={users}
  onAssignmentChange={handleAssignment}
/>;
```

---

### DeficiencyFilters

Advanced filtering for deficiency list.

**Features:**

- Search by title/description
- Filter by severity (multiple selection)
- Filter by type (multiple selection)
- Filter by status (multiple selection)
- Filter by assignee (multiple selection)
- Filter by tags (multiple selection)
- Date range filtering
- Clear all filters
- Active filter count badge
- Collapsible sections

**Usage:**

```tsx
import { DeficiencyFilters } from "@/components/testing/deficiencies";

<DeficiencyFilters
  filters={filters}
  onFiltersChange={setFilters}
  availableUsers={users}
  availableTags={tags}
/>;
```

---

### DeficiencyExport

Export dialog for generating reports in multiple formats.

**Features:**

- Export format selection (PDF, CSV, JSON)
- Include/exclude options (comments, activity, screenshots)
- Template selection for PDF exports
- Preview of export options
- Loading state during export
- Success/error feedback

**Usage:**

```tsx
import { DeficiencyExport } from "@/components/testing/deficiencies";

<DeficiencyExport
  open={exportOpen}
  onOpenChange={setExportOpen}
  onExport={handleExport}
  availableTemplates={["Standard", "Detailed", "Executive Summary"]}
/>;
```

---

### ScreenshotGallery

Lightbox viewer for screenshots with zoom and navigation.

**Features:**

- Grid thumbnail view
- Click to open lightbox
- Navigation between images (prev/next)
- Keyboard navigation (arrow keys, escape)
- Zoom in/out
- Download individual screenshots
- Image index display
- Responsive design

**Usage:**

```tsx
import { ScreenshotGallery } from "@/components/testing/deficiencies";

<ScreenshotGallery screenshots={deficiency.screenshot_urls} />;
```

---

### ReproductionPathViewer

Step-by-step visualization of reproduction steps.

**Features:**

- Numbered steps with connecting lines
- Expandable/collapsible steps
- Mark steps as completed (for verification)
- Copy all steps to clipboard
- Visual progress indicator
- Responsive design

**Usage:**

```tsx
import { ReproductionPathViewer } from "@/components/testing/deficiencies";

<ReproductionPathViewer steps={deficiency.reproduction_steps} />;
```

---

## Type Definitions

All type definitions are in `/src/types/deficiency.ts`:

- `Deficiency` - Main deficiency object
- `DeficiencyComment` - Comment on a deficiency
- `DeficiencyActivity` - Activity log entry
- `DeficiencyFilters` - Filter criteria
- `DeficiencyExportOptions` - Export configuration
- `DeficiencySeverity` - Severity levels enum
- `DeficiencyType` - Type classification enum
- `DeficiencyStatus` - Lifecycle status enum

## Workflow

The deficiency lifecycle follows this workflow:

1. **NEW** - Initial state when deficiency is reported
2. **ACKNOWLEDGED** - Team has reviewed and confirmed the issue
3. **INVESTIGATING** - Actively working on root cause analysis
4. **FIXED** - Issue has been resolved and ready for verification
5. **CLOSED** - Fix has been verified and deployed

Alternative path:

- **WON'T FIX** - Issue will not be addressed (by design, out of scope, etc.)

Valid transitions are defined in `WORKFLOW_TRANSITIONS` in the types file.

## Integration

### API Integration

These components expect callback functions for API integration:

```tsx
// Status change
const handleStatusChange = async (newStatus: DeficiencyStatus) => {
  await fetch(`/api/deficiencies/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: newStatus }),
  });
};

// Assignment change
const handleAssignment = async (userId: string | null) => {
  await fetch(`/api/deficiencies/${id}/assign`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
};

// Add comment
const handleCommentAdd = async (
  content: string,
  mentions: string[],
  attachments: File[]
) => {
  const formData = new FormData();
  formData.append("content", content);
  formData.append("mentions", JSON.stringify(mentions));
  attachments.forEach((file) => formData.append("attachments", file));

  await fetch(`/api/deficiencies/${id}/comments`, {
    method: "POST",
    body: formData,
  });
};

// Export
const handleExport = async (options: DeficiencyExportOptions) => {
  const response = await fetch(`/api/deficiencies/export`, {
    method: "POST",
    body: JSON.stringify(options),
  });
  const blob = await response.blob();
  // Download blob...
};
```

### User Management Integration

Pass available users from your auth context:

```tsx
import { useAuth } from "@/contexts/auth-context";

const { users } = useAuth(); // Or fetch from API

<DeficiencyAssignment
  deficiency={deficiency}
  availableUsers={users}
  onAssignmentChange={handleAssignment}
/>;
```

## Accessibility

All components follow accessibility best practices:

- **Keyboard Navigation**: Full keyboard support with arrow keys, Enter, Escape
- **Screen Readers**: Proper ARIA labels and semantic HTML
- **Focus Management**: Logical tab order and focus indicators
- **Color Contrast**: WCAG AA compliant color combinations
- **Loading States**: Clear feedback during async operations

## Styling

Components use shadcn/ui components and Tailwind CSS:

- Consistent with existing design system
- Dark mode support via `next-themes`
- Responsive breakpoints for mobile/tablet/desktop
- Customizable via className prop

## Example: Full Integration

```tsx
"use client";

import { useState } from "react";
import {
  DeficiencyDetails,
  DeficiencyFilters,
  DeficiencyExport,
} from "@/components/testing/deficiencies";
import { Deficiency, DeficiencyFilters as Filters } from "@/types/deficiency";

export function DeficiencyDashboard() {
  const [deficiencies, setDeficiencies] = useState<Deficiency[]>([]);
  const [filters, setFilters] = useState<Filters>({});
  const [selectedDeficiency, setSelectedDeficiency] =
    useState<Deficiency | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  // API handlers
  const handleStatusChange = async (newStatus) => {
    /* ... */
  };
  const handleAssignment = async (userId) => {
    /* ... */
  };
  const handleCommentAdd = async (content, mentions, files) => {
    /* ... */
  };
  const handleExport = async (options) => {
    /* ... */
  };

  return (
    <div className="flex gap-6">
      {/* Sidebar: Filters */}
      <aside className="w-80">
        <DeficiencyFilters
          filters={filters}
          onFiltersChange={setFilters}
          availableUsers={users}
          availableTags={tags}
        />
      </aside>

      {/* Main: Deficiency List */}
      <main className="flex-1">
        {/* List of deficiencies */}
        {deficiencies.map((deficiency) => (
          <div
            key={deficiency.id}
            onClick={() => setSelectedDeficiency(deficiency)}
          >
            {/* Deficiency card */}
          </div>
        ))}
      </main>

      {/* Details Modal */}
      {selectedDeficiency && (
        <DeficiencyDetails
          deficiency={selectedDeficiency}
          open={!!selectedDeficiency}
          onOpenChange={(open) => !open && setSelectedDeficiency(null)}
          onStatusChange={handleStatusChange}
          onAssignmentChange={handleAssignment}
          onCommentAdd={handleCommentAdd}
          onExport={() => setExportOpen(true)}
        />
      )}

      {/* Export Dialog */}
      <DeficiencyExport
        open={exportOpen}
        onOpenChange={setExportOpen}
        onExport={handleExport}
      />
    </div>
  );
}
```

## Backend API Endpoints

Expected backend endpoints (reference the model in `backend/app/models/test_deficiency.py`):

- `GET /api/deficiencies` - List deficiencies (with filters)
- `GET /api/deficiencies/:id` - Get single deficiency
- `POST /api/deficiencies` - Create deficiency
- `PATCH /api/deficiencies/:id` - Update deficiency
- `DELETE /api/deficiencies/:id` - Delete deficiency
- `POST /api/deficiencies/:id/assign` - Assign to user
- `GET /api/deficiencies/:id/comments` - Get comments
- `POST /api/deficiencies/:id/comments` - Add comment
- `GET /api/deficiencies/:id/activities` - Get activity log
- `POST /api/deficiencies/export` - Export deficiencies

## Notes

- All components are client-side (`'use client'`) for interactivity
- Components handle their own loading/error states
- Toast notifications use `sonner` library
- File uploads limited to 5MB per file
- Images use Next.js `Image` component for optimization
- All timestamps use browser's locale for formatting
