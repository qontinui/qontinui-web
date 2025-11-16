# Global Search - Quick Start

Get the global search component running in 5 minutes.

## Step 1: Test the Demo (1 minute)

Create a demo page to test immediately:

```tsx
// app/demo/search/page.tsx
import { GlobalSearchDemo } from '@/components/global-search/GlobalSearch.demo';

export default function Page() {
  return <GlobalSearchDemo />;
}
```

Visit `/demo/search` and press `Cmd/Ctrl + K` to test!

## Step 2: Add to Your App (2 minutes)

### Option A: Add to Root Layout

```tsx
// app/layout.tsx
'use client';

import { useState } from 'react';
import { GlobalSearch } from '@/components/global-search';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <GlobalSearchProvider />
      </body>
    </html>
  );
}

function GlobalSearchProvider() {
  const [open, setOpen] = useState(false);
  return <GlobalSearch open={open} onOpenChange={setOpen} />;
}
```

### Option B: Add to Header Component

```tsx
// components/Header.tsx
'use client';

import { useState } from 'react';
import { GlobalSearch } from '@/components/global-search';
import { Search } from 'lucide-react';

export function Header() {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <header className="border-b">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold">My App</h1>

          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary hover:bg-secondary/80"
          >
            <Search className="w-4 h-4" />
            <span>Search...</span>
            <kbd className="px-1.5 py-0.5 text-xs bg-background rounded">⌘K</kbd>
          </button>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
```

## Step 3: Load Your Data (2 minutes)

Create a hook to load data into the search index:

```tsx
// hooks/useSearchIndex.ts
import { useEffect } from 'react';
import { globalSearchService } from '@/services/global-search-service';
import { projectDB } from '@/lib/project-db';

export function useSearchIndex() {
  useEffect(() => {
    async function loadIndex() {
      try {
        // Load from your data source
        const workflows = await projectDB.getAllWorkflows();
        const states = await projectDB.getAllStates();
        const images = await projectDB.getAllImages();
        const transitions = await projectDB.getAllTransitions();

        // Update search index
        globalSearchService.updateIndex({
          workflows,
          states,
          images,
          transitions,
        });

        console.log('✓ Search index loaded');
      } catch (error) {
        console.error('Failed to load search index:', error);
      }
    }

    loadIndex();
  }, []);
}
```

Then use it in your app:

```tsx
// app/layout.tsx or app/page.tsx
import { useSearchIndex } from '@/hooks/useSearchIndex';

export function App() {
  useSearchIndex(); // Load index on mount

  return (
    // Your app content
  );
}
```

## That's It!

Press `Cmd/Ctrl + K` anywhere in your app to search!

## Try These Searches

- `login` - Find login-related items
- `type:workflow` - Search workflows only
- `type:state dashboard` - Find dashboard state
- `export` - Find export workflow
- `type:image button` - Find button images

## Next Steps

1. **Customize navigation** - Edit where results navigate in `GlobalSearch.tsx`
2. **Update on changes** - Call `globalSearchService.updateIndex()` when data changes
3. **Add more types** - Extend to search components, tests, documentation
4. **Style it** - Customize the UI with your brand colors

## Full Documentation

- `README.md` - Complete documentation
- `INTEGRATION.md` - Detailed integration guide
- `GlobalSearch.example.tsx` - Usage examples
- `GlobalSearch.demo.tsx` - Interactive demo

## Common Issues

**Search not working?**
- Check if index is loaded: `console.log(globalSearchService.getAllWorkflows())`
- Verify data structure matches types

**Shortcut not working?**
- Check for conflicts with browser/OS shortcuts
- Verify component is mounted

**Results not navigating?**
- Check routes exist in your app
- Verify `handleResultClick` function

## Support

Check the documentation files or review the source code for implementation details.

---

**Time to integrate**: ~5 minutes
**Lines of code to write**: ~20-30
**Dependencies**: All included (shadcn/ui, lucide-react)
