/**
 * Global Search Demo
 *
 * A complete demo of the GlobalSearch component with mock data.
 * Use this to test the component without needing real data.
 */

'use client';

import { useEffect, useState } from 'react';
import { GlobalSearch } from './GlobalSearch';
import { globalSearchService } from '@/services/global-search-service';
import { Button } from '@/components/ui/button';
import { Search, RefreshCw } from 'lucide-react';
import type { Workflow } from '@/lib/action-schema/action-types';
import type { State, Transition, ImageAsset } from '@/contexts/automation-context/types';
import type { WorkflowFolder } from '@/types/workflow-organization/types';

// ============================================================================
// Mock Data
// ============================================================================

const mockWorkflows: Workflow[] = [
  {
    id: 'wf-1',
    name: 'User Login Workflow',
    version: '1.0.0',
    format: 'graph',
    category: 'Authentication',
    description: 'Complete user login flow with validation',
    actions: [
      {
        id: 'a1',
        type: 'FIND',
        name: 'Find Username Field',
        config: { imageIds: ['img-1'], searchRegions: [] },
        position: [100, 100],
      },
      {
        id: 'a2',
        type: 'TYPE',
        name: 'Enter Username',
        config: { text: 'user@example.com' },
        position: [100, 250],
      },
      {
        id: 'a3',
        type: 'CLICK',
        name: 'Click Login Button',
        config: { imageIds: ['img-2'] },
        position: [100, 400],
      },
    ],
    connections: {
      a1: { main: [[{ action: 'a2', type: 'main', index: 0 }]] },
      a2: { main: [[{ action: 'a3', type: 'main', index: 0 }]] },
    },
  },
  {
    id: 'wf-2',
    name: 'Password Reset Workflow',
    version: '1.0.0',
    format: 'graph',
    category: 'Authentication',
    description: 'Handle password reset requests',
    actions: [
      {
        id: 'a1',
        type: 'FIND',
        name: 'Find Reset Link',
        config: { imageIds: ['img-3'], searchRegions: [] },
        position: [100, 100],
      },
      {
        id: 'a2',
        type: 'CLICK',
        name: 'Click Reset Link',
        config: { imageIds: ['img-3'] },
        position: [100, 250],
      },
    ],
    connections: {
      a1: { main: [[{ action: 'a2', type: 'main', index: 0 }]] },
    },
  },
  {
    id: 'wf-3',
    name: 'Data Export Workflow',
    version: '1.0.0',
    format: 'graph',
    category: 'Data Management',
    description: 'Export user data to CSV',
    actions: [
      {
        id: 'a1',
        type: 'FIND',
        name: 'Find Export Button',
        config: { imageIds: ['img-4'], searchRegions: [] },
        position: [100, 100],
      },
      {
        id: 'a2',
        type: 'CLICK',
        name: 'Click Export',
        config: { imageIds: ['img-4'] },
        position: [100, 250],
      },
      {
        id: 'a3',
        type: 'WAIT',
        name: 'Wait for Download',
        config: { duration: 5000 },
        position: [100, 400],
      },
    ],
    connections: {
      a1: { main: [[{ action: 'a2', type: 'main', index: 0 }]] },
      a2: { main: [[{ action: 'a3', type: 'main', index: 0 }]] },
    },
  },
  {
    id: 'wf-4',
    name: 'Form Submission Workflow',
    version: '1.0.0',
    format: 'graph',
    category: 'Forms',
    description: 'Submit contact form with validation',
    actions: [
      {
        id: 'a1',
        type: 'TYPE',
        name: 'Enter Name',
        config: { text: 'John Doe' },
        position: [100, 100],
      },
      {
        id: 'a2',
        type: 'TYPE',
        name: 'Enter Email',
        config: { text: 'john@example.com' },
        position: [100, 250],
      },
      {
        id: 'a3',
        type: 'CLICK',
        name: 'Submit Form',
        config: { imageIds: ['img-5'] },
        position: [100, 400],
      },
    ],
    connections: {
      a1: { main: [[{ action: 'a2', type: 'main', index: 0 }]] },
      a2: { main: [[{ action: 'a3', type: 'main', index: 0 }]] },
    },
  },
];

