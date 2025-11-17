/**
 * Global Search Component Examples
 *
 * Demonstrates how to integrate and use the GlobalSearch component in your application.
 */

'use client';

import { useEffect, useState } from 'react';
import { GlobalSearch, useGlobalSearch } from './GlobalSearch';
import { globalSearchService } from '@/services/global-search-service';
import { Button } from '@/components/ui/button';
import { Search, Command } from 'lucide-react';

// ============================================================================
// Example 1: Basic Usage with Controlled State
// ============================================================================

export function BasicGlobalSearchExample() {
  const [open, setOpen] = useState(false);

  return (
    <div className="p-4">
      <Button onClick={() => setOpen(true)}>
        <Search className="w-4 h-4 mr-2" />
        Open Search
      </Button>

      <GlobalSearch open={open} onOpenChange={setOpen} />
    </div>
  );
}

// ============================================================================
// Example 2: Using the Hook
// ============================================================================

export function HookGlobalSearchExample() {
  const { open, openSearch, closeSearch } = useGlobalSearch();

  return (
    <div className="p-4">
      <Button onClick={openSearch}>
        <Search className="w-4 h-4 mr-2" />
        Search (Cmd+K)
      </Button>

      <GlobalSearch open={open} onOpenChange={closeSearch} />
    </div>
  );
}

// ============================================================================
// Example 3: Integration with Layout (Header/Navbar)
// ============================================================================

export function HeaderWithGlobalSearch() {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <header className="border-b">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold">My App</h1>

          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
          >
            <Search className="w-4 h-4" />
            <span className="hidden md:inline">Search...</span>
            <kbd className="hidden md:inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground ml-2">
              <Command className="w-3 h-3" />K
            </kbd>
          </button>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}

// ============================================================================
// Example 4: Full Integration with Data Loading
// ============================================================================

