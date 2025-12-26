# Global Search Integration Guide

Quick guide to integrate the Global Search component into your qontinui-web application.

## Files Created

```
frontend/src/
├── components/global-search/
│   ├── GlobalSearch.tsx          # Main component (543 lines)
│   ├── GlobalSearch.example.tsx  # Usage examples (381 lines)
│   ├── GlobalSearch.demo.tsx     # Demo with mock data (569 lines)
│   ├── index.ts                  # Exports (5 lines)
│   ├── README.md                 # Documentation (493 lines)
│   └── INTEGRATION.md            # This file
└── services/
    └── global-search-service.ts  # Search service (959 lines)
```

**Total: 2,950 lines of code**

## Quick Start (3 Steps)

### Step 1: Add to Your Layout

Edit your main layout file (e.g., `app/layout.tsx` or similar):

```tsx
"use client";

import { useState } from "react";
import { GlobalSearch } from "@/components/global-search";

export default function RootLayout({ children }) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <html>
      <body>
        {children}

        {/* Add Global Search */}
        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      </body>
    </html>
  );
}
```

### Step 2: Load Data into Search Index

Create a hook or component to load data:

```tsx
// hooks/useSearchIndex.ts
import { useEffect } from "react";
import { globalSearchService } from "@/services/global-search-service";
import { workflowRepository, stateRepository, imageRepository, transitionRepository } from "@/lib/repositories";

export function useSearchIndex() {
  useEffect(() => {
    async function loadIndex() {
      try {
        // Load from IndexedDB repositories
        const workflows = await workflowRepository.getAll();
        const states = await stateRepository.getAll();
        const images = await imageRepository.getAll();
        const transitions = await transitionRepository.getAll();

        // Update search index
        globalSearchService.updateIndex({
          workflows,
          states,
          images,
          transitions,
        });
      } catch (error) {
        console.error("Failed to load search index:", error);
      }
    }

    loadIndex();
  }, []);
}
```

Then use it in your layout or main component:

```tsx
function App() {
  useSearchIndex(); // Load index on mount

  return <YourApp />;
}
```

### Step 3: Add Search Button to Header

```tsx
// components/Header.tsx
import { useState } from "react";
import { Search } from "lucide-react";

export function Header() {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header>
      <h1>My App</h1>

      <button
        onClick={() => setSearchOpen(true)}
        className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary hover:bg-secondary/80"
      >
        <Search className="w-4 h-4" />
        <span>Search...</span>
        <kbd className="px-1.5 py-0.5 text-xs bg-background rounded">⌘K</kbd>
      </button>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
```

## Test It Out

### Option 1: Use the Demo

Visit the demo page to test with mock data:

```tsx
// app/demo/search/page.tsx
import { GlobalSearchDemo } from "@/components/global-search/GlobalSearch.demo";

export default function SearchDemoPage() {
  return <GlobalSearchDemo />;
}
```

Then visit `/demo/search` in your browser.

### Option 2: Quick Test

```tsx
import { GlobalSearch } from "@/components/global-search";
import { globalSearchService } from "@/services/global-search-service";

// Load some test data
globalSearchService.updateIndex({
  workflows: [
    {
      id: "1",
      name: "Test Workflow",
      version: "1.0.0",
      format: "graph",
      actions: [],
      connections: {},
    },
  ],
});

// Then use the component
<GlobalSearch open={true} onOpenChange={() => {}} />;
```

## Keep Index Updated

Update the search index whenever data changes:

```tsx
// When creating a workflow
const newWorkflow = await createWorkflow(data);
globalSearchService.updateIndex({
  workflows: [...existingWorkflows, newWorkflow],
});

// When updating a workflow
const updatedWorkflow = await updateWorkflow(id, data);
globalSearchService.updateIndex({
  workflows: existingWorkflows.map((wf) =>
    wf.id === id ? updatedWorkflow : wf
  ),
});

// When deleting a workflow
globalSearchService.updateIndex({
  workflows: existingWorkflows.filter((wf) => wf.id !== id),
});
```

## Integration with Existing Stores

If you're using Zustand or another state management solution:

