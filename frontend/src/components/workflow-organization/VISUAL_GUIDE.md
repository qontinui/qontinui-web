# Folder Tree - Visual Guide

## 🎨 Component Layout

```
┌─────────────────────────────────────────────────────┐
│  Workflow Folders                     [↓] [−] [+]  │
│  ┌───────────────────────────────────────────────┐  │
│  │ 🔍 Search folders...                         │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │ [📁 New Folder]  [+] [−]                     │  │
│  └───────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│ 🏠 All Workflows                              [42]  │
│ 📁 Uncategorized                               [3]  │
│                                                      │
│ ▼ 🔵 Authentication                           [12]  │
│   ▶ 🔐 User Management                        [5]   │
│   ▶ 🔑 API Keys                               [7]   │
│                                                      │
│ ▼ 🟢 Forms                                    [15]  │
│   ▶ 📝 Data Entry                             [8]   │
│   ▶ ✅ Validation                             [7]   │
│                                                      │
│ ▶ 🟡 Reports                                  [15]  │
│                                                      │
│ [Creating new folder...]                            │
│ ├─ 📁+ [New Folder Name_____]                       │
│                                                      │
├─────────────────────────────────────────────────────┤
│ Authentication / User Management                    │
└─────────────────────────────────────────────────────┘
```

## 🖱️ Interactions

### Click Actions

```
Single Click on Folder
└─> Selects folder (highlights blue)
    Shows workflows in this folder

Double Click on Folder
└─> Toggles expand/collapse
    Shows/hides child folders

Right Click on Folder
└─> Opens context menu
    ├─ 📁+ New Subfolder
    ├─ ✏️  Rename Folder
    ├─ 🎨 Change Color
    ├─ 🖼️  Change Icon
    ├─ 📦 Move Folder
    └─ 🗑️  Delete Folder
```

### Drag and Drop

```
Drag Folder
┌──────────────┐
│ 📁 My Folder │ ← Dragging
└──────────────┘
       ↓
┌──────────────────────────────┐
│ ▼ 📁 Target Folder           │ ← Drop Target (highlighted)
│   ┌────────────────────────┐ │
│   │ Drop here to move      │ │
│   └────────────────────────┘ │
└──────────────────────────────┘

Drag Workflow
┌──────────────┐
│ ⚙️ Workflow  │ ← Dragging
└──────────────┘
       ↓
┌──────────────────────────────┐
│ ▼ 📁 Folder                  │ ← Drop Target
│   Workflows: [+1]            │
└──────────────────────────────┘
```

## ⌨️ Keyboard Navigation

```
State: Folder selected
┌────────────────────────┐
│ ▼ 📁 Selected Folder   │ ← Selected (blue)
│   ▶ 📁 Child 1         │
│   ▶ 📁 Child 2         │
└────────────────────────┘

Press ↓
┌────────────────────────┐
│ ▼ 📁 Selected Folder   │
│   ▶ 📁 Child 1         │ ← Selected
│   ▶ 📁 Child 2         │
└────────────────────────┘

Press →
┌────────────────────────┐
│ ▼ 📁 Selected Folder   │
│   ▼ 📁 Child 1         │ ← Expanded
│     ▶ 📁 Grandchild    │
│   ▶ 📁 Child 2         │
└────────────────────────┘

Press ←
┌────────────────────────┐
│ ▼ 📁 Selected Folder   │
│   ▶ 📁 Child 1         │ ← Collapsed
│   ▶ 📁 Child 2         │
└────────────────────────┘

Press ← (again)
┌────────────────────────┐
│ ▼ 📁 Selected Folder   │ ← Parent Selected
│   ▶ 📁 Child 1         │
│   ▶ 📁 Child 2         │
└────────────────────────┘

Press Enter
┌────────────────────────┐
│ ▶ 📁 Selected Folder   │ ← Toggled
│                        │
└────────────────────────┘

Press Delete
┌──────────────────────────────┐
│ Delete "Selected Folder"?    │
│  [Cancel]  [Delete]          │
└──────────────────────────────┘
```

