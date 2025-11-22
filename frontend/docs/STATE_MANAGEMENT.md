# State Management Guide

**Version:** 1.0.0
**Last Updated:** 2025-11-21

## Table of Contents

1. [Overview](#overview)
2. [State Ownership Rules](#state-ownership-rules)
3. [Architecture Principles](#architecture-principles)
4. [Best Practices](#best-practices)
5. [Common Patterns](#common-patterns)
6. [Migration Guide](#migration-guide)
7. [Troubleshooting](#troubleshooting)
8. [Reference](#reference)

---

## Overview

Qontinui uses a **layered state management architecture** that separates concerns and prevents state conflicts:

```
┌─────────────────────────────────────────────────────────────┐
│                     React Components                         │
│  (useState for local UI state: form inputs, toggles)        │
└─────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────┐
│                    Context API (Providers)                   │
│     (Cross-cutting: auth, theme, organization)              │
└─────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────┐
│                    Zustand Stores                            │
│  (Derived UI state: canvas viewport, selections, executions)│
└─────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────┐
│                    React Query (TanStack)                    │
│   (Server state: projects, users, workflows - SINGLE SOURCE │
│                        OF TRUTH)                             │
└─────────────────────────────────────────────────────────────┘
```

**Key Principle:** Server data flows DOWN through React Query → Components/Zustand. Never duplicate server data in Zustand.

---

## State Ownership Rules

### 1. React Query (TanStack Query)

**Purpose:** Single source of truth for ALL server data

**Owns:**
- Projects (CRUD operations)
- Users and authentication state
- Workflows and workflow metadata
- Execution history and logs
- Organization data
- Runner status
- Admin data (users, system health)
- Any data fetched from `/api/*` endpoints

**Location:** `src/hooks/use-*.ts` (e.g., `use-projects.ts`, `use-admin.ts`)

**Why React Query:**
- Automatic caching (1 minute stale time by default)
- Background refetching when data becomes stale
- Automatic retries with exponential backoff
- Optimistic updates with rollback
- Request deduplication
- Built-in loading/error states
- DevTools for debugging

**Example:**
```typescript
// ✅ CORRECT: Use React Query for server data
import { useProjects } from '@/hooks/use-projects'

function ProjectList() {
  const { data: projects, isLoading, error } = useProjects()

  if (isLoading) return <Spinner />
  if (error) return <ErrorMessage error={error} />

  return (
    <ul>
      {projects?.map(project => (
        <li key={project.id}>{project.name}</li>
      ))}
    </ul>
  )
}
```

---

### 2. Zustand Stores

**Purpose:** Derived UI state that depends on user interactions with the canvas/UI

**Owns:**
- Canvas state (`canvas-store.ts`)
  - Viewport (zoom, pan position)
  - Selected nodes/edges (ONLY IDs, not full data)
  - Clipboard (copied nodes)
  - Undo/redo history
  - Canvas UI settings (minimap, grid, snap)

- Execution state (`execution-store.ts`)
  - Current execution status (running, paused, completed)
  - Action execution states (ONLY status/timing, not action config)
  - Execution events stream
  - Execution variables

- Properties panel (`properties-panel-store.ts`)
  - Selected action ID
  - Panel visibility

- MCP state (`mcp-store.ts`)
  - MCP client status
  - Available tools

- Onboarding state (`onboarding-store.ts`)
  - Tutorial progress
  - Dismissed tips

**Location:** `src/stores/*.ts`

**Why Zustand:**
- Minimal boilerplate (no providers needed)
- Fast performance (selective re-renders)
- DevTools integration
- Middleware support (persist, immer, devtools)
- Simple API

**Example:**
```typescript
// ✅ CORRECT: Store only IDs, not full data
const useCanvasStore = create<CanvasStore>()((set, get) => ({
  selectedNodes: [], // Only IDs
  viewport: { x: 0, y: 0, zoom: 1 },

  selectNode: (nodeId: string) => {
    set({ selectedNodes: [nodeId] })
  },
}))

// In component:
function CanvasNode({ nodeId }: { nodeId: string }) {
  const isSelected = useCanvasStore(state =>
    state.selectedNodes.includes(nodeId)
  )

  // ✅ CORRECT: Fetch full data from React Query
  const { data: workflow } = useProject(projectId)
  const node = workflow?.actions.find(a => a.id === nodeId)

  return <div className={isSelected ? 'selected' : ''}>{node?.type}</div>
}
```

---

### 3. Context API

**Purpose:** Cross-cutting concerns that need to be accessible throughout the app

**Owns:**
- Authentication context (current user, login/logout)
- Theme context (dark/light mode)
- Organization context (current org, switching)

**Location:** `src/lib/providers/*.tsx` or `src/contexts/*.tsx`

**Why Context:**
- Avoids prop drilling for universal concerns
- Natural React pattern for app-wide state
- Easy to compose multiple contexts

**Example:**
```typescript
// ✅ CORRECT: Use Context for cross-cutting concerns
const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => fetch('/api/v1/auth/users/me').then(r => r.json())
  })

  return (
    <AuthContext.Provider value={{ user }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
```

---

### 4. Component Local State (useState)

**Purpose:** Ephemeral UI state that doesn't need to be shared

**Owns:**
- Form input values (before submission)
- Dropdown open/closed
- Modal visibility
- Hover states
- Temporary UI toggles
- Local validation errors

**Example:**
```typescript
// ✅ CORRECT: Use useState for local UI state
function CreateProjectDialog() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  const createProject = useCreateProject()

  const handleSubmit = () => {
    createProject.mutate({ name, description, configuration: {} })
    setIsOpen(false)
    setName('')
    setDescription('')
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent>
        <input value={name} onChange={e => setName(e.target.value)} />
        <input value={description} onChange={e => setDescription(e.target.value)} />
        <button onClick={handleSubmit}>Create</button>
      </DialogContent>
    </Dialog>
  )
}
```

---

## Architecture Principles

### 1. Single Source of Truth

**Server data lives ONLY in React Query cache.**

```typescript
// ❌ WRONG: Duplicating server data in Zustand
const useCanvasStore = create((set) => ({
  workflow: null, // ❌ This is server data!
  selectedNodes: [],
}))

// ✅ CORRECT: Reference server data by ID only
const useCanvasStore = create((set) => ({
  selectedNodes: [], // ✅ Only IDs
}))

// ✅ CORRECT: Fetch full data from React Query
function CanvasView({ projectId }: { projectId: string }) {
  const selectedNodes = useCanvasStore(state => state.selectedNodes)
  const { data: workflow } = useProject(projectId) // ✅ From React Query

  const selectedActions = workflow?.actions.filter(
    action => selectedNodes.includes(action.id)
  )
}
```

### 2. Data Flow Direction

```
Server → React Query → Components/Zustand → UI

User Interaction → Zustand (UI update) + React Query Mutation (server update)
```

**Example:**
```typescript
// ✅ CORRECT: Update both UI state and server data
function NodeEditor({ nodeId }: { nodeId: string }) {
  const updateProject = useUpdateProject()
  const selectNode = useCanvasStore(state => state.selectNode)

  const handleClick = () => {
    // Update UI state immediately (optimistic)
    selectNode(nodeId)

    // If modifying server data, use React Query mutation
    updateProject.mutate({
      id: projectId,
      data: { /* updates */ }
    })
  }
}
```

### 3. Derived State

**Compute derived state on-the-fly instead of storing it.**

```typescript
// ❌ WRONG: Storing derived state
const useCanvasStore = create((set) => ({
  selectedCount: 0, // ❌ This is derived from selectedNodes.length
  selectedNodes: [],
}))

// ✅ CORRECT: Use selectors
const useCanvasStore = create((set, get) => ({
  selectedNodes: [],

  // ✅ Expose as method
  getSelectedCount: () => get().selectedNodes.length,
}))

// Or use selector in component:
function SelectionCount() {
  const count = useCanvasStore(state => state.selectedNodes.length)
  return <div>{count} selected</div>
}
```

### 4. Optimistic Updates

**React Query handles optimistic updates with automatic rollback.**

```typescript
// ✅ CORRECT: Optimistic update with rollback
export function useUpdateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }) => {
      return await projectService.updateProject(id, data)
    },

    // Update UI immediately (before server responds)
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: projectKeys.detail(id) })

      // Snapshot previous value
      const previousProject = queryClient.getQueryData(projectKeys.detail(id))

      // Optimistically update
      if (previousProject) {
        queryClient.setQueryData(projectKeys.detail(id), {
          ...previousProject,
          ...data,
        })
      }

      return { previousProject, id }
    },

    // Rollback on error
    onError: (_err, _variables, context) => {
      if (context?.previousProject) {
        queryClient.setQueryData(
          projectKeys.detail(context.id),
          context.previousProject
        )
      }
    },

    // Refetch on success
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) })
    },
  })
}
```

---

## Best Practices

### ✅ DO

1. **Use React Query for ALL server data**
   - Projects, users, workflows, execution history
   - Let React Query handle caching, refetching, retries

2. **Store only IDs in Zustand**
   - Selected node IDs, not full node objects
   - Current execution ID, not full execution data

3. **Use query keys consistently**
   ```typescript
   // ✅ CORRECT: Organized query key factory
   export const projectKeys = {
     all: ['projects'] as const,
     lists: () => [...projectKeys.all, 'list'] as const,
     detail: (id: string) => [...projectKeys.all, 'detail', id] as const,
   }
   ```

4. **Invalidate queries after mutations**
   ```typescript
   onSuccess: () => {
     queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
   }
   ```

5. **Use selective Zustand subscriptions**
   ```typescript
   // ✅ CORRECT: Only re-render when selectedNodes changes
   const selectedNodes = useCanvasStore(state => state.selectedNodes)

   // ❌ WRONG: Re-renders on ANY store change
   const store = useCanvasStore()
   ```

6. **Use Zustand middleware**
   - `devtools`: Debugging in Redux DevTools
   - `persist`: Persist viewport/settings to localStorage
   - `immer`: Immutable updates with mutable syntax

7. **Handle loading and error states**
   ```typescript
   const { data, isLoading, error } = useProjects()

   if (isLoading) return <Spinner />
   if (error) return <ErrorMessage error={error} />
   if (!data) return null
   ```

### ❌ DON'T

1. **Don't duplicate server data in Zustand**
   ```typescript
   // ❌ WRONG
   const useCanvasStore = create((set) => ({
     workflow: null, // This should be in React Query!
   }))
   ```

2. **Don't fetch in Zustand actions**
   ```typescript
   // ❌ WRONG
   const useCanvasStore = create((set) => ({
     loadWorkflow: async (id: string) => {
       const workflow = await fetch(`/api/projects/${id}`)
       set({ workflow }) // ❌ Don't do this!
     }
   }))
   ```

3. **Don't manually manage loading states for server data**
   ```typescript
   // ❌ WRONG: React Query does this automatically!
   const [isLoading, setIsLoading] = useState(false)
   const [projects, setProjects] = useState([])

   useEffect(() => {
     setIsLoading(true)
     fetch('/api/projects')
       .then(res => res.json())
       .then(setProjects)
       .finally(() => setIsLoading(false))
   }, [])

   // ✅ CORRECT: Use React Query
   const { data: projects, isLoading } = useProjects()
   ```

4. **Don't store derived state**
   ```typescript
   // ❌ WRONG
   const useCanvasStore = create((set) => ({
     selectedNodes: [],
     selectedCount: 0, // Derived from selectedNodes.length
   }))
   ```

5. **Don't use Context for frequently changing state**
   ```typescript
   // ❌ WRONG: Mouse position changes frequently
   const MouseContext = createContext({ x: 0, y: 0 })

   // ✅ CORRECT: Use Zustand or useState
   const useMouseStore = create((set) => ({
     position: { x: 0, y: 0 },
     setPosition: (position) => set({ position }),
   }))
   ```

---

## Common Patterns

### Pattern 1: Referencing React Query Data from Zustand

**Problem:** Zustand action needs to access server data

**Solution:** Pass data as parameter or fetch inside component

```typescript
// ✅ CORRECT: Pass data as parameter
const useCanvasStore = create((set, get) => ({
  selectedNodes: [],

  deleteSelected: (workflow: Workflow) => {
    const { selectedNodes } = get()
    const updatedActions = workflow.actions.filter(
      action => !selectedNodes.includes(action.id)
    )
    // Return updated workflow for React Query mutation
    return { ...workflow, actions: updatedActions }
  },
}))

// In component:
function Canvas({ projectId }: { projectId: string }) {
  const { data: workflow } = useProject(projectId)
  const updateProject = useUpdateProject()
  const deleteSelected = useCanvasStore(state => state.deleteSelected)

  const handleDelete = () => {
    if (!workflow) return

    const updated = deleteSelected(workflow)
    updateProject.mutate({ id: projectId, data: updated })
  }
}
```

### Pattern 2: Optimistic Updates

**Problem:** UI should update immediately, but sync with server

**Solution:** Use React Query's optimistic update pattern

```typescript
export function useUpdateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }) => {
      return await projectService.updateProject(id, data)
    },

    onMutate: async ({ id, data }) => {
      // Cancel refetches
      await queryClient.cancelQueries({ queryKey: projectKeys.detail(id) })

      // Snapshot
      const previous = queryClient.getQueryData(projectKeys.detail(id))

      // Optimistic update
      if (previous) {
        queryClient.setQueryData(projectKeys.detail(id), {
          ...previous,
          ...data,
        })
      }

      return { previous, id }
    },

    // Rollback on error
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          projectKeys.detail(context.id),
          context.previous
        )
      }
    },

    // Refetch on success
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) })
    },
  })
}
```

### Pattern 3: Syncing State Across Components

**Problem:** Multiple components need to react to same state change

**Solution:** Use Zustand (for UI state) or React Query (for server state)

```typescript
// ✅ CORRECT: Zustand for UI state
const useCanvasStore = create((set) => ({
  selectedNodes: [],
  selectNode: (id: string) => set({ selectedNodes: [id] }),
}))

// Component A
function NodeList() {
  const selectedNodes = useCanvasStore(state => state.selectedNodes)
  const selectNode = useCanvasStore(state => state.selectNode)

  return (
    <ul>
      {nodes.map(node => (
        <li
          key={node.id}
          onClick={() => selectNode(node.id)}
          className={selectedNodes.includes(node.id) ? 'selected' : ''}
        >
          {node.type}
        </li>
      ))}
    </ul>
  )
}

// Component B (automatically synced!)
function PropertiesPanel() {
  const selectedNodes = useCanvasStore(state => state.selectedNodes)
  const { data: workflow } = useProject(projectId)

  const selectedAction = workflow?.actions.find(
    a => a.id === selectedNodes[0]
  )

  if (!selectedAction) return <div>No selection</div>
  return <div>{selectedAction.type} properties</div>
}
```

### Pattern 4: Computed Selectors

**Problem:** Need derived state based on store data

**Solution:** Use selector functions

```typescript
// ✅ CORRECT: Selector returns computed value
const useCanvasStore = create((set, get) => ({
  selectedNodes: [],

  // Expose as method
  getSelectedCount: () => get().selectedNodes.length,
  hasSelection: () => get().selectedNodes.length > 0,
}))

// Or compute in component:
function SelectionToolbar() {
  const hasSelection = useCanvasStore(
    state => state.selectedNodes.length > 0
  )

  return (
    <div>
      {hasSelection && <button>Delete</button>}
    </div>
  )
}

// Or use custom hook:
function useSelectedActions(projectId: string) {
  const selectedNodes = useCanvasStore(state => state.selectedNodes)
  const { data: workflow } = useProject(projectId)

  return useMemo(
    () => workflow?.actions.filter(a => selectedNodes.includes(a.id)),
    [workflow, selectedNodes]
  )
}
```

### Pattern 5: Loading States

**Problem:** Show loading spinner while fetching data

**Solution:** Use React Query's built-in states

```typescript
// ✅ CORRECT: Use isLoading and error
function ProjectList() {
  const { data: projects, isLoading, error, refetch } = useProjects()

  if (isLoading) {
    return <Spinner />
  }

  if (error) {
    return (
      <div>
        <p>Error: {error.message}</p>
        <button onClick={() => refetch()}>Retry</button>
      </div>
    )
  }

  if (!projects || projects.length === 0) {
    return <EmptyState />
  }

  return (
    <ul>
      {projects.map(project => (
        <li key={project.id}>{project.name}</li>
      ))}
    </ul>
  )
}
```

---

## Migration Guide

### Migrating from Zustand to React Query

**Before: Server data in Zustand**
```typescript
// ❌ OLD: Server data in Zustand
const useProjectStore = create((set) => ({
  projects: [],
  isLoading: false,
  error: null,

  loadProjects: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await fetch('/api/projects')
      const projects = await response.json()
      set({ projects, isLoading: false })
    } catch (error) {
      set({ error, isLoading: false })
    }
  },
}))

// Usage
function ProjectList() {
  const { projects, isLoading, loadProjects } = useProjectStore()

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  if (isLoading) return <Spinner />

  return <ul>{projects.map(p => <li key={p.id}>{p.name}</li>)}</ul>
}
```

**After: Server data in React Query**
```typescript
// ✅ NEW: Server data in React Query
// 1. Create React Query hook (hooks/use-projects.ts)
export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  detail: (id: string) => [...projectKeys.all, 'detail', id] as const,
}

export function useProjects() {
  return useQuery({
    queryKey: projectKeys.lists(),
    queryFn: async () => {
      const response = await fetch('/api/projects')
      return response.json()
    },
  })
}

// 2. Use in component
function ProjectList() {
  const { data: projects, isLoading, error } = useProjects()

  if (isLoading) return <Spinner />
  if (error) return <ErrorMessage error={error} />

  return (
    <ul>
      {projects?.map(project => (
        <li key={project.id}>{project.name}</li>
      ))}
    </ul>
  )
}
```

**Migration Steps:**

1. **Create React Query hook**
   - Move fetch logic to `hooks/use-*.ts`
   - Define query keys
   - Add proper TypeScript types

2. **Remove Zustand state**
   - Delete server data fields
   - Delete loading/error states
   - Delete fetch actions

3. **Update components**
   - Replace `useStore()` with `useQuery()`
   - Remove manual `useEffect` calls
   - Use built-in `isLoading` and `error`

4. **Add mutations**
   - Create `useMutation` hooks for updates
   - Add optimistic updates if needed
   - Invalidate queries on success

### Moving from Context to Zustand

**When to migrate:**
- Context causes unnecessary re-renders
- State changes frequently (e.g., canvas viewport)
- Performance becomes an issue

**Before: Context with re-render issues**
```typescript
// ❌ OLD: Context causes all consumers to re-render
const CanvasContext = createContext({
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedNodes: [],
  setViewport: () => {},
  selectNode: () => {},
})

function CanvasProvider({ children }) {
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })
  const [selectedNodes, setSelectedNodes] = useState([])

  return (
    <CanvasContext.Provider value={{
      viewport,
      selectedNodes,
      setViewport,
      selectNode: (id) => setSelectedNodes([id]),
    }}>
      {children}
    </CanvasContext.Provider>
  )
}
```

**After: Zustand with selective subscriptions**
```typescript
// ✅ NEW: Zustand allows selective subscriptions
const useCanvasStore = create((set) => ({
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedNodes: [],

  setViewport: (viewport) => set({ viewport }),
  selectNode: (id) => set({ selectedNodes: [id] }),
}))

// Component A only re-renders when viewport changes
function Minimap() {
  const viewport = useCanvasStore(state => state.viewport)
  return <div>Zoom: {viewport.zoom}</div>
}

// Component B only re-renders when selectedNodes changes
function SelectionCount() {
  const count = useCanvasStore(state => state.selectedNodes.length)
  return <div>{count} selected</div>
}
```

---

## Troubleshooting

### Issue: Stale Data

**Symptom:** UI shows old data after mutation

**Cause:** Forgot to invalidate queries

**Solution:**
```typescript
const updateProject = useUpdateProject()

return useMutation({
  mutationFn: updateProjectAPI,
  onSuccess: () => {
    // ✅ Invalidate to trigger refetch
    queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
    queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) })
  },
})
```

### Issue: Infinite Re-renders

**Symptom:** Component keeps re-rendering

**Cause:** Creating new objects in selectors

**Solution:**
```typescript
// ❌ WRONG: Creates new object every time
const state = useCanvasStore(state => ({
  viewport: state.viewport,
  selectedNodes: state.selectedNodes,
}))

// ✅ CORRECT: Use separate selectors
const viewport = useCanvasStore(state => state.viewport)
const selectedNodes = useCanvasStore(state => state.selectedNodes)

// ✅ CORRECT: Use shallow equality
import { shallow } from 'zustand/shallow'

const { viewport, selectedNodes } = useCanvasStore(
  state => ({
    viewport: state.viewport,
    selectedNodes: state.selectedNodes,
  }),
  shallow
)
```

### Issue: Query Not Refetching

**Symptom:** Data doesn't update when expected

**Cause:** Query key not changing or staleTime too long

**Solution:**
```typescript
// ✅ CORRECT: Include dependencies in query key
const { data } = useQuery({
  queryKey: ['project', projectId], // Changes when projectId changes
  queryFn: () => fetchProject(projectId),
})

// ✅ CORRECT: Reduce staleTime for frequently changing data
const { data } = useQuery({
  queryKey: ['execution', executionId],
  queryFn: () => fetchExecution(executionId),
  staleTime: 0, // Always fetch on mount
  refetchInterval: 1000, // Poll every second
})
```

### Issue: Zustand State Not Persisting

**Symptom:** State resets on page reload

**Cause:** Missing persist middleware

**Solution:**
```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const useCanvasStore = create(
  persist(
    (set) => ({
      viewport: { x: 0, y: 0, zoom: 1 },
      setViewport: (viewport) => set({ viewport }),
    }),
    {
      name: 'canvas-storage', // localStorage key
      partialize: (state) => ({
        // Only persist these fields
        viewport: state.viewport,
      }),
    }
  )
)
```

### Issue: React Query Mutations Not Working

**Symptom:** Mutation succeeds but UI doesn't update

**Cause:** Not invalidating queries or missing optimistic update

**Solution:**
```typescript
const updateProject = useMutation({
  mutationFn: updateProjectAPI,

  // Option 1: Invalidate and refetch
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) })
  },

  // Option 2: Update cache directly
  onSuccess: (newData) => {
    queryClient.setQueryData(projectKeys.detail(id), newData)
  },
})
```

### React Query DevTools

**Enable DevTools to debug queries:**

```typescript
// Already enabled in src/lib/providers/query-provider.tsx
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

export function QueryProvider({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} position="bottom-right" />
      )}
    </QueryClientProvider>
  )
}
```

**DevTools Features:**
- View all queries and their state
- Inspect cached data
- Manually trigger refetch
- View query timelines
- Debug stale/fresh data

**Usage:**
1. Open DevTools (bottom-right corner in dev mode)
2. Click on a query to inspect
3. View query state, data, error
4. Use "Refetch" to manually update
5. Use "Remove" to clear cache

---

## Reference

### React Query Hooks

```typescript
// Fetch data
useQuery({
  queryKey: ['projects'],
  queryFn: fetchProjects,
  staleTime: 60000, // Data fresh for 1 minute
  refetchOnWindowFocus: true,
  retry: 3,
})

// Fetch dependent data
useQuery({
  queryKey: ['project', projectId],
  queryFn: () => fetchProject(projectId),
  enabled: !!projectId, // Only fetch if projectId exists
})

// Create/Update/Delete
useMutation({
  mutationFn: updateProject,
  onMutate: async (variables) => {
    // Optimistic update
    await queryClient.cancelQueries({ queryKey: ['projects'] })
    const previous = queryClient.getQueryData(['projects'])
    queryClient.setQueryData(['projects'], newData)
    return { previous }
  },
  onError: (err, variables, context) => {
    // Rollback
    queryClient.setQueryData(['projects'], context.previous)
  },
  onSuccess: () => {
    // Refetch
    queryClient.invalidateQueries({ queryKey: ['projects'] })
  },
})

// Query Client methods
queryClient.invalidateQueries({ queryKey: ['projects'] })
queryClient.setQueryData(['projects', id], newData)
queryClient.getQueryData(['projects', id])
queryClient.removeQueries({ queryKey: ['projects'] })
```

### Zustand Store

```typescript
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

const useStore = create(
  devtools(
    persist(
      immer((set, get) => ({
        // State
        count: 0,
        items: [],

        // Actions
        increment: () => set(state => { state.count++ }),
        addItem: (item) => set(state => {
          state.items.push(item)
        }),

        // Computed
        getTotal: () => get().items.reduce((sum, item) => sum + item.value, 0),
      })),
      {
        name: 'storage-key',
        partialize: (state) => ({ count: state.count }),
      }
    ),
    { name: 'MyStore' }
  )
)

// Usage
function Component() {
  // ✅ Selective subscription
  const count = useStore(state => state.count)
  const increment = useStore(state => state.increment)

  // ❌ Re-renders on any change
  const store = useStore()

  // ✅ Multiple values with shallow equality
  import { shallow } from 'zustand/shallow'
  const { count, increment } = useStore(
    state => ({ count: state.count, increment: state.increment }),
    shallow
  )
}
```

### Query Key Patterns

```typescript
// Flat structure
['projects']
['projects', 'list']
['projects', 'detail', projectId]

// Nested structure
export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (filters) => [...projectKeys.lists(), { filters }] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
}

// Invalidate all projects
queryClient.invalidateQueries({ queryKey: projectKeys.all })

// Invalidate project lists
queryClient.invalidateQueries({ queryKey: projectKeys.lists() })

// Invalidate specific project
queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) })
```

### Common Store Patterns

```typescript
// Selection state
const useSelectionStore = create((set) => ({
  selectedIds: [],
  selectOne: (id) => set({ selectedIds: [id] }),
  selectMany: (ids) => set({ selectedIds: ids }),
  toggleSelection: (id) => set((state) => ({
    selectedIds: state.selectedIds.includes(id)
      ? state.selectedIds.filter(i => i !== id)
      : [...state.selectedIds, id],
  })),
  clearSelection: () => set({ selectedIds: [] }),
}))

// UI state
const useUIStore = create((set) => ({
  isOpen: false,
  activeTab: 'home',
  theme: 'light',

  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  setTab: (tab) => set({ activeTab: tab }),
  setTheme: (theme) => set({ theme }),
}))

// Viewport state
const useViewportStore = create((set) => ({
  x: 0,
  y: 0,
  zoom: 1,

  setPosition: (x, y) => set({ x, y }),
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(2, zoom)) }),
  zoomIn: () => set((state) => ({ zoom: state.zoom * 1.2 })),
  zoomOut: () => set((state) => ({ zoom: state.zoom / 1.2 })),
  reset: () => set({ x: 0, y: 0, zoom: 1 }),
}))
```

---

## Additional Resources

- [TanStack Query Docs](https://tanstack.com/query/latest/docs/react/overview)
- [Zustand Docs](https://zustand-demo.pmnd.rs/)
- [React Context Docs](https://react.dev/reference/react/useContext)
- [Immer Docs](https://immerjs.github.io/immer/)

---

**Questions or Issues?**

If you encounter state management issues not covered in this guide:
1. Check React Query DevTools (bottom-right in dev mode)
2. Check Zustand DevTools (Redux DevTools browser extension)
3. Review existing hooks in `src/hooks/` for examples
4. Ask in team chat or create an issue

**Last Updated:** 2025-11-21 by Claude Code
