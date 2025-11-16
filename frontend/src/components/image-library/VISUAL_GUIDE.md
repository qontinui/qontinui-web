# Enhanced Image Library - Visual Guide

ASCII art visualization of the component layout and features.

## Main Layout

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  Enhanced Image Library                          [Search...] [≡][▦][▶] [━] [Upload] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Filters: [Source: ●All ●Upload ●Pattern ●Extract ●Discover] [Usage: ●All ●Used ●Unused] │
├──────────┬──────────────────────────────────────────────────────────────────┬───────┤
│  [Tab:   │                                                                  │ Image │
│  Library]│  ┌────┬────┬────┬────┐  ┌────┬────┬────┬────┐                  │Details│
│          │  │    │    │    │    │  │    │    │    │    │                  │       │
│  📁 All  │  │ ☑  │ ☑  │    │    │  │    │    │    │    │                  │ ┌───┐ │
│  Images  │  │ 📷 │ 📷 │ 📷 │ 📷 │  │ 📷 │ 📷 │ 📷 │ 📷 │                  │ │   │ │
│  (128)   │  │    │    │    │    │  │    │    │    │    │                  │ │ 📷│ │
│          │  │btn │icon│bg  │logo│  │menu│nav │tab │card│                  │ │   │ │
│  [+New]  │  └────┴────┴────┴────┘  └────┴────┴────┴────┘                  │ └───┘ │
│          │                                                                  │       │
│  📁 UI   │  ┌────┬────┬────┬────┐  ┌────┬────┬────┬────┐                  │ Name: │
│  ├─ 📂   │  │    │    │    │    │  │    │    │    │    │                  │button │
│  │  Btns│  │ 📷 │ 📷 │ 📷 │ 📷 │  │ 📷 │ 📷 │ 📷 │ 📷 │                  │-icon  │
│  │  (24)│  │    │    │    │    │  │    │    │    │    │                  │       │
│  ├─ 📂   │  └────┴────┴────┴────┘  └────┴────┴────┴────┘                  │ Size: │
│  │  Icon│                                                                  │ 245KB │
│  │  (18)│  [Load More...]                                                 │       │
│  └─ 📂   │                                                                  │ Date: │
│     Bgnd │                                                                  │Jan 14 │
│     (12) │                                                                  │       │
│          │                                                                  │Source:│
│  📁 Scrn │                                                                  │Upload │
│  shots   │                                                                  │       │
│  (32)    │                                                                  │Usage: │
│          │                                                                  │  3x   │
│  [Coll-  │                                                                  │       │
│  ections]│                                                                  │ Used  │
│          │                                                                  │ in:   │
│  📦 Login│                                                                  │• Home │
│     (8)  │                                                                  │• Nav  │
│  📦 Dash │                                                                  │       │
│     (15) │                                                                  │[Edit] │
│  📦 Forms│                                                                  │[Down] │
│     (12) │                                                                  │ [Del] │
│          │                                                                  │       │
│  [+New]  │                                                                  │  [X]  │
└──────────┴──────────────────────────────────────────────────────────────────┴───────┘
  256px        Flex-1 (Center Area)                                            320px
```

## With Bulk Operations Active

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  Enhanced Image Library                          [Search...] [≡][▦][▶] [━] [Upload] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  ⚡ 5 Selected  [Move to...▾] [Add Tags] [Add to Collection▾] [Download] [Delete] [X]│
├──────────┬──────────────────────────────────────────────────────────────────┬───────┤
│          │  ┌────┬────┬────┬────┐  ┌────┬────┬────┬────┐                  │       │
│  Folders │  │ ✓  │ ✓  │    │    │  │ ✓  │    │ ✓  │    │                  │ (No   │
│  &       │  │ 📷 │ 📷 │ 📷 │ 📷 │  │ 📷 │ 📷 │ 📷 │ 📷 │                  │ image │
│  Coll-   │  │    │    │    │    │  │    │    │    │    │                  │ sel.) │
│  ections │  │    │    │    │    │  │    │    │    │ ✓  │                  │       │
│          │  └────┴────┴────┴────┘  └────┴────┴────┴────┘                  │       │
│          │     ↑       ↑              ↑       ↑                            │       │
│          │  Selected images are highlighted with checkmarks                │       │
└──────────┴──────────────────────────────────────────────────────────────────┴───────┘
```

