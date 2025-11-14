# Tutorial Integration Infrastructure

This directory contains the core integration components for the Qontinui tutorial system. These components provide state management, target element marking, auto-triggering, and UI for tutorial selection.

## Components

### 1. TutorialProvider

React context provider that manages tutorial state throughout the application.

**Features:**
- Tutorial state management (current tutorial, step, mode)
- Integration with tutorial store (Zustand)
- Mode switching (overlay, contextual, hybrid)
- Target element registration and management
- Progress tracking

**Usage:**

```tsx
import { TutorialProvider } from '@/components/tutorial/integration';

function App() {
  return (
    <TutorialProvider defaultMode="overlay">
      <YourApp />
    </TutorialProvider>
  );
}
```

**Hook:**

```tsx
import { useTutorial } from '@/components/tutorial/integration';

function MyComponent() {
  const {
    currentTutorial,
    currentStep,
    isActive,
    startTutorial,
    stopTutorial,
    nextStep,
    previousStep,
  } = useTutorial();

  return (
    <div>
      {isActive && <p>Tutorial is active: {currentTutorial?.title}</p>}
      <button onClick={() => startTutorial(myTutorial)}>
        Start Tutorial
      </button>
    </div>
  );
}
```

---

### 2. useTutorialTarget

Custom hook for marking elements as tutorial targets.

**Features:**
- Automatic element registration with tutorial system
- Data attribute assignment (`data-tutorial-id`)
- Focus and scroll-into-view handling
- CSS class management for highlighting
- Accessibility support

**Usage:**

```tsx
import { useTutorialTarget } from '@/components/tutorial/integration';

function AddActionButton() {
  const targetProps = useTutorialTarget('add-action-button', {
    ariaLabel: 'Add new action',
    focusable: true,
    onFocus: () => console.log('Tutorial focused this button'),
  });

  return <button {...targetProps}>Add Action</button>;
}
```

**The hook returns:**
- `ref`: React ref to attach to the element
- `data-tutorial-id`: Tutorial identifier attribute
- `className`: Auto-managed classes for highlighting
- `tabIndex`: (optional) for keyboard focus
- `aria-label`: (optional) accessibility label

**Helper Hooks:**

```tsx
// Check if a target is currently active
const isActive = useIsTargetActive('add-action-button');

// Scroll to a target programmatically
const scrollToTarget = useScrollToTarget('settings-panel');
scrollToTarget(); // Call to scroll
```

---

### 3. TutorialTrigger

Component that monitors conditions and auto-triggers tutorials.