export function FullIntegrationExample() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [indexLoaded, setIndexLoaded] = useState(false);

  // Load data into search index on mount
  useEffect(() => {
    async function loadSearchIndex() {
      try {
        // Fetch all resources from your API or database
        const [workflows, states, images, transitions, folders] = await Promise.all([
          fetchWorkflows(), // Your API call
          fetchStates(),
          fetchImages(),
          fetchTransitions(),
          fetchFolders(),
        ]);

        // Update search index
        globalSearchService.updateIndex({
          workflows,
          states,
          images,
          transitions,
          folders,
        });

        setIndexLoaded(true);
      } catch (error) {
        console.error('Failed to load search index:', error);
      }
    }

    loadSearchIndex();
  }, []);

  // Update index when resources change
  useEffect(() => {
    // Subscribe to resource changes (if using a store like Zustand)
    // const unsubscribe = workflowStore.subscribe((state) => {
    //   globalSearchService.updateIndex({ workflows: state.workflows });
    // });
    //
    // return unsubscribe;
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold">Qontinui</h1>

          <div className="flex items-center gap-4">
            {!indexLoaded && (
              <span className="text-xs text-muted-foreground">Loading search index...</span>
            )}

            <button
              onClick={() => setSearchOpen(true)}
              disabled={!indexLoaded}
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Search className="w-4 h-4" />
              <span className="hidden md:inline">Search...</span>
              <kbd className="hidden md:inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground ml-2">
                ⌘K
              </kbd>
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <p className="text-center text-muted-foreground">
          Press <kbd className="px-2 py-1 bg-secondary rounded">Cmd/Ctrl + K</kbd> to search
        </p>
      </main>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

// ============================================================================
// Example 5: Custom Search Button Component
// ============================================================================

export function SearchButton() {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setSearchOpen(true)}
        className="group relative flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary/50 hover:bg-secondary transition-all duration-200 w-full max-w-md"
      >
        <Search className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors flex-1 text-left">
          Search workflows, states, images...
        </span>
        <kbd className="inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}

// ============================================================================
// Mock API Functions (Replace with your actual API calls)
// ============================================================================

async function fetchWorkflows() {
  // Replace with actual API call
  return [];
}

async function fetchStates() {
  // Replace with actual API call
  return [];
}

async function fetchImages() {
  // Replace with actual API call
  return [];
}

async function fetchTransitions() {
  // Replace with actual API call
  return [];
}

async function fetchFolders() {
  // Replace with actual API call
  return [];
}

// ============================================================================
// Example 6: Integration with Next.js App Layout
// ============================================================================

/**
 * Add to your app/layout.tsx:
 *
 * ```tsx
 * import { GlobalSearch } from '@/components/global-search';
 * import { useState } from 'react';
 *
 * export default function RootLayout({ children }) {
 *   const [searchOpen, setSearchOpen] = useState(false);
 *
 *   return (
 *     <html>
 *       <body>
 *         {children}
 *         <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */

// ============================================================================
// Example 7: Programmatic Search with Filters
// ============================================================================

export function ProgrammaticSearchExample() {
  const [searchOpen, setSearchOpen] = useState(false);

  const handleSearchWorkflows = () => {
    // Open search with workflow filter pre-applied
    // Note: You would need to extend the GlobalSearch component to accept initial filters
    setSearchOpen(true);
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold">Quick Search Actions</h2>

      <div className="flex gap-2">
        <Button onClick={() => setSearchOpen(true)} variant="outline">
          <Search className="w-4 h-4 mr-2" />
          Search Everything
        </Button>

        <Button onClick={handleSearchWorkflows} variant="outline">
          Search Workflows Only
        </Button>

        <Button
          onClick={() => {
            // Clear recent searches
            globalSearchService.clearRecentSearches();
          }}
          variant="outline"
        >
          Clear Recent Searches
        </Button>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

// ============================================================================
// Example 8: Custom Result Navigation
// ============================================================================

/**
 * To customize how results navigate, you can fork the GlobalSearch component
 * and modify the handleResultClick function:
 *
 * ```tsx
 * const handleResultClick = (result: SearchResultItem) => {
 *   switch (result.type) {
 *     case 'workflow':
 *       // Custom workflow navigation
 *       openWorkflowInEditor(result.id);
 *       break;
 *     case 'state':
 *       // Custom state navigation
 *       openStatePanel(result.id);
 *       break;
 *     // ... other cases
 *   }
 *   setOpen(false);
 * };
 * ```
 */

// ============================================================================
// Example 9: Search Index Management
// ============================================================================

export function SearchIndexManagement() {
  const [stats, setStats] = useState({ workflows: 0, states: 0, images: 0 });

  const handleRefreshIndex = async () => {
    // Fetch fresh data
    const workflows = await fetchWorkflows();
    const states = await fetchStates();
    const images = await fetchImages();

    // Update index
    globalSearchService.updateIndex({
      workflows,
      states,
      images,
    });

    // Update stats
    setStats({
      workflows: workflows.length,
      states: states.length,
      images: images.length,
    });
  };

  const handleClearIndex = () => {
    globalSearchService.clearIndex();
    setStats({ workflows: 0, states: 0, images: 0 });
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold">Search Index Management</h2>

      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 border rounded-lg">
          <div className="text-2xl font-bold">{stats.workflows}</div>
          <div className="text-sm text-muted-foreground">Workflows</div>
        </div>
        <div className="p-4 border rounded-lg">
          <div className="text-2xl font-bold">{stats.states}</div>
          <div className="text-sm text-muted-foreground">States</div>
        </div>
        <div className="p-4 border rounded-lg">
          <div className="text-2xl font-bold">{stats.images}</div>
          <div className="text-sm text-muted-foreground">Images</div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={handleRefreshIndex}>Refresh Index</Button>
        <Button onClick={handleClearIndex} variant="outline">
          Clear Index
        </Button>
      </div>
    </div>
  );
}