## List View Mode

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  Enhanced Image Library                          [Search...] [≡][▦][▶] [━] [Upload] │
├──────────┬──────────────────────────────────────────────────────────────────────────┤
│ Folders  │ ☐  [Img]  Name           Source        Size   Usage  Date        [Del]   │
│          ├──────────────────────────────────────────────────────────────────────────┤
│ 📁 All   │ ☐  [📷]  button-icon     ●Upload       245KB   3x    Jan 14      🗑      │
│ 📁 UI    │ ☐  [📷]  menu-bg         ●Pattern      128KB   1x    Jan 14      🗑      │
│ 📁 Scrn  │ ☑  [📷]  logo-main       ●Upload       512KB   8x    Jan 13      🗑      │
│          │ ☐  [📷]  nav-icon        ●Extract       64KB   2x    Jan 13      🗑      │
│          │ ☐  [📷]  card-header     ●Discovery     96KB   0x    Jan 12      🗑      │
│          │ ☐  [📷]  footer-bg       ●Upload       384KB   1x    Jan 12      🗑      │
│          │ ☐  [📷]  tab-active      ●Pattern       48KB   5x    Jan 11      🗑      │
│          │ ☐  [📷]  alert-icon      ●Upload        32KB   3x    Jan 11      🗑      │
│          │ ...                                                                       │
└──────────┴──────────────────────────────────────────────────────────────────────────┘
```

## Folder Tree Expanded

```
📁 All Images (128)
├─ 📂 UI Components (54)              [●Blue]
│  ├─ 📂 Buttons (24)                 [●Green]
│  ├─ 📂 Icons (18)                   [●Amber]
│  └─ 📂 Backgrounds (12)             [●Purple]
├─ 📂 Screenshots (32)                [●Red]
│  ├─ 📂 Desktop (18)                 [●Cyan]
│  └─ 📂 Mobile (14)                  [●Pink]
├─ 📂 Generated (28)                  [●Orange]
│  ├─ 📂 Pattern Opt (15)             [●Lime]
│  └─ 📂 Extracted (13)               [●Indigo]
└─ 📂 Archive (14)                    [●Gray]
   └─ 📂 Old Designs (14)             [●Gray]
```

## Collections View

```
┌─────────────────────┐
│ [+] New Collection  │
├─────────────────────┤
│ 📦 Login Screen     │
│ ┌───┬───┐           │
│ │ 📷│ 📷│  8 images │
│ ├───┼───┤           │
│ │ 📷│ 📷│    [⋮]    │
│ └───┴───┘           │
├─────────────────────┤
│ 📦 Dashboard        │
│ ┌───┬───┐           │
│ │ 📷│ 📷│ 15 images │
│ ├───┼───┤           │
│ │ 📷│ 📷│    [⋮]    │
│ └───┴───┘           │
├─────────────────────┤
│ 📦 Forms & Inputs   │
│ ┌───┬───┐           │
│ │ 📷│ 📷│ 12 images │
│ ├───┼───┤           │
│ │ 📷│ 📷│    [⋮]    │
│ └───┴───┘           │
└─────────────────────┘
```

## Filter Panel (Expanded)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Filters                                                          [Clear All]     │
├──────────────┬──────────────┬──────────────┬──────────────┬────────────────────┤
│ Source       │ Usage        │ Date Range   │ Size         │ Tags               │
│              │              │              │              │                    │
│ ●All (128)   │ ●All (128)   │ From:        │ Min: ___KB   │ [Search tags...]   │
│ ●Upload (82) │ ●Used (95)   │ [date▾]      │              │                    │
│ ●Pattern(24) │ ●Unused (33) │              │ Max: ___KB   │ ●ui (45)           │
│ ●Extract(14) │              │ To:          │              │ ●button (24)       │
│ ●Discov (8)  │              │ [date▾]      │              │ ●icon (18)         │
│              │              │              │              │ ●bg (12)           │
└──────────────┴──────────────┴──────────────┴──────────────┴────────────────────┘
```

## Image Grid Sizes

### Small (80px cards, 20 columns)
```
┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐
│📷│📷│📷│📷│📷│📷│📷│📷│📷│📷│📷│📷│📷│📷│📷│📷│📷│📷│📷│📷│
└──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘
```