```tsx
// stores/workflow-store.ts
import { create } from "zustand";
import { globalSearchService } from "@/services/global-search-service";

export const useWorkflowStore = create((set) => ({
  workflows: [],

  addWorkflow: (workflow) =>
    set((state) => {
      const newWorkflows = [...state.workflows, workflow];

      // Update search index
      globalSearchService.updateIndex({ workflows: newWorkflows });

      return { workflows: newWorkflows };
    }),

  updateWorkflow: (id, updates) =>
    set((state) => {
      const newWorkflows = state.workflows.map((wf) =>
        wf.id === id ? { ...wf, ...updates } : wf
      );

      // Update search index
      globalSearchService.updateIndex({ workflows: newWorkflows });

      return { workflows: newWorkflows };
    }),
}));
```

## Customize Navigation

By default, results navigate to:

- Workflows: `/workflows/{id}`
- States: `/states/{id}`
- Images: `/images/{id}`
- Transitions: `/transitions/{id}`
- Folders: `/folders/{id}`
- Actions: `/workflows/{workflowId}?action={actionId}`

To customize, edit the `handleResultClick` function in `GlobalSearch.tsx`:

```tsx
const handleResultClick = (result: SearchResultItem) => {
  switch (result.type) {
    case "workflow":
      // Your custom navigation
      router.push(`/custom/path/${result.id}`);
      break;
    // ... other cases
  }
  setOpen(false);
};
```

## Keyboard Shortcuts

The component automatically registers `Cmd/Ctrl + K` to open search.

To disable or change the shortcut, edit the `useEffect` in `GlobalSearch.tsx`:

```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Change to your preferred shortcut
    if ((e.metaKey || e.ctrlKey) && e.key === "p") {
      // Cmd/Ctrl + P
      e.preventDefault();
      setOpen(true);
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [setOpen]);
```

## Performance Tips

### 1. Lazy Load the Index

Only load the search index when the user first opens search:

```tsx
const [indexLoaded, setIndexLoaded] = useState(false);

useEffect(() => {
  if (searchOpen && !indexLoaded) {
    loadSearchIndex();
    setIndexLoaded(true);
  }
}, [searchOpen, indexLoaded]);
```

### 2. Debounce Updates

When data changes frequently, debounce index updates:

```tsx
import { debounce } from "lodash"; // or create your own

const updateSearchIndex = debounce((workflows) => {
  globalSearchService.updateIndex({ workflows });
}, 500);
```

### 3. Partial Updates

Instead of updating all workflows, update only changed items:

```tsx
// Only update specific workflows
const updatedWorkflows = existingWorkflows.map((wf) =>
  changedIds.includes(wf.id) ? updatedWorkflowsMap[wf.id] : wf
);

globalSearchService.updateIndex({ workflows: updatedWorkflows });
```

## Troubleshooting

### Search Not Working

1. Check if index is loaded:

```tsx
console.log(globalSearchService.getAllWorkflows());
```

2. Verify data structure matches types in `global-search-service.ts`

3. Check browser console for errors

### Results Not Navigating

1. Verify routes exist in your app
2. Check `handleResultClick` function
3. Ensure router is available

### Keyboard Shortcut Not Working

1. Check for conflicting shortcuts in browser/OS
2. Verify component is mounted
3. Check event listener in DevTools

## Next Steps

1. Review `README.md` for complete documentation
2. Check `GlobalSearch.example.tsx` for usage examples
3. Test with `GlobalSearch.demo.tsx`
4. Customize styling and behavior as needed
5. Add more resource types (components, tests, documentation)

## Support

- See `README.md` for detailed documentation
- Check `GlobalSearch.example.tsx` for code examples
- Review the source code for implementation details

## Future Enhancements

Consider adding:

- [ ] Server-side search for large datasets
- [ ] Search result previews
- [ ] Advanced filters (date range, tags)
- [ ] AI-powered search suggestions
- [ ] Search analytics
- [ ] Custom result templates
- [ ] Full-text search in action configs
- [ ] Search across documentation files

## Contributing

To extend the search functionality:

1. Add new resource types in `global-search-service.ts`
2. Update `ResourceType` union
3. Add search methods (e.g., `searchDocumentation`)
4. Add icons and labels in `GlobalSearch.tsx`
5. Update navigation in `handleResultClick`

---

**Created**: November 14, 2025
**Version**: 1.0.0
**Lines of Code**: 2,950
