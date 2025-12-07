# Global Search Component

A powerful command palette (Cmd/Ctrl+K) for searching across all resources in the qontinui-web application.

## Features

### Search Interface

- **Keyboard Shortcut**: `Cmd/Ctrl + K` to open search
- **Real-time Search**: Debounced search with 300ms delay
- **Keyboard Navigation**: Arrow keys to navigate, Enter to select, ESC to close
- **Auto-scroll**: Selected result automatically scrolls into view

### Search Capabilities

Search across multiple resource types:

- **Workflows**: Name, description, category, action names
- **States**: Name, description, state images
- **Images**: Filename, tags, metadata, source
- **Transitions**: From/to state names
- **Folders**: Name, description
- **Actions**: Name, type, parent workflow

### Search Features

- **Fuzzy Matching**: Smart matching algorithm with scoring
- **Search Operators**: Filter using syntax like `type:workflow`, `tag:login`
- **Type Filters**: Toggle filters for specific resource types
- **Recent Searches**: Automatically saves and displays recent searches
- **Result Grouping**: Results grouped by resource type with counts
- **Match Highlighting**: Shows which fields matched the query

### Search Operators

#### Type Filter

```
type:workflow    # Search only workflows
type:state       # Search only states
type:image       # Search only images
```

#### Folder Filter

```
folder:Main           # Search in Main folder
folder:"User Login"   # Use quotes for multi-word folders
```

#### Tag Filter

```
tag:auth         # Search items with auth tag
tag:login        # Search items with login tag
```

#### Combined Filters

```
type:workflow tag:auth login    # Search workflows with auth tag containing "login"
```

## Installation

The component is already created in your project:

```
frontend/src/
├── components/
│   └── global-search/
│       ├── GlobalSearch.tsx          # Main component
│       ├── GlobalSearch.example.tsx  # Usage examples
│       ├── index.ts                  # Exports
│       └── README.md                 # This file
└── services/
    └── global-search-service.ts      # Search service
```

## Basic Usage

### 1. Import the Component

```tsx
import { GlobalSearch } from "@/components/global-search";
```

### 2. Add to Your Layout

```tsx
"use client";

import { useState } from "react";
import { GlobalSearch } from "@/components/global-search";

export function Layout({ children }) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div>
      {children}
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
```

### 3. Load Data into Search Index

```tsx
import { globalSearchService } from "@/services/global-search-service";

// Load your data
const workflows = await fetchWorkflows();
const states = await fetchStates();
const images = await fetchImages();

// Update search index
globalSearchService.updateIndex({
  workflows,
  states,
  images,
});
```

## Advanced Usage

### Using the Hook

```tsx
import { useGlobalSearch } from "@/components/global-search";

function MyComponent() {
  const { open, openSearch, closeSearch } = useGlobalSearch();

  return (
    <>
      <button onClick={openSearch}>Search</button>
      <GlobalSearch open={open} onOpenChange={closeSearch} />
    </>
  );
}
```

### Header Integration

```tsx
export function Header() {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header>
      <h1>My App</h1>

      <button onClick={() => setSearchOpen(true)}>
        <Search className="w-4 h-4" />
        <span>Search...</span>
        <kbd>⌘K</kbd>
      </button>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
```

### Updating Index When Data Changes

```tsx
// When a workflow is created
const newWorkflow = await createWorkflow(data);
globalSearchService.updateIndex({
  workflows: [...existingWorkflows, newWorkflow],
});

// When a workflow is updated
const updatedWorkflow = await updateWorkflow(id, data);
globalSearchService.updateIndex({
  workflows: existingWorkflows.map((wf) =>
    wf.id === id ? updatedWorkflow : wf
  ),
});
```

### Recent Searches

```tsx
// Get recent searches
const recent = globalSearchService.getRecentSearches();

// Clear recent searches
globalSearchService.clearRecentSearches();

// Searches are automatically saved when a result is selected
```

## API Reference

### GlobalSearch Component

#### Props

| Prop           | Type                      | Default     | Description                      |
| -------------- | ------------------------- | ----------- | -------------------------------- |
| `open`         | `boolean`                 | `undefined` | Controlled open state            |
| `onOpenChange` | `(open: boolean) => void` | `undefined` | Callback when open state changes |

#### Features

- Auto-opens with `Cmd/Ctrl + K`
- Closes with `ESC`
- Keyboard navigation with arrow keys
- Enter to select result
- Automatic debouncing (300ms)
- Results grouped by type
- Recent searches when input is empty

### GlobalSearchService

#### Methods

##### `updateIndex(data)`

Update the search index with new data.

```tsx
globalSearchService.updateIndex({
  workflows?: Workflow[],
  states?: State[],
  images?: ImageAsset[],
  transitions?: Transition[],
  folders?: WorkflowFolder[],
});
```

##### `clearIndex()`

Clear the entire search index.

```tsx
globalSearchService.clearIndex();
```

##### `searchAll(query, filters)`

Search across all resource types.

```tsx
const results = await globalSearchService.searchAll("login", {
  types: ["workflow", "state"],
});
```

