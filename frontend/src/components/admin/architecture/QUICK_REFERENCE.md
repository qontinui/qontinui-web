# Architecture Display - Quick Reference

Quick guide for common updates to the architecture visualization.

## Add New Component (5 minutes)

### 1. Update Type Definition (page.tsx)
```typescript
export type ComponentType =
  | 'existing'
  | 'new-component'  // ← Add here
  | null
```

### 2. Add to Diagram (ArchitectureDiagram.tsx)
```typescript
// In components array:
{
  id: 'new-component',
  name: 'Display Name',
  x: 200, y: 390,           // Position
  width: 200, height: 100,
  color: '#8B5CF6',         // Blue/Green/Purple
  hoverColor: '#7C3AED',
  type: 'service',          // library/application/service
  shortDesc: 'Brief tooltip text',
  dependencies: ['depends-on'],
  dependents: ['depends-on-this'],
}

// In connections array:
{
  from: 'source',
  to: 'new-component',
  fromPos: { x: 300, y: 320 },
  toPos: { x: 300, y: 390 },
  label: 'connection label',
}
```

### 3. Add Details (ComponentDetailPanel.tsx)
```typescript
'new-component': {
  id: 'new-component',
  name: 'Display Name',
  tagline: 'Short description',
  description: 'Full description...',
  technologies: ['Tech1', 'Tech2'],
  features: ['Feature1', 'Feature2'],
  status: 'development',
  repository: 'https://github.com/...',
  keyComponents: ['Module1', 'Module2'],
  useCases: ['Use case 1', 'Use case 2'],
  integrations: [{ name: 'X', description: 'How' }],
  version: '1.0.0',
  analysis: {
    pros: ['Strength 1', 'Strength 2'],
    cons: ['Limitation 1', 'Limitation 2'],
    suggestions: ['Idea 1', 'Idea 2'],
  },
}
```

---

## Update Analysis (2 minutes)

**File**: `ComponentDetailPanel.tsx`

```typescript
'component-name': {
  // ... existing fields ...
  analysis: {
    pros: [
      'Existing strength',
      'New strength',  // ← Add new
    ],
    cons: [
      'Remove resolved issue',  // ← Delete fixed issues
      'New limitation',         // ← Add discovered issues
    ],
    suggestions: [
      'Implemented: Old suggestion',  // ← Mark done
      'New improvement idea',         // ← Add new ideas
    ],
  },
}
```

---

## Move Component (1 minute)

**File**: `ArchitectureDiagram.tsx`

```typescript
// 1. Update component position
{
  id: 'component',
  x: 350,  // ← Change x
  y: 220,  // ← Change y
}

// 2. Update all related connections
{
  from: 'source',
  to: 'component',
  fromPos: { x: 450, y: 150 },  // ← Update
  toPos: { x: 450, y: 220 },    // ← Update
}
```

---

## Add Connection (1 minute)

**File**: `ArchitectureDiagram.tsx`

```typescript
// In connections array:
{
  from: 'component-a',
  to: 'component-b',
  fromPos: {
    x: componentA.x + componentA.width / 2,  // Center bottom
    y: componentA.y + componentA.height
  },
  toPos: {
    x: componentB.x + componentB.width / 2,  // Center top
    y: componentB.y
  },
  label: 'data flow',
  dashed: false,  // true for optional connections
}
```

---

## Update Status (2 minutes)

**File**: `ComponentDetailPanel.tsx`

```typescript
'component': {
  status: 'stable',  // ← Change from 'beta'
  version: '1.0.0',  // ← Update version

  analysis: {
    pros: [
      'Production-ready and battle-tested',  // ← Add
    ],
    cons: [
      // Remove "early stage" mentions
    ],
  },
}
```

---

## Color Reference

```typescript
// Libraries (Blue)
color: '#3B82F6'
hoverColor: '#2563EB'

// Applications (Green)
color: '#10B981'
hoverColor: '#059669'

// Services (Purple)
color: '#8B5CF6'
hoverColor: '#7C3AED'
```

---

## Layout Reference

```
SVG ViewBox: 0 0 600 540

Layers:
- y: 50   → Libraries
- y: 220  → Applications
- y: 390  → Services

Columns:
- x: 50   → Left
- x: 200  → Center
- x: 350  → Right

Size:
- width: 200px
- height: 100px
```

---

## Analysis Guidelines

### Pros (6-7 items)
✅ Specific benefits
✅ Measurable advantages
✅ Technical differentiators
❌ Vague praise

### Cons (5-7 items)
✅ Honest limitations
✅ Known challenges
✅ Tradeoff acknowledgment
❌ Unconstructive criticism

### Suggestions (7-11 items)
✅ Actionable improvements
✅ Specific technologies
✅ Clear value proposition
❌ Vague wishes

---

## Testing Checklist

After any change:

- [ ] Component renders correctly
- [ ] Hover tooltip shows
- [ ] Selection highlights properly
- [ ] Connections point correctly
- [ ] Analysis sections display
- [ ] Mobile layout works
- [ ] No console errors

---

## Common Mistakes

❌ **Typo in component ID**
```typescript
// Diagram
id: 'componet'  // Wrong
// Panel
'component': {  // Doesn't match!
```

✅ **Fix**: Ensure IDs match exactly in all files

---

❌ **Connection outside viewBox**
```typescript
fromPos: { x: 700, y: 100 }  // Outside 600 width!
```

✅ **Fix**: Keep x < 600 and y < 540

---

❌ **Missing required fields**
```typescript
analysis: {
  pros: ['Good'],
  // Missing cons and suggestions!
}
```

✅ **Fix**: Include all three: pros, cons, suggestions

---

## File Locations

```
frontend/src/
├── app/(app)/admin/architecture/
│   └── page.tsx                    ← Main page, types
│
└── components/admin/architecture/
    ├── ArchitectureDiagram.tsx     ← Visual diagram
    ├── ComponentDetailPanel.tsx     ← Details & analysis
    ├── README.md                    ← Full documentation
    └── QUICK_REFERENCE.md           ← This file
```

---

## Need Help?

See `README.md` for:
- Detailed explanations
- Best practices
- Troubleshooting
- Examples
