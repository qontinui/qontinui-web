# Qontinui Component Library

Pre-themed React components following the dark gaming aesthetic of the Qontinui application.

## Overview

This component library provides ready-to-use components that automatically apply the Qontinui dark theme. All components extend the base shadcn/ui components with consistent styling based on the State Structure interface design.

## Installation

Components are already available in your project. Simply import them:

```tsx
import { UploadButton, QontinuiCard, QontinuiInput } from '@/components/qontinui';
```

## All Components

- **Buttons**: `QontinuiButton`, `UploadButton`, `CreateButton`, `DevelopButton`, `GhostButton`
- **Cards**: `QontinuiCard`, `QontinuiCardHeader`, `QontinuiCardTitle`, `QontinuiCardDescription`, `QontinuiCardContent`, `QontinuiCardFooter`, `QontinuiCardAction`
- **Form Inputs**: `QontinuiInput`, `QontinuiSelect`, `QontinuiTextarea`
- **Dialogs**: `Dialog`, `DialogTrigger`, `DialogClose`, `QontinuiDialogContent`, `QontinuiDialogHeader`, `QontinuiDialogTitle`, `QontinuiDialogDescription`, `QontinuiDialogFooter`
- **Layout**: `QontinuiPage`, `QontinuiHeader`, `QontinuiHeaderTitle`, `QontinuiHeaderActions`, `QontinuiMain`, `QontinuiContainer`, `QontinuiSidebar`, `QontinuiToolbar`, `QontinuiSection`

## Component Reference

### Buttons

#### QontinuiButton

The base themed button component with variant support.

**Props:**
- `qontinuiVariant`: `"cyan" | "green" | "purple" | "ghost"` - Color variant
- All standard button props from shadcn/ui

**Example:**
```tsx
import { QontinuiButton } from '@/components/qontinui';

<QontinuiButton qontinuiVariant="cyan" onClick={handleClick}>
  Click Me
</QontinuiButton>
```

#### Pre-configured Button Variants

For common use cases, use these semantic button components:

**UploadButton** - Cyan button for upload actions
```tsx
import { UploadButton } from '@/components/qontinui';

<UploadButton onClick={handleUpload}>
  Upload Screenshots
</UploadButton>
```

**CreateButton** - Green button for create actions
```tsx
import { CreateButton } from '@/components/qontinui';

<CreateButton onClick={handleCreate}>
  Create New State
</CreateButton>
```

**DevelopButton** - Purple button for develop/state actions
```tsx
import { DevelopButton } from '@/components/qontinui';

<DevelopButton onClick={handleDevelop}>
  Develop Automation
</DevelopButton>
```

**GhostButton** - Transparent button for secondary actions
```tsx
import { GhostButton } from '@/components/qontinui';

<GhostButton onClick={handleCancel}>
  Cancel
</GhostButton>
```

### Cards

#### QontinuiCard

Themed card component with optional selection and hover states.

**Props:**
- `selected`: `boolean` - Whether the card is selected (shows cyan border)
- `hoverable`: `boolean` - Whether the card has hover effects (default: true)
- All standard div props

**Example:**
```tsx
import {
  QontinuiCard,
  QontinuiCardHeader,
  QontinuiCardTitle,
  QontinuiCardDescription,
  QontinuiCardContent,
  QontinuiCardFooter,
} from '@/components/qontinui';

<QontinuiCard selected={isSelected} hoverable>
  <QontinuiCardHeader>
    <QontinuiCardTitle>Screenshot 1</QontinuiCardTitle>
    <QontinuiCardDescription>
      Captured at 2024-10-20 14:30
    </QontinuiCardDescription>
  </QontinuiCardHeader>
  <QontinuiCardContent>
    <img src="/path/to/screenshot.png" alt="Screenshot" />
  </QontinuiCardContent>
  <QontinuiCardFooter>
    <span className="text-gray-400 text-sm">1920x1080</span>
  </QontinuiCardFooter>
</QontinuiCard>
```

### Inputs

#### QontinuiInput

Themed input component with optional label and error message.

**Props:**
- `label`: `string` - Optional label text
- `error`: `string` - Optional error message
- All standard input props from shadcn/ui

**Example:**
```tsx
import { QontinuiInput } from '@/components/qontinui';

<QontinuiInput
  label="State Name"
  placeholder="Enter state name..."
  error={errors.name}
  value={stateName}
  onChange={(e) => setStateName(e.target.value)}
/>
```

**Without label:**
```tsx
<QontinuiInput
  placeholder="Search..."
  value={searchQuery}
  onChange={(e) => setSearchQuery(e.target.value)}
/>
```

### Selects

#### QontinuiSelect

Themed select/dropdown component with label and error support.

**Props:**
- `label`: `string` - Optional label text
- `error`: `string` - Optional error message
- `placeholder`: `string` - Placeholder text
- `options`: `Array<{value: string, label: string}>` - Select options
- `value`: `string` - Current value
- `onValueChange`: `(value: string) => void` - Change handler
- `disabled`: `boolean` - Whether disabled