const mockStates: State[] = [
  {
    id: 'st-1',
    name: 'Login Page',
    description: 'Main login page with username and password fields',
    initial: true,
    stateImages: [
      {
        id: 'si-1',
        name: 'Login Form',
        patterns: [
          {
            id: 'p-1',
            name: 'Login Pattern',
            imageId: 'img-1',
            searchRegions: [],
            fixed: false,
          },
        ],
        shared: false,
      },
    ],
    regions: [],
    locations: [],
    strings: [],
    position: { x: 100, y: 100 },
  },
  {
    id: 'st-2',
    name: 'Dashboard',
    description: 'User dashboard after successful login',
    stateImages: [
      {
        id: 'si-2',
        name: 'Dashboard View',
        patterns: [
          {
            id: 'p-2',
            name: 'Dashboard Pattern',
            imageId: 'img-2',
            searchRegions: [],
            fixed: false,
          },
        ],
        shared: false,
      },
    ],
    regions: [],
    locations: [],
    strings: [],
    position: { x: 400, y: 100 },
  },
  {
    id: 'st-3',
    name: 'Settings Page',
    description: 'User settings and preferences',
    stateImages: [
      {
        id: 'si-3',
        name: 'Settings View',
        patterns: [
          {
            id: 'p-3',
            name: 'Settings Pattern',
            imageId: 'img-3',
            searchRegions: [],
            fixed: false,
          },
        ],
        shared: false,
      },
    ],
    regions: [],
    locations: [],
    strings: [],
    position: { x: 700, y: 100 },
  },
];

const mockImages: ImageAsset[] = [
  {
    id: 'img-1',
    name: 'username-field.png',
    url: '/images/username-field.png',
    size: 12456,
    createdAt: new Date('2024-01-15'),
    usageCount: 3,
    s3_key: 'images/username-field.png',
    url_expires_at: new Date('2025-01-15'),
    source: 'uploaded',
  },
  {
    id: 'img-2',
    name: 'login-button.png',
    url: '/images/login-button.png',
    size: 8234,
    createdAt: new Date('2024-01-16'),
    usageCount: 5,
    s3_key: 'images/login-button.png',
    url_expires_at: new Date('2025-01-16'),
    source: 'uploaded',
  },
  {
    id: 'img-3',
    name: 'reset-password-link.png',
    url: '/images/reset-link.png',
    size: 6789,
    createdAt: new Date('2024-01-17'),
    usageCount: 2,
    s3_key: 'images/reset-link.png',
    url_expires_at: new Date('2025-01-17'),
    source: 'pattern_optimization',
  },
  {
    id: 'img-4',
    name: 'export-button.png',
    url: '/images/export-button.png',
    size: 9876,
    createdAt: new Date('2024-01-18'),
    usageCount: 1,
    s3_key: 'images/export-button.png',
    url_expires_at: new Date('2025-01-18'),
    source: 'uploaded',
  },
];

const mockTransitions: Transition[] = [
  {
    id: 'tr-1',
    type: 'OutgoingTransition',
    fromState: 'st-1',
    toState: 'st-2',
    activateStates: ['st-2'],
    staysVisible: false,
    deactivateStates: ['st-1'],
    workflows: ['wf-1'],
    timeout: 5000,
    retryCount: 3,
  },
  {
    id: 'tr-2',
    type: 'OutgoingTransition',
    fromState: 'st-2',
    toState: 'st-3',
    activateStates: ['st-3'],
    staysVisible: false,
    deactivateStates: ['st-2'],
    workflows: ['wf-2'],
    timeout: 5000,
    retryCount: 3,
  },
  {
    id: 'tr-3',
    type: 'IncomingTransition',
    toState: 'st-1',
    workflows: ['wf-3'],
    timeout: 5000,
    retryCount: 3,
  },
];

const mockFolders: WorkflowFolder[] = [
  {
    id: 'f-1',
    name: 'Authentication',
    parentId: null,
    color: '#3b82f6',
    icon: 'folder',
    description: 'User authentication workflows',
    metadata: {
      created: '2024-01-10',
      updated: '2024-01-20',
      workflowCount: 2,
    },
    order: 1,
  },
  {
    id: 'f-2',
    name: 'Data Management',
    parentId: null,
    color: '#10b981',
    icon: 'folder',
    description: 'Data import and export workflows',
    metadata: {
      created: '2024-01-11',
      updated: '2024-01-21',
      workflowCount: 1,
    },
    order: 2,
  },
  {
    id: 'f-3',
    name: 'Forms',
    parentId: null,
    color: '#f59e0b',
    icon: 'folder',
    description: 'Form submission workflows',
    metadata: {
      created: '2024-01-12',
      updated: '2024-01-22',
      workflowCount: 1,
    },
    order: 3,
  },
];

// ============================================================================
// Demo Component
// ============================================================================

