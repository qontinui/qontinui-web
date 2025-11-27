# Canvas Store - Complete Index

Welcome to the refactored Canvas Store documentation. This index helps you navigate all documentation and find what you need.

## Quick Start

**New to the Canvas Store?** Start here:

1. Read [README.md](./README.md) for architecture overview
2. Check [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) for API cheat sheet
3. See example usage in components

**Migrating from old store?** Go here:

1. Read [MIGRATION.md](./MIGRATION.md) for step-by-step guide
2. Check backward compatibility notes
3. Update imports gradually

**Want to understand the architecture?** Read:

1. [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture
2. [REFACTORING_SUMMARY.md](./REFACTORING_SUMMARY.md) for metrics
3. [FILE_STRUCTURE.md](./FILE_STRUCTURE.md) for file organization

## Documentation Files

### 📘 README.md (8.2 KB)
**Purpose**: Main documentation and getting started guide

**Contents**:
- Architecture overview
- Slice descriptions and responsibilities
- Usage examples
- Selector hooks reference
- Performance tips
- Testing examples
- Migration guide overview

**Read this if**: You want a comprehensive overview

---

### 🚀 QUICK_REFERENCE.md (7.8 KB)
**Purpose**: One-page API cheat sheet

**Contents**:
- All selector hooks
- All actions with examples
- Common patterns
- Performance tips
- Type imports
- Quick copy-paste examples

**Read this if**: You need quick API reference while coding

---

### 🔄 MIGRATION.md (9.1 KB)
**Purpose**: Step-by-step migration guide

**Contents**:
- Quick migration steps
- API compatibility table
- Before/after code examples
- Selector hook conversions
- Common issues and solutions
- Rollback plan

**Read this if**: You're migrating from the old monolithic store

---

### 🏗️ ARCHITECTURE.md (13 KB)
**Purpose**: Detailed architecture documentation

**Contents**:
- Visual architecture diagrams
- Data flow diagrams
- Slice responsibilities matrix
- Dependencies between slices
- Middleware stack explanation
- Design patterns used
- Future enhancements roadmap

**Read this if**: You want deep understanding of the design

---

### 📊 REFACTORING_SUMMARY.md (11 KB)
**Purpose**: Refactoring results and metrics

**Contents**:
- Executive summary
- Before/after comparison
- Metrics and improvements
- Quality metrics
- Performance improvements
- Testing coverage
- Success criteria verification

**Read this if**: You want to see the improvements and benefits

---

### 📁 FILE_STRUCTURE.md (9.8 KB)
**Purpose**: Complete file listing and organization

**Contents**:
- Directory tree
- File details and line counts
- Size distribution charts
- Responsibility matrix
- Import paths guide
- Maintenance guide

**Read this if**: You want to understand the file organization

---

### 📇 INDEX.md (this file)
**Purpose**: Navigation and quick links

**Contents**:
- Documentation index
- Quick links to common tasks
- File descriptions
- Learning paths

**Read this if**: You're looking for specific documentation

## Implementation Files

### Core Types
- **types.ts** (142 lines) - All TypeScript types and interfaces
- **utils.ts** (68 lines) - Shared utility functions

### Store Slices (8 slices)
- **workflow-slice.ts** (93 lines) - Workflow state and validation
- **action-slice.ts** (164 lines) - Action CRUD operations
- **connection-slice.ts** (123 lines) - Connection management
- **selection-slice.ts** (77 lines) - Node and edge selection
- **clipboard-slice.ts** (154 lines) - Copy/paste operations
- **history-slice.ts** (95 lines) - Undo/redo functionality
- **viewport-slice.ts** (64 lines) - Pan/zoom/viewport state
- **preferences-slice.ts** (48 lines) - UI preferences

### Main Export
- **index.ts** (138 lines) - Combines slices and exports hooks

### Tests
- **canvas-store.test.ts** (373 lines) - Comprehensive test suite

## Quick Links by Task

### I want to...

#### Learn the basics
→ Start with [README.md](./README.md)
→ Then [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)

#### Migrate existing code
→ Follow [MIGRATION.md](./MIGRATION.md)
→ Check [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) for new APIs

#### Understand the architecture
→ Read [ARCHITECTURE.md](./ARCHITECTURE.md)
→ Review [FILE_STRUCTURE.md](./FILE_STRUCTURE.md)

#### Add a new feature
→ Find relevant slice in [README.md](./README.md#slices)
→ Check tests in `canvas-store.test.ts`
→ Follow slice pattern from existing code

#### Debug an issue
→ Check [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) for API usage
→ Review relevant slice implementation
→ Check tests for expected behavior

#### Optimize performance
→ See performance tips in [README.md](./README.md#performance-tips)
→ Check [QUICK_REFERENCE.md](./QUICK_REFERENCE.md#performance-tips)
→ Use selector hooks from `index.ts`

#### Write tests
→ See examples in `canvas-store.test.ts`
→ Follow test patterns for each slice
→ Test slices independently

#### Add a new slice
→ Follow structure in [FILE_STRUCTURE.md](./FILE_STRUCTURE.md#maintenance)
→ Copy pattern from existing slice
→ Add to `index.ts`

## Learning Paths

### Path 1: Quick Start (15 minutes)
1. Skim [README.md](./README.md) - Overview
2. Read [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) - API reference
3. Try examples in your code

### Path 2: Migration (30 minutes)
1. Read [MIGRATION.md](./MIGRATION.md) - Migration guide
2. Review [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) - New APIs
3. Update one component at a time
4. Test thoroughly

### Path 3: Deep Dive (1-2 hours)
1. Read [README.md](./README.md) - Full overview
2. Read [ARCHITECTURE.md](./ARCHITECTURE.md) - Architecture details
3. Review slice implementations
4. Read [REFACTORING_SUMMARY.md](./REFACTORING_SUMMARY.md) - Results
5. Study tests in `canvas-store.test.ts`

### Path 4: Contributor (2-3 hours)
1. Complete Path 3 (Deep Dive)
2. Read [FILE_STRUCTURE.md](./FILE_STRUCTURE.md) - File organization
3. Study all slice implementations
4. Review test patterns
5. Read maintenance guide
6. Practice adding a new slice

## API Quick Reference

### Most Used Hooks
```typescript
// Get these from '@/stores/canvas'
useWorkflow()          // Get current workflow
useSelectedNodes()     // Get selected nodes
useCanUndo()           // Check if can undo
useActions()           // Get all actions
useZoom()              // Get zoom level
```

### Most Used Actions
```typescript
const {
  addAction,           // Add new action
  updateAction,        // Update action
  deleteAction,        // Delete action
  selectNode,          // Select a node
  copy,                // Copy selection
  paste,               // Paste from clipboard
  undo,                // Undo last change
  redo,                // Redo next change
} = useCanvasStore();
```

### Most Common Patterns

**Add and select action:**
```typescript
const { addAction, selectNode } = useCanvasStore();
addAction(newAction);
selectNode(newAction.id);
```

**Delete selected:**
```typescript
const selectedNodes = useSelectedNodes();
const { deleteActions } = useCanvasStore();
deleteActions(selectedNodes);
```

**Keyboard shortcuts:**
```typescript
const { undo, redo, copy, paste } = useCanvasStore();
const canUndo = useCanUndo();
const canRedo = useCanRedo();

// Ctrl+Z for undo, Ctrl+Y for redo
// Ctrl+C for copy, Ctrl+V for paste
```

## File Size Reference

| Category | Files | Lines | Size |
|----------|-------|-------|------|
| **Implementation** | 11 | 1,166 | ~45 KB |
| **Tests** | 1 | 373 | ~12 KB |
| **Documentation** | 6 | ~2,000 | ~60 KB |
| **Total** | 18 | ~3,500 | ~117 KB |

## Support

### Getting Help

1. **Check documentation** - Most questions answered here
2. **Review tests** - See expected usage patterns
3. **Check types** - TypeScript types document the API
4. **Ask team** - Reach out to maintainers

### Common Questions

**Q: Do I need to update my existing code?**
A: No, the old import path still works via re-export.

**Q: Should I use selector hooks?**
A: Yes, for better performance. See [QUICK_REFERENCE.md](./QUICK_REFERENCE.md).

**Q: How do I test code that uses the store?**
A: See examples in `canvas-store.test.ts`.

**Q: Can I add a new slice?**
A: Yes, follow the pattern in [FILE_STRUCTURE.md](./FILE_STRUCTURE.md#maintenance).

**Q: What if I find a bug?**
A: Check the tests first, then file an issue with reproduction steps.

## Version History

### v2.0.0 (Current) - November 2025
- Refactored into 8 focused slices
- Added 60+ KB of documentation
- Added comprehensive test suite
- Improved performance with selector hooks
- Maintained 100% backward compatibility

### v1.0.0 - Previous
- Monolithic canvas-store.ts (945 lines)
- Basic functionality
- Limited documentation

## Credits

**Refactored by**: Claude Code
**Date**: November 2025
**Architecture**: Zustand slice pattern
**Principles**: Single Responsibility, DRY, SOLID

---

**Ready to get started?**
- New users: Start with [README.md](./README.md)
- Migrating: Read [MIGRATION.md](./MIGRATION.md)
- Quick reference: Check [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