## 🎨 Color Picker

```
Right Click > Change Color

┌─────────────────────────┐
│ Choose Color        [×] │
├─────────────────────────┤
│ ┌─┬─┬─┬─┬─┐            │
│ │🔵│🟢│🟡│🔴│🟣│            │
│ └─┴─┴─┴─┴─┘            │
│ ┌─┬─┬─┬─┬─┐            │
│ │💗│💙│💚│🟠│🔵│            │
│ └─┴─┴─┴─┴─┘            │
│                         │
│ [Reset to Default]      │
└─────────────────────────┘
```

## 🖼️ Icon Picker

```
Right Click > Change Icon

┌─────────────────────────┐
│ Choose Icon         [×] │
├─────────────────────────┤
│ ┌─┬─┬─┬─┬─┐            │
│ │📁│📂│📦│🗂️│📋│            │
│ └─┴─┴─┴─┴─┘            │
│ ┌─┬─┬─┬─┬─┐            │
│ │⭐│❤️│🛡️│🔖│🏷️│            │
│ └─┴─┴─┴─┴─┘            │
│                         │
│ [Reset to Default]      │
└─────────────────────────┘
```

## 📝 Inline Editing

```
Before Edit:
┌────────────────────────┐
│ ▶ 📁 My Folder    [⋮]  │ ← Hover shows menu
└────────────────────────┘

Click Rename:
┌────────────────────────┐
│ ▶ 📁 [My Folder____]   │ ← Input field active
└────────────────────────┘
    ↓ Press Enter or blur

After Edit:
┌────────────────────────┐
│ ▶ 📁 New Name     [⋮]  │
└────────────────────────┘
```

## 🔍 Search

```
Default View:
┌─────────────────────────┐
│ 🔍 Search folders...    │
└─────────────────────────┘
│ ▶ 📁 Authentication     │
│ ▶ 📁 Forms              │
│ ▶ 📁 Reports            │
│ ▶ 📁 Testing            │

Type "auth":
┌─────────────────────────┐
│ 🔍 auth_____            │
└─────────────────────────┘
│ ▼ 📁 Authentication     │ ← Auto-expanded, matches
│   ▶ 📁 User Management  │

Type "test":
┌─────────────────────────┐
│ 🔍 test_____            │
└─────────────────────────┘
│ ▶ 📁 Testing            │ ← Matches
│
│ No folders found        │ ← If no matches
```

## 📊 Badges

```
Workflow Count Badges:

Direct count only:
┌────────────────────────┐
│ ▶ 📁 Folder        [5] │ ← 5 workflows in this folder
└────────────────────────┘

Total count (including subfolders):
┌────────────────────────┐
│ ▼ 📁 Parent       [15] │ ← 15 total workflows
│   ▶ 📁 Child 1    [8]  │
│   ▶ 📁 Child 2    [7]  │
└────────────────────────┘
```

## 🎯 States

### Empty State

```
┌─────────────────────────────┐
│                             │
│         📁                  │
│    No folders yet           │
│                             │
│ [Create your first folder]  │
│                             │
└─────────────────────────────┘
```

### Loading State (if implemented)

```
┌─────────────────────────────┐
│ ▢ ▢▢▢▢▢▢▢▢▢ ▢▢             │
│ ▢ ▢▢▢▢▢▢▢ ▢                │
│ ▢ ▢▢▢▢▢▢▢▢▢▢ ▢▢            │
└─────────────────────────────┘
```

### Error State (if implemented)

```
┌─────────────────────────────┐
│         ⚠️                  │
│  Failed to load folders     │
│                             │
│      [Try Again]            │
└─────────────────────────────┘
```

## 🎭 Hover Effects