export function GlobalSearchDemo() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [indexLoaded, setIndexLoaded] = useState(false);

  // Load mock data into search index
  const loadMockData = () => {
    globalSearchService.updateIndex({
      workflows: mockWorkflows,
      states: mockStates,
      images: mockImages,
      transitions: mockTransitions,
      folders: mockFolders,
    });
    setIndexLoaded(true);
  };

  // Load on mount
  useEffect(() => {
    loadMockData();
  }, []);

  const handleReset = () => {
    globalSearchService.clearIndex();
    globalSearchService.clearRecentSearches();
    setIndexLoaded(false);
    setTimeout(() => {
      loadMockData();
    }, 100);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Global Search Demo</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Test the global search component with mock data
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={handleReset} variant="outline" size="sm">
                <RefreshCw className="w-4 h-4 mr-2" />
                Reset
              </Button>

              <button
                onClick={() => setSearchOpen(true)}
                disabled={!indexLoaded}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors disabled:opacity-50"
              >
                <Search className="w-4 h-4" />
                <span className="hidden md:inline">Search...</span>
                <kbd className="hidden lg:inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground ml-2">
                  ⌘K
                </kbd>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="p-6 border rounded-lg bg-card">
              <div className="text-3xl font-bold text-primary">
                {mockWorkflows.length}
              </div>
              <div className="text-sm text-muted-foreground mt-1">Workflows</div>
            </div>
            <div className="p-6 border rounded-lg bg-card">
              <div className="text-3xl font-bold text-primary">{mockStates.length}</div>
              <div className="text-sm text-muted-foreground mt-1">States</div>
            </div>
            <div className="p-6 border rounded-lg bg-card">
              <div className="text-3xl font-bold text-primary">{mockImages.length}</div>
              <div className="text-sm text-muted-foreground mt-1">Images</div>
            </div>
            <div className="p-6 border rounded-lg bg-card">
              <div className="text-3xl font-bold text-primary">
                {mockTransitions.length}
              </div>
              <div className="text-sm text-muted-foreground mt-1">Transitions</div>
            </div>
            <div className="p-6 border rounded-lg bg-card">
              <div className="text-3xl font-bold text-primary">{mockFolders.length}</div>
              <div className="text-sm text-muted-foreground mt-1">Folders</div>
            </div>
          </div>

          {/* Instructions */}
          <div className="p-6 border rounded-lg bg-card space-y-4">
            <h2 className="text-xl font-semibold">How to Test</h2>

            <div className="space-y-3">
              <div>
                <h3 className="font-medium mb-2">1. Open Search</h3>
                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                  <li>Press <kbd className="px-2 py-0.5 bg-secondary rounded text-xs">Cmd/Ctrl + K</kbd></li>
                  <li>Or click the "Search..." button above</li>
                </ul>
              </div>

              <div>
                <h3 className="font-medium mb-2">2. Try These Searches</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="p-3 bg-secondary/50 rounded text-sm">
                    <code>login</code> - Find login-related items
                  </div>
                  <div className="p-3 bg-secondary/50 rounded text-sm">
                    <code>type:workflow</code> - Search workflows only
                  </div>
                  <div className="p-3 bg-secondary/50 rounded text-sm">
                    <code>export</code> - Find export workflow
                  </div>
                  <div className="p-3 bg-secondary/50 rounded text-sm">
                    <code>type:state dashboard</code> - Find dashboard state
                  </div>
                  <div className="p-3 bg-secondary/50 rounded text-sm">
                    <code>button</code> - Find button images
                  </div>
                  <div className="p-3 bg-secondary/50 rounded text-sm">
                    <code>type:folder auth</code> - Find auth folder
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-medium mb-2">3. Navigation</h3>
                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                  <li>Use <kbd className="px-2 py-0.5 bg-secondary rounded text-xs">↑</kbd> <kbd className="px-2 py-0.5 bg-secondary rounded text-xs">↓</kbd> arrow keys to navigate</li>
                  <li>Press <kbd className="px-2 py-0.5 bg-secondary rounded text-xs">Enter</kbd> to select</li>
                  <li>Press <kbd className="px-2 py-0.5 bg-secondary rounded text-xs">ESC</kbd> to close</li>
                </ul>
              </div>

              <div>
                <h3 className="font-medium mb-2">4. Filters</h3>
                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                  <li>Click type badges to filter by resource type</li>
                  <li>Use multiple filters together</li>
                  <li>Clear filters by clicking again</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Data Preview */}
          <div className="p-6 border rounded-lg bg-card">
            <h2 className="text-xl font-semibold mb-4">Mock Data Preview</h2>

            <div className="space-y-4">
              <div>
                <h3 className="font-medium mb-2">Workflows</h3>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {mockWorkflows.map(wf => (
                    <li key={wf.id}>
                      <span className="font-medium text-foreground">{wf.name}</span> - {wf.description}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="font-medium mb-2">States</h3>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {mockStates.map(st => (
                    <li key={st.id}>
                      <span className="font-medium text-foreground">{st.name}</span> - {st.description}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="font-medium mb-2">Images</h3>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {mockImages.map(img => (
                    <li key={img.id}>
                      <span className="font-medium text-foreground">{img.name}</span> - Used {img.usageCount} times
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Global Search Component */}
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

export default GlobalSearchDemo;