##### `searchWorkflows(query, filters)`

Search only workflows.

```tsx
const workflows = await globalSearchService.searchWorkflows("login");
```

##### `searchStates(query, filters)`

Search only states.

```tsx
const states = await globalSearchService.searchStates("main menu");
```

##### `searchImages(query, filters)`

Search only images.

```tsx
const images = await globalSearchService.searchImages("button");
```

##### `saveRecentSearch(query, filters)`

Save a search to recent history (automatically called when selecting a result).

```tsx
globalSearchService.saveRecentSearch("login workflow", {
  types: ["workflow"],
});
```

##### `getRecentSearches()`

Get recent search history.

```tsx
const recent = globalSearchService.getRecentSearches();
```

##### `clearRecentSearches()`

Clear recent search history.

```tsx
globalSearchService.clearRecentSearches();
```

## Types

### SearchResultItem

```tsx
interface SearchResultItem {
  id: string;
  type: ResourceType;
  name: string;
  description?: string;
  icon?: string;
  breadcrumb?: string[];
  matches: SearchMatch[];
  score: number;
  metadata?: Record<string, any>;
  resource?: any;
}
```

### SearchFilter

```tsx
interface SearchFilter {
  types?: ResourceType[];
  folders?: string[];
  tags?: string[];
  dateRange?: {
    from: Date;
    to: Date;
  };
}
```

### ResourceType

```tsx
type ResourceType =
  | "workflow"
  | "state"
  | "image"
  | "transition"
  | "folder"
  | "action"
  | "component"
  | "test"
  | "documentation";
```

## Customization

### Custom Navigation

To customize how results navigate when selected, fork `GlobalSearch.tsx` and modify the `handleResultClick` function:

```tsx
const handleResultClick = (result: SearchResultItem) => {
  switch (result.type) {
    case "workflow":
      // Your custom navigation
      router.push(`/custom/workflow/${result.id}`);
      break;
    // ... other cases
  }
  setOpen(false);
};
```

### Custom Styling

The component uses Tailwind CSS classes. You can customize by:

1. Modifying the component directly
2. Using CSS modules
3. Overriding with custom classes

### Max Results Per Type

By default, each resource type shows up to 20 results. To change this, modify the `MAX_RESULTS_PER_TYPE` constant in `global-search-service.ts`:

```tsx
private readonly MAX_RESULTS_PER_TYPE = 50; // Change from 20 to 50
```

## Performance

### Debouncing

Search queries are debounced by 300ms to reduce API calls and improve performance. You can adjust this in `GlobalSearch.tsx`:

```tsx
searchTimeoutRef.current = setTimeout(() => {
  performSearch(query, activeFilters);
}, 500); // Change from 300ms to 500ms
```

### Indexing Strategy

The search service uses an in-memory index for fast searches. For large datasets:

1. **Lazy Loading**: Load data on-demand
2. **Pagination**: Limit results per type
3. **IndexedDB**: Store index in browser storage
4. **Web Workers**: Offload search to background thread

### Memory Management

The index is stored in memory. To reduce memory usage:

```tsx
// Clear index when not needed
globalSearchService.clearIndex();

// Update only changed resources
globalSearchService.updateIndex({
  workflows: newWorkflows, // Only updated workflows
});
```

## Keyboard Shortcuts

| Shortcut       | Action           |
| -------------- | ---------------- |
| `Cmd/Ctrl + K` | Open search      |
| `↑/↓`          | Navigate results |
| `Enter`        | Select result    |
| `ESC`          | Close search     |

## Best Practices

1. **Load Index Early**: Update the search index as soon as data is available
2. **Keep Index Updated**: Update the index whenever resources change
3. **Use Type Filters**: Encourage users to use type filters for faster searches
4. **Monitor Performance**: Use React DevTools to monitor component performance
5. **Recent Searches**: Clear old recent searches periodically

## Troubleshooting

### Search not working

1. Check if index is populated:

```tsx
console.log(globalSearchService.getAllWorkflows());
```

2. Verify data structure matches expected types

### Keyboard shortcut not working

1. Check for conflicting shortcuts in browser/OS
2. Ensure component is mounted
3. Check event listener in DevTools

### Results not navigating

1. Verify routing setup
2. Check `handleResultClick` function
3. Ensure routes exist

## Future Enhancements

Potential improvements:

- [ ] Full-text search in workflow actions
- [ ] Search history analytics
- [ ] Search result previews
- [ ] Advanced filters (date range, tags)
- [ ] Search result actions (copy, favorite, etc.)
- [ ] Server-side search for large datasets
- [ ] Search across documentation files
- [ ] AI-powered search suggestions
- [ ] Custom search result templates
- [ ] Search result caching

## Examples

See `GlobalSearch.example.tsx` for complete working examples including:

- Basic usage
- Hook usage
- Layout integration
- Full data loading
- Custom search button
- Programmatic search
- Index management

## Support

For issues or questions:

1. Check this README
2. Review `GlobalSearch.example.tsx`
3. Check the component source code
4. Create an issue in your project repository

## License

Part of the qontinui-web project.