**Features:**
- Page load monitoring
- Route change detection
- Contextual trigger evaluation
- User preference tracking (don't show again)
- Trigger history in localStorage
- Custom event support

**Usage:**

```tsx
import { TutorialTrigger } from '@/components/tutorial/integration';
import { tutorials } from '@/data/tutorials';

function App() {
  return (
    <TutorialProvider>
      <TutorialTrigger
        tutorials={tutorials}
        enabled={true}
        delay={1000}
      />
      <YourApp />
    </TutorialProvider>
  );
}
```

**Utility Functions:**

```tsx
import {
  triggerTutorialById,
  dismissTutorial,
  resetTriggerHistory,
} from '@/components/tutorial/integration';

// Trigger a tutorial programmatically
triggerTutorialById('getting-started');

// Mark tutorial as dismissed
dismissTutorial('getting-started');

// Reset all trigger history
resetTriggerHistory();
```

**Custom Trigger Events:**

```tsx
// Dispatch custom trigger event
const event = new CustomEvent('trigger-tutorial', {
  detail: { tutorialId: 'advanced-patterns' }
});
window.dispatchEvent(event);
```

---

### 4. TutorialMenu

UI component for browsing and launching tutorials.

**Features:**
- Tutorial listing with metadata
- Search functionality
- Category filtering
- Difficulty filtering
- Completion status filtering
- Status badges (New, In Progress, Completed)
- Responsive design
- Keyboard accessible

**Usage:**

```tsx
import { useState } from 'react';
import { TutorialMenu } from '@/components/tutorial/integration';
import { tutorials } from '@/data/tutorials';

function HelpMenu() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <button onClick={() => setMenuOpen(true)}>
        Show Tutorials
      </button>
      <TutorialMenu
        tutorials={tutorials}
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Learn Qontinui"
      />
    </>
  );
}
```

**Custom Filtering:**

```tsx
<TutorialMenu
  tutorials={tutorials}
  isOpen={menuOpen}
  onClose={() => setMenuOpen(false)}
  customFilter={(tutorial) => tutorial.category === 'gaming'}
/>
```

---

## Styling

Import the tutorial target CSS in your application:

```tsx
// In your main app file or layout
import '@/components/tutorial/integration/tutorial-targets.css';
```

### CSS Classes

The following CSS classes are applied automatically:

- `.tutorial-target` - Base class for all targets
- `.tutorial-target-active` - Active/highlighted target
- `.tutorial-target-current` - Currently focused target
- `.tutorial-target-spotlight` - Spotlight highlight style
- `.tutorial-target-border` - Border highlight style
- `.tutorial-target-pulse` - Pulsing animation
- `.tutorial-target-arrow` - Arrow indicator

You can customize these in your own CSS or override them.

---

## Complete Integration Example

Here's a complete example integrating all components:

```tsx
// App.tsx
import { TutorialProvider } from '@/components/tutorial/integration';
import { TutorialTrigger } from '@/components/tutorial/integration';
import '@/components/tutorial/integration/tutorial-targets.css';
import { tutorials } from '@/data/tutorials';

function App() {
  return (
    <TutorialProvider defaultMode="contextual">
      <TutorialTrigger tutorials={tutorials} enabled={true} />
      <MainLayout />
    </TutorialProvider>
  );
}

// MainLayout.tsx
import { useState } from 'react';
import { TutorialMenu } from '@/components/tutorial/integration';
import { tutorials } from '@/data/tutorials';

function MainLayout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div>
      <Header onHelpClick={() => setMenuOpen(true)} />
      <Content />
      <TutorialMenu
        tutorials={tutorials}
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
      />
    </div>
  );
}

// SomeComponent.tsx
import { useTutorialTarget } from '@/components/tutorial/integration';

function AddActionButton() {
  const targetProps = useTutorialTarget('add-action-button', {
    ariaLabel: 'Add new action button',
    focusable: true,
  });

  return (
    <button {...targetProps} onClick={handleAddAction}>
      Add Action
    </button>
  );
}
```

---

## Data Structure

Tutorials should follow the `Tutorial` type from `/home/user/qontinui-web/frontend/src/types/tutorial.ts`.

**Example Tutorial:**

```tsx
import type { Tutorial } from '@/types/tutorial';

const gettingStartedTutorial: Tutorial = {
  id: 'getting-started',
  title: 'Getting Started with Qontinui',
  description: 'Learn the basics of creating automations',
  duration: '10 minutes',
  difficulty: 'beginner',
  mode: 'contextual',
  category: 'getting-started',
  tags: ['basics', 'beginner', 'introduction'],
  targetPage: '/workflows',
  triggers: {
    automatic: true,
    manual: true,
  },
  steps: [
    {
      id: 'step-1',
      title: 'Welcome to Qontinui',
      content: 'Let\'s start by exploring the interface...',
      targetElement: {
        selector: '[data-tutorial-id="workflow-canvas"]',
        highlightType: 'spotlight',
        position: 'center',
        allowInteraction: true,
        scrollIntoView: true,
      },
    },
    // ... more steps
  ],
};
```

---

## localStorage Keys

The tutorial system uses the following localStorage keys:

- `qontinui-tutorial-state` - Zustand store persistence
- `qontinui-tutorial-trigger-history` - Trigger history tracking
- `qontinui-tutorial-dont-show` - List of dismissed tutorials

---

## TypeScript Support

All components are fully typed with TypeScript. Import types as needed:

```tsx
import type {
  TutorialContextValue,
  TutorialTargetProps,
  TutorialTriggerProps,
  TutorialMenuProps,
} from '@/components/tutorial/integration';
```

---

## Accessibility

All components follow accessibility best practices:

- ARIA labels on interactive elements
- Keyboard navigation support
- Focus management
- Screen reader announcements
- Reduced motion support (CSS)

---

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Requires ES6+ support
- localStorage support required for persistence

---

## License

Part of the Qontinui Web project.
