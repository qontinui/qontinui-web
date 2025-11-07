# Onboarding Components

This directory contains onboarding-related components for guiding new users through their first experience with Qontinui.

## Components

### TutorialOverlay

An interactive tour system with spotlight highlighting that guides users through key features of the application.

**Features:**
- Full-screen dark overlay with backdrop blur
- Spotlight effect using SVG masks highlighting target elements
- Animated glow/pulse around highlighted elements
- Smart tooltip positioning (auto-adjusts to avoid viewport edges)
- Keyboard navigation (arrow keys, escape)
- Click-to-advance on highlighted elements
- Step progress indicators
- Mobile responsive design
- Smooth animations and transitions

**Usage:**

```tsx
import { TutorialOverlay } from '@/components/onboarding/TutorialOverlay';
import { useOnboardingStore } from '@/stores/onboarding-store';

function DashboardLayout() {
  const { startTour } = useOnboardingStore();

  return (
    <div>
      {/* Add data-tour attributes to elements you want to highlight */}
      <div data-tour="projects">Your Projects</div>
      <button data-tour="new-project" onClick={handleCreate}>New Project</button>

      {/* Button to start tour */}
      <button onClick={startTour}>Take Tour</button>

      {/* Add the overlay component */}
      <TutorialOverlay />
    </div>
  );
}
```

**Tutorial Steps Configuration:**

The tutorial steps are defined in `TutorialOverlay.tsx`:

```typescript
const TUTORIAL_STEPS: TutorialStep[] = [
  {
    target: '[data-tour="projects"]',
    title: 'Your Projects',
    description: 'All your automation projects live here.',
    placement: 'bottom', // optional: 'top', 'left', 'right', 'auto'
  },
  // ... more steps
];
```

**Keyboard Navigation:**
- `→` (Right Arrow) or `Enter`: Next step
- `←` (Left Arrow): Previous step
- `Escape`: Skip/exit tutorial

**Integration with Onboarding Store:**

```tsx
import { useOnboardingStore } from '@/stores/onboarding-store';

const {
  showTutorialOverlay,    // Current visibility state
  currentTourStep,        // Current step index (0-based)
  startTour,              // Start the tutorial
  completeTour,           // Mark tutorial as complete
  skipTour,               // Skip tutorial
  setTourStep,            // Jump to specific step
} = useOnboardingStore();
```

**Customization:**

Edit constants in `TutorialOverlay.tsx`:
- `SPOTLIGHT_PADDING`: Padding around highlighted element (default: 8px)
- `TOOLTIP_OFFSET`: Distance from highlighted element (default: 20px)
- `ANIMATION_DURATION`: Animation speed in milliseconds (default: 300ms)

**Accessibility:**
- Proper ARIA attributes (`role="dialog"`, `aria-modal`, etc.)
- Keyboard navigation support
- Auto-scroll to target elements
- Screen reader friendly
- Focus management

**Mobile Responsive:**
- Tooltip max-width: 360px
- Auto-adjusts position to stay within viewport
- Touch-friendly button sizes (48px+ tap targets)

---

### WelcomeModal

A welcome dialog that greets new users and offers to start the interactive tour.

**Features:**
- Eye-catching gradient design with animated neon effects
- Feature highlights showcasing key benefits
- "Don't show again" preference
- Smooth entrance/exit animations
- Keyboard support (ESC to close)
- Integrates with TutorialOverlay

**Usage:**

```tsx
import { WelcomeModal } from '@/components/onboarding/WelcomeModal';

function Dashboard() {
  return (
    <div>
      {/* Your dashboard content */}

      {/* Add the welcome modal */}
      <WelcomeModal />
    </div>
  );
}
```

**Auto-display for New Users:**

```tsx
import { useEffect } from 'react';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { useAuth } from '@/contexts/auth-context';

function Dashboard() {
  const { user } = useAuth();
  const { toggleWelcomeModal, hasCompletedWelcome } = useOnboardingStore();

  useEffect(() => {
    // Check if user is new (created within last 5 minutes)
    const isNewUser = () => {
      if (!user?.created_at) return false;
      const createdAt = new Date(user.created_at);
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      return createdAt > fiveMinutesAgo;
    };

    // Show for new users who haven't completed onboarding
    if (isNewUser() && !hasCompletedWelcome) {
      toggleWelcomeModal(true);
    }
  }, [user, hasCompletedWelcome, toggleWelcomeModal]);

  return <div>{/* ... */}</div>;
}
```

**State Management:**

```tsx
const {
  showWelcomeModal,        // Current visibility
  toggleWelcomeModal,      // Show/hide modal
  completeWelcome,         // Mark welcome as seen
  dontShowWelcomeAgain,    // User preference
  setDontShowWelcomeAgain, // Update preference
  startTour,               // Start tutorial from modal
} = useOnboardingStore();
```

---

### FirstProjectWizard

A multi-step guided wizard that helps users create their first automation project.

**Features:**
- 5-step wizard flow with progress tracking
- Project naming and description
- Template selection (Blank, Civ 6, Simple Clicker)
- Use case selection for customized guidance
- Progress saved to localStorage for resumption
- Keyboard navigation (Enter to proceed, Esc to close)
- Gaming-themed dark aesthetic
- Integration with TanStack Query for project creation

**Usage:**

```tsx
import { FirstProjectWizard } from '@/components/onboarding/FirstProjectWizard';

function Dashboard() {
  const [wizardOpen, setWizardOpen] = useState(false);

  const handleWizardComplete = () => {
    // Mark onboarding as complete
    localStorage.setItem('hasCreatedFirstProject', 'true');
  };

  return (
    <>
      <Button onClick={() => setWizardOpen(true)}>
        Create First Project
      </Button>

      <FirstProjectWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onComplete={handleWizardComplete}
      />
    </>
  );
}
```

**Integration Points:**

1. **Dashboard Empty State** (`/app/(app)/dashboard/page.tsx`):
   - Show "Create First Project" button in empty state
   - Open wizard instead of direct project creation for new users

2. **Welcome Modal** (if exists):
   - Trigger wizard from welcome modal CTA

3. **Onboarding Store** (future):
   - Track wizard completion state
   - Update quick start checklist

**Props:**

- `open: boolean` - Controls wizard visibility
- `onOpenChange: (open: boolean) => void` - Callback when wizard opens/closes
- `onComplete?: () => void` - Optional callback when project is successfully created

**Wizard Steps:**

1. **Welcome** - Introduction to automation and what the wizard will do
2. **Name Your Project** - Project name (required) and description (optional) with suggestions
3. **Choose Template** - Select from Blank, Civ 6 Unit Manager, or Simple Clicker templates
4. **What Will You Automate?** - Use case selection (Gaming, Productivity, Testing, Exploring)
5. **Ready to Build!** - Summary and quick tips with options to open project or watch tutorial

**State Persistence:**

The wizard automatically saves progress to `localStorage` under the key `first-project-wizard-state`, allowing users to resume if they close the wizard partway through.

**Styling:**

- Matches dashboard gaming aesthetic
- Uses Tailwind CSS with custom color scheme:
  - Primary: `#00D9FF` (cyan)
  - Secondary: `#BD00FF` (purple)
  - Success: `#00FF88` (green)
- Dark background with gradient effects
- Smooth transitions and hover states