### Medium (128px cards, 10 columns) - Default
```
┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
│    │    │    │    │    │    │    │    │    │    │
│ 📷 │ 📷 │ 📷 │ 📷 │ 📷 │ 📷 │ 📷 │ 📷 │ 📷 │ 📷 │
│Name│Name│Name│Name│Name│Name│Name│Name│Name│Name│
│Size│Size│Size│Size│Size│Size│Size│Size│Size│Size│
│ 3x │ 1x │ 0x │ 5x │ 2x │ 8x │ 1x │ 4x │ 0x │ 6x │
└────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘
```

### Large (192px cards, 5 columns)
```
┌────────┬────────┬────────┬────────┬────────┐
│        │        │        │        │        │
│        │        │        │        │        │
│   📷   │   📷   │   📷   │   📷   │   📷   │
│        │        │        │        │        │
│        │        │        │        │        │
│ Name   │ Name   │ Name   │ Name   │ Name   │
│ Size   │ Size   │ Size   │ Size   │ Size   │
│ [3x]   │ [1x]   │ [0x]   │ [5x]   │ [2x]   │
│ Upload │Pattern │Extract │Upload │Discov  │
└────────┴────────┴────────┴────────┴────────┘
```

## Image Card States

### Normal State
```
┌────────────┐
│            │
│            │
│     📷     │
│            │
│            │
├────────────┤
│button-icon │
│   245 KB   │
│  3x Upload │
└────────────┘
```

### Hover State
```
┌────────────┐
│    [✓]     │  ← Checkbox appears
│   ┌────┐   │
│   │ 📷 │   │
│   │▓▓▓▓│   │  ← Dark overlay
│   └────┘   │
│  [Edit][Del] ← Actions appear
├────────────┤
│button-icon │
│   245 KB   │
│  3x Upload │
└────────────┘
```

### Selected State
```
┌════════════┐  ← Ring highlight
║  [✓]       ║
║   ┌────┐   ║
║   │ 📷 │   ║
║   │    │   ║
║   └────┘   ║
║            ║
╠════════════╣
║button-icon ║
║   245 KB   ║
║  3x Upload ║
╚════════════╝
```

## Upload Flow

### Step 1: Drag Files
```
┌─────────────────────────────────────────┐
│                                         │
│   ╔═══════════════════════════════╗    │
│   ║                               ║    │
│   ║         ⬆ Upload              ║    │
│   ║                               ║    │
│   ║   Drag & drop images here    ║    │
│   ║   or click to browse files   ║    │
│   ║                               ║    │
│   ╚═══════════════════════════════╝    │
│          ↑ Green border when active    │
└─────────────────────────────────────────┘
```

### Step 2: Upload Progress
```
┌─────────────────────────────────────────┐
│ ⏫ Uploading 3 files...                  │
│ ━━━━━━━━━━━━━━━━━━━━ 100% button.png   │
│ ━━━━━━━━━━━━━━░░░░░░  65% icon.svg     │
│ ━━━░░░░░░░░░░░░░░░░░  15% logo.jpg     │
└─────────────────────────────────────────┘
```

### Step 3: Complete
```
┌─────────────────────────────────────────┐
│ ✓ Upload complete - 3 images added     │
└─────────────────────────────────────────┘
  ↓ Images appear in grid
┌────┬────┬────┐
│ 📷 │ 📷 │ 📷 │ ← New images
│ New│ New│ New│
└────┴────┴────┘
```

## Image Details Panel

```
┌─────────────────────────┐
│ Image Details       [X] │
├─────────────────────────┤
│ ┌───────────────────┐   │
│ │                   │   │
│ │                   │   │
│ │        📷         │   │
│ │                   │   │
│ │                   │   │
│ └───────────────────┘   │
│                         │
│ button-icon.png         │
│                         │
├─────────────────────────┤
│ 💾 Size: 245 KB         │
│ 📅 Date: Jan 14, 2025   │
│ 📦 Source: [Upload]     │
│ 🔗 Usage: [3x]          │
├─────────────────────────┤
│ Used In:                │
│                         │
│ 👁 State: Home          │
│ 🔗 Workflow: Nav        │
│ 👁 State: Settings      │
├─────────────────────────┤
│ [Edit Mask]             │
│ [Download]              │
│ [Delete]                │
└─────────────────────────┘
```