```
Default (no hover):
┌────────────────────────┐
│ ▶ 📁 Folder            │
└────────────────────────┘

Hover:
┌────────────────────────┐
│ ▶ 📁 Folder       [⋮]  │ ← Menu appears
└────────────────────────┘
  ↑ Background highlight

Active (selected):
┌────────────────────────┐
│ ▶ 📁 Folder       [⋮]  │ ← Blue background
└────────────────────────┘
```

## 📱 Responsive Design

```
Desktop (Wide):
┌──────────────────────────┬───────────────────────────┐
│ 📁 Folder Tree           │ Workflow List             │
│ (320px - 400px)          │ (Remaining width)         │
│                          │                           │
│ ▼ 📁 Authentication      │ • Login Workflow          │
│   ▶ 📁 User Management   │ • 2FA Workflow            │
│   ▶ 📁 API Keys          │ • Password Reset          │
│                          │                           │
└──────────────────────────┴───────────────────────────┘

Mobile (Narrow):
┌──────────────────────┐
│ [≡] Folders          │
└──────────────────────┘
        ↓
┌──────────────────────┐
│ Workflow List        │
│                      │
│ • Login Workflow     │
│ • 2FA Workflow       │
│ • Password Reset     │
└──────────────────────┘
```

## 🎨 Color Scheme

### Light Mode

```
Background:      #ffffff (white)
Hover:          #f3f4f6 (gray-100)
Selected:       #e0e7ff (indigo-100)
Border:         #e5e7eb (gray-200)
Text:           #111827 (gray-900)
Muted Text:     #6b7280 (gray-500)
```

### Dark Mode

```
Background:      #1f2937 (gray-800)
Hover:          #374151 (gray-700)
Selected:       #312e81 (indigo-900)
Border:         #4b5563 (gray-600)
Text:           #f9fafb (gray-50)
Muted Text:     #9ca3af (gray-400)
```

## 🎬 Animations

### Expand/Collapse

```
Collapsed ▶       Expanding...        Expanded ▼
┌─────────┐       ┌─────────┐        ┌─────────┐
│ ▶ Folder│  =>   │ ▽ Folder│   =>   │ ▼ Folder│
└─────────┘       │   Child │        │   Child │
                  └─────────┘        └─────────┘
  0ms               150ms              300ms
```

### Drag Preview

```
Start Drag        Dragging            Drop
┌─────────┐      ┌─────────┐        ┌─────────┐
│ 📁 Folder│  =>  │ 📁 Folder│   =>   │         │
└─────────┘      └─────────┘        └─────────┘
  Normal       Shadow + 50%          Success
               opacity
```

## 🔗 Integration Points

```
┌─────────────────────────────────────────────────────┐
│                  Application                         │
│                                                      │
│  ┌────────────────┐  ┌───────────────────────────┐ │
│  │                │  │                           │ │
│  │  FolderTree    │  │   WorkflowList            │ │
│  │                │  │                           │ │
│  │  onSelectFolder│──>│   filteredWorkflows      │ │
│  │                │  │                           │ │
│  └────────────────┘  └───────────────────────────┘ │
│         ↕                      ↕                    │
│  ┌────────────────────────────────────────────────┐│
│  │           WorkflowFileManager                  ││
│  │           (Backend/Storage)                    ││
│  └────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

## 📏 Dimensions

```
Component Height: 100% (fills container)
Component Width:  320px - 400px (recommended)
Min Width:        280px
Max Height:       None (scrollable)

Tree Item Height: 32px
Indent Width:     20px per level
Icon Size:        16px (h-4 w-4)
Badge Size:       Auto (text-xs)
```

## ✨ Visual Hierarchy

```
Level 0 (Root)
│
├─ Level 1 (indent: 0px)
│  │
│  ├─ Level 2 (indent: 20px)
│  │  │
│  │  └─ Level 3 (indent: 40px)
│  │     │
│  │     └─ Level 4 (indent: 60px)
│  │
│  └─ Level 2 (indent: 20px)
│
└─ Level 1 (indent: 0px)
```

---

This visual guide provides a comprehensive overview of the FolderTree component's appearance and behavior.