**Example:**
```tsx
import { QontinuiSelect } from '@/components/qontinui';

<QontinuiSelect
  label="Select State"
  placeholder="Choose a state..."
  options={[
    { value: "login", label: "Login State" },
    { value: "dashboard", label: "Dashboard State" },
  ]}
  value={selectedState}
  onValueChange={setSelectedState}
  error={errors.state}
/>
```

### Textareas

#### QontinuiTextarea

Themed textarea component with label and error support.

**Props:**
- `label`: `string` - Optional label text
- `error`: `string` - Optional error message
- All standard textarea props

**Example:**
```tsx
import { QontinuiTextarea } from '@/components/qontinui';

<QontinuiTextarea
  label="Description"
  placeholder="Enter description..."
  rows={4}
  value={description}
  onChange={(e) => setDescription(e.target.value)}
  error={errors.description}
/>
```

### Dialogs

#### Qontinui Dialog Components

Themed dialog components for modal interactions.

**Components:**
- `Dialog` - Root dialog component (re-exported from shadcn/ui)
- `DialogTrigger` - Trigger button (re-exported from shadcn/ui)
- `DialogClose` - Close button (re-exported from shadcn/ui)
- `QontinuiDialogContent` - Themed dialog content container
- `QontinuiDialogHeader` - Dialog header section
- `QontinuiDialogTitle` - Themed dialog title
- `QontinuiDialogDescription` - Themed dialog description
- `QontinuiDialogFooter` - Dialog footer section

**Example:**
```tsx
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  QontinuiDialogContent,
  QontinuiDialogHeader,
  QontinuiDialogTitle,
  QontinuiDialogDescription,
  QontinuiDialogFooter,
  UploadButton,
  GhostButton,
} from '@/components/qontinui';

<Dialog>
  <DialogTrigger asChild>
    <UploadButton>Open Settings</UploadButton>
  </DialogTrigger>
  <QontinuiDialogContent>
    <QontinuiDialogHeader>
      <QontinuiDialogTitle>Configuration</QontinuiDialogTitle>
      <QontinuiDialogDescription>
        Adjust your automation settings
      </QontinuiDialogDescription>
    </QontinuiDialogHeader>
    <div className="py-4">
      {/* Dialog content */}
    </div>
    <QontinuiDialogFooter>
      <DialogClose asChild>
        <GhostButton>Cancel</GhostButton>
      </DialogClose>
      <CreateButton onClick={handleSave}>Save Changes</CreateButton>
    </QontinuiDialogFooter>
  </QontinuiDialogContent>
</Dialog>
```

### Layout Components

Pre-configured layout components for building consistent page structures.

#### QontinuiPage

Full-screen page container with dark canvas background.

```tsx
import { QontinuiPage } from '@/components/qontinui';

<QontinuiPage>
  {/* Page content */}
</QontinuiPage>
```

#### QontinuiHeader

Themed header with dark panel background and bottom border.

```tsx
import { QontinuiHeader, QontinuiHeaderTitle, QontinuiHeaderActions } from '@/components/qontinui';

<QontinuiHeader>
  <div className="flex items-center justify-between">
    <QontinuiHeaderTitle subtitle="Optional subtitle">
      Page Title
    </QontinuiHeaderTitle>
    <QontinuiHeaderActions>
      <CreateButton>Create New</CreateButton>
    </QontinuiHeaderActions>
  </div>
</QontinuiHeader>
```

#### QontinuiMain

Main content area with scrolling support.

```tsx
import { QontinuiMain } from '@/components/qontinui';

<QontinuiMain>
  {/* Scrollable content */}
</QontinuiMain>
```

#### QontinuiContainer

Centered container with max-width constraint.

**Props:**
- `maxWidth`: `"sm" | "md" | "lg" | "xl" | "2xl" | "full"` - Maximum width (default: "7xl")

```tsx
import { QontinuiContainer } from '@/components/qontinui';

<QontinuiContainer maxWidth="lg">
  {/* Centered content */}
</QontinuiContainer>
```

#### QontinuiSidebar

Themed sidebar with dark panel background.

```tsx
import { QontinuiSidebar } from '@/components/qontinui';

<QontinuiSidebar>
  {/* Sidebar content */}
</QontinuiSidebar>
```

#### QontinuiSection

Content section with optional title and description.

```tsx
import { QontinuiSection } from '@/components/qontinui';

<QontinuiSection title="Section Title" description="Optional description">
  {/* Section content */}
</QontinuiSection>
```

#### QontinuiToolbar

Toolbar section similar to header but reusable anywhere.

```tsx
import { QontinuiToolbar } from '@/components/qontinui';

<QontinuiToolbar>
  {/* Toolbar content */}
</QontinuiToolbar>
```

#### Complete Layout Example