## Color Coding

```
Source Badges:
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ Upload  │ │Pattern  │ │ Extract │ │Discover │
│ #00FF88 │ │ #00D9FF │ │ #BD00FF │ │ #FFB800 │
│ Green   │ │  Cyan   │ │ Purple  │ │  Amber  │
└─────────┘ └─────────┘ └─────────┘ └─────────┘

Folder Colors (User-selectable):
🔵 Blue   🟢 Green  🟡 Amber  🔴 Red    🟣 Purple
🩷 Pink   🔵 Cyan   🟢 Lime   🟠 Orange 🔵 Indigo

Usage Badges:
┌─────┐ ┌─────┐
│  3x │ │  0x │
│Green│ │ Gray│
│Used │ │None │
└─────┘ └─────┘
```

## Responsive Breakpoints

```
Mobile (< 768px):
┌──────────────────┐
│ [Hamburger Menu] │  ← Sidebar collapses
│                  │
│ ┌──┬──┬──┬──┐   │  ← Grid: 4 columns
│ │📷│📷│📷│📷│   │
│ └──┴──┴──┴──┘   │
└──────────────────┘

Tablet (768-1024px):
┌────────┬──────────────────┐
│ Folder │ ┌──┬──┬──┬──┐   │  ← Grid: 6 columns
│ Tree   │ │📷│📷│📷│📷│   │
│        │ └──┴──┴──┴──┘   │
└────────┴──────────────────┘

Desktop (> 1024px):
┌────┬──────────────────┬──────┐
│Fold│ ┌──┬──┬──┬──┐   │Detail│  ← Grid: 8-10 columns
│Tree│ │📷│📷│📷│📷│   │Panel │
│    │ └──┴──┴──┴──┘   │      │
└────┴──────────────────┴──────┘
```

## User Interactions

### Click Image
```
Click → Select image → Details panel opens →
```

### Checkbox Image
```
Click ☐ → ☑ Selected → Bulk toolbar appears →
```

### Drag & Drop
```
Grab image card → Drag to folder → Drop → Image moved
```

### Create Folder
```
Click [+ New Folder] → Input appears → Type name → Enter → Folder created
```

### Rename Folder
```
Click folder [...] → Rename → Input appears → Type → Enter → Renamed
```

### Upload Files
```
Click [Upload] OR Drag files → Select → Upload progress → Complete → Images added
```

### Bulk Delete
```
Select images → Click [Delete] → Confirm → Images deleted → Toast shown
```

## Empty States

### No Images
```
┌─────────────────────────────────────┐
│                                     │
│          📷 (gray icon)             │
│                                     │
│       No images uploaded            │
│                                     │
│  Upload images to use in your       │
│  automation workflows               │
│                                     │
│          [Upload Button]            │
│                                     │
└─────────────────────────────────────┘
```

### No Folders
```
┌─────────────────────┐
│ 📁 All Images       │
│                     │
│ (No folders yet)    │
│                     │
│ [+ New Folder]      │
└─────────────────────┘
```

### No Collections
```
┌─────────────────────┐
│ (No collections)    │
│                     │
│ Create collections  │
│ to organize images  │
│ by feature/screen   │
│                     │
│ [+ New Collection]  │
└─────────────────────┘
```

### No Search Results
```
┌─────────────────────────────────────┐
│                                     │
│          🔍 (gray icon)             │
│                                     │
│       No images found               │
│                                     │
│  Try adjusting your search query    │
│  or clearing filters                │
│                                     │
└─────────────────────────────────────┘
```

## Animation & Transitions

```
Hover: 200ms ease-in-out
Selection: Ring appears instantly
Drag: Follow cursor smoothly
Upload Progress: Smooth bar animation
Panel Open: Slide from right (300ms)
Folder Expand: Rotate chevron (200ms)
Toast: Slide from top (300ms)
```

## Keyboard Navigation (Future)

```
Tab         → Navigate interactive elements
Enter       → Activate button/select image
Space       → Toggle checkbox
Cmd/Ctrl+A  → Select all images
Delete      → Delete selected (with confirm)
Escape      → Clear selection / Close panel
Arrow Keys  → Navigate grid
Cmd/Ctrl+F  → Focus search
```

---

This visual guide helps understand the layout and user experience of the Enhanced Image Library.