```tsx
import {
  QontinuiPage,
  QontinuiHeader,
  QontinuiHeaderTitle,
  QontinuiHeaderActions,
  QontinuiMain,
  QontinuiContainer,
  QontinuiSidebar,
  QontinuiSection,
  CreateButton,
} from '@/components/qontinui';

export default function MyPage() {
  return (
    <QontinuiPage>
      <QontinuiHeader>
        <div className="flex items-center justify-between">
          <QontinuiHeaderTitle subtitle="Manage your automation">
            My Page
          </QontinuiHeaderTitle>
          <QontinuiHeaderActions>
            <CreateButton>Create New</CreateButton>
          </QontinuiHeaderActions>
        </div>
      </QontinuiHeader>

      <div className="flex flex-1 overflow-hidden">
        <QontinuiSidebar>
          {/* Sidebar navigation */}
        </QontinuiSidebar>

        <QontinuiMain>
          <QontinuiContainer>
            <QontinuiSection title="My Section" description="Section description">
              {/* Section content */}
            </QontinuiSection>
          </QontinuiContainer>
        </QontinuiMain>
      </div>
    </QontinuiPage>
  );
}
```

## Complete Page Example

Here's a complete example showing how to build a page with Qontinui components:

```tsx
"use client";

import { useState } from 'react';
import {
  QontinuiCard,
  QontinuiCardHeader,
  QontinuiCardTitle,
  QontinuiCardDescription,
  QontinuiCardContent,
  UploadButton,
  CreateButton,
  QontinuiInput,
  Dialog,
  DialogTrigger,
  QontinuiDialogContent,
  QontinuiDialogHeader,
  QontinuiDialogTitle,
  QontinuiDialogFooter,
  GhostButton,
} from '@/components/qontinui';
import { styles } from '@/config/theme';

export default function MyPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = [
    { id: '1', title: 'Item 1', description: 'First item' },
    { id: '2', title: 'Item 2', description: 'Second item' },
  ];

  return (
    <div className="h-screen bg-[#0A0A0B] text-white flex flex-col">
      {/* Header */}
      <header className="bg-[#27272A] border-b border-gray-800 p-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">My Page</h1>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <CreateButton>Create New</CreateButton>
            </DialogTrigger>
            <QontinuiDialogContent>
              <QontinuiDialogHeader>
                <QontinuiDialogTitle>Create Item</QontinuiDialogTitle>
              </QontinuiDialogHeader>
              <div className="py-4">
                <QontinuiInput label="Name" placeholder="Enter name..." />
              </div>
              <QontinuiDialogFooter>
                <GhostButton>Cancel</GhostButton>
                <CreateButton>Create</CreateButton>
              </QontinuiDialogFooter>
            </QontinuiDialogContent>
          </Dialog>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Search */}
          <QontinuiInput
            placeholder="Search items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          {/* Items grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <QontinuiCard
                key={item.id}
                selected={selectedId === item.id}
                onClick={() => setSelectedId(item.id)}
                className="cursor-pointer"
              >
                <QontinuiCardHeader>
                  <QontinuiCardTitle>{item.title}</QontinuiCardTitle>
                  <QontinuiCardDescription>
                    {item.description}
                  </QontinuiCardDescription>
                </QontinuiCardHeader>
                <QontinuiCardContent>
                  Content goes here
                </QontinuiCardContent>
              </QontinuiCard>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

## Styling & Customization

All components accept a `className` prop for additional styling. The theme styles are applied first, so you can override them if needed:

```tsx
<UploadButton className="w-full">
  Full Width Upload
</UploadButton>

<QontinuiCard className="hover:scale-105 transition-transform">
  Animated Card
</QontinuiCard>
```

## Color Reference

The components use these theme colors automatically:

- **Canvas**: `#0A0A0B` - Main background
- **Panel**: `#27272A` - Cards, headers, panels
- **Cyan**: `#00D9FF` - Upload, primary actions
- **Green**: `#00FF88` - Create, success actions
- **Purple**: `#BD00FF` - Develop, state actions
- **Borders**: `gray-700`, `gray-800`
- **Text**: `white`, `gray-300`, `gray-400`, `gray-500`

## Integration with Theme System

These components automatically use the theme configuration from `/src/config/theme.ts`. If you need direct access to theme tokens:

```tsx
import { styles, colors, semanticColors } from '@/config/theme';

// Use pre-composed style classes
<div className={styles.canvas}>
  <div className={styles.panel}>
    Content
  </div>
</div>

// Use raw color values
<div style={{ backgroundColor: colors.canvas }}>
  Content
</div>
```

## Best Practices

1. **Use semantic button components** - Prefer `UploadButton`, `CreateButton`, etc. over specifying variants manually
2. **Leverage the selected state** - Use `QontinuiCard`'s `selected` prop for selection UI
3. **Keep labels consistent** - Use `QontinuiInput`'s built-in label support
4. **Compose dialog content** - Build complex dialogs using header, content, and footer sections
5. **Override when needed** - Add custom `className` props to extend styling

## TypeScript Support

All components have full TypeScript support with proper types exported:

```tsx
import type { QontinuiButtonProps, QontinuiInputProps } from '@/components/qontinui';

const MyButton: React.FC<QontinuiButtonProps> = (props) => {
  return <QontinuiButton {...props} />;
};
```

## Related Documentation

- [Theme System Documentation](../../THEME.md) - Full theme configuration guide
- [shadcn/ui Documentation](https://ui.shadcn.com) - Base component library
