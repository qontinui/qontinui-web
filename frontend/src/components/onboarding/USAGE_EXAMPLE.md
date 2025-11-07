# WelcomeModal Usage Guide

This guide shows how to integrate the WelcomeModal component into your Qontinui application.

## Basic Integration

### Step 1: Import the Component

```tsx
import { WelcomeModal } from '@/components/onboarding';
```

### Step 2: Add to Your Layout or Page

The simplest way to use the WelcomeModal is to add it to your dashboard layout or page:

```tsx
// app/(app)/dashboard/page.tsx
"use client";

import { WelcomeModal } from '@/components/onboarding';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { useAuth } from '@/contexts/auth-context';
import { useEffect } from 'react';

export default function Dashboard() {
  const { user } = useAuth();
  const {
    hasCompletedWelcome,
    dontShowWelcomeAgain,
    toggleWelcomeModal
  } = useOnboardingStore();

  // Show welcome modal for new users on first login
  useEffect(() => {
    if (user && !hasCompletedWelcome && !dontShowWelcomeAgain) {
      // Delay slightly for better UX
      const timer = setTimeout(() => {
        toggleWelcomeModal(true);
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [user, hasCompletedWelcome, dontShowWelcomeAgain, toggleWelcomeModal]);

  return (
    <>
      <WelcomeModal />
      {/* Your dashboard content */}
    </>
  );
}
```

## Advanced Integration

### Detecting First-Time Users

You can enhance the detection logic to show the modal only to truly new users:

```tsx
import { useAuth } from '@/contexts/auth-context';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { useEffect } from 'react';

function useWelcomeNewUsers() {
  const { user } = useAuth();
  const {
    hasCompletedWelcome,
    dontShowWelcomeAgain,
    toggleWelcomeModal
  } = useOnboardingStore();

  useEffect(() => {
    if (!user || hasCompletedWelcome || dontShowWelcomeAgain) {
      return;
    }

    // Check if user is truly new (created within last hour)
    const createdAt = new Date(user.created_at);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const isNewUser = createdAt > oneHourAgo;

    if (isNewUser) {
      const timer = setTimeout(() => {
        toggleWelcomeModal(true);
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [user, hasCompletedWelcome, dontShowWelcomeAgain, toggleWelcomeModal]);
}

// Use in your component
export default function Dashboard() {
  useWelcomeNewUsers();

  return (
    <>
      <WelcomeModal />
      {/* Your content */}
    </>
  );
}
```

### Manual Trigger

You can also manually trigger the welcome modal with a button:

```tsx
import { Button } from '@/components/ui/button';
import { WelcomeModal } from '@/components/onboarding';
import { useOnboardingStore } from '@/stores/onboarding-store';

export function HelpButton() {
  const { toggleWelcomeModal } = useOnboardingStore();

  return (
    <>
      <Button
        variant="outline"
        onClick={() => toggleWelcomeModal(true)}
      >
        Show Welcome Guide
      </Button>
      <WelcomeModal />
    </>
  );
}
```

### Integration with Tutorial Tour

The WelcomeModal automatically integrates with the TutorialOverlay component. When users click "Take Tour", it will:

1. Mark welcome as completed
2. Start the tutorial tour
3. Close the welcome modal

```tsx
import { WelcomeModal } from '@/components/onboarding';
import { TutorialOverlay } from '@/components/onboarding';

export default function Dashboard() {
  return (
    <>
      <WelcomeModal />
      <TutorialOverlay />
      {/* Your dashboard content */}
    </>
  );
}
```

## Onboarding Store API

The WelcomeModal uses the following store methods:

```tsx
import { useOnboardingStore } from '@/stores/onboarding-store';

const {
  // State
  showWelcomeModal,          // boolean: modal visibility
  hasCompletedWelcome,       // boolean: has user completed welcome
  dontShowWelcomeAgain,      // boolean: user preference

  // Actions
  toggleWelcomeModal,        // (show: boolean) => void
  completeWelcome,           // () => void
  setDontShowWelcomeAgain,   // (value: boolean) => void
  startTour,                 // () => void
  resetOnboarding,           // () => void (for testing)
} = useOnboardingStore();
```

## Customization

### Custom Benefits

You can create a custom version with different benefits:

```tsx
// Create CustomWelcomeModal.tsx based on WelcomeModal.tsx
const CUSTOM_BENEFITS: Benefit[] = [
  {
    icon: YourIcon,
    title: 'Your Feature',
    description: 'Your description',
    color: 'text-[#00D9FF]',
  },
  // ... more benefits
];
```

### Custom Styling

The modal uses Tailwind classes that can be customized:

```tsx
// Colors
#00D9FF - Cyan (primary)
#BD00FF - Purple (secondary)
#00FF88 - Green (success)

// Background
bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B]

// Glow effects
shadow-[0_0_50px_rgba(0,217,255,0.15)]
```

## Testing

### Manual Testing Checklist

- [ ] Modal appears on first login
- [ ] "Take Tour" button starts the tutorial
- [ ] "Skip to Dashboard" closes the modal
- [ ] "Don't show again" checkbox works
- [ ] Escape key closes the modal
- [ ] Click outside closes the modal
- [ ] Modal does not show after being dismissed
- [ ] Modal respects "don't show again" preference
- [ ] Animations work smoothly
- [ ] Responsive on mobile devices

### Reset Onboarding State

For testing, you can reset the onboarding state:

```tsx
import { useOnboardingStore } from '@/stores/onboarding-store';

// In your component or dev tools
const { resetOnboarding } = useOnboardingStore();

// Call this to reset
resetOnboarding();

// Or manually clear localStorage
localStorage.removeItem('qontinui-onboarding-state');
```

## Troubleshooting

### Modal Not Showing

1. Check if `hasCompletedWelcome` is false
2. Check if `dontShowWelcomeAgain` is false
3. Ensure `toggleWelcomeModal(true)` is being called
4. Verify user object exists

### Modal Shows Every Time

1. Check localStorage for `qontinui-onboarding-state`
2. Verify `completeWelcome()` is being called
3. Check Zustand persist middleware configuration

### Styling Issues

1. Ensure Tailwind is configured correctly
2. Check that custom colors are in `tailwind.config.js`
3. Verify `@/lib/utils` exports `cn` function
4. Check that shadcn/ui components are installed

## Related Components

- `TutorialOverlay` - Interactive product tour
- `FirstProjectWizard` - Project creation wizard
- `QuickStartChecklist` - Onboarding progress tracker

## Best Practices

1. **Show Early**: Display the modal within 1 second of page load for new users
2. **Respect Preferences**: Always honor the "don't show again" setting
3. **Mobile First**: Ensure the modal is responsive and readable on mobile
4. **Accessibility**: Test with keyboard navigation and screen readers
5. **Analytics**: Consider tracking when users dismiss vs. take the tour
6. **Progressive Disclosure**: Don't overwhelm with too much information
7. **Clear CTAs**: Make the next action obvious

## Example: Complete Integration

Here's a complete example showing best practices:

```tsx
// app/(app)/layout.tsx
"use client";

import { useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { WelcomeModal } from '@/components/onboarding';
import { TutorialOverlay } from '@/components/onboarding';

export default function AppLayout({ children }) {
  const { user, loading } = useAuth();
  const {
    hasCompletedWelcome,
    dontShowWelcomeAgain,
    toggleWelcomeModal,
  } = useOnboardingStore();

  useEffect(() => {
    // Wait for auth to load
    if (loading) return;

    // Only show for authenticated users
    if (!user) return;

    // Check if we should show welcome
    if (hasCompletedWelcome || dontShowWelcomeAgain) return;

    // Check if user is new (created in last hour)
    const createdAt = new Date(user.created_at);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const isNewUser = createdAt > oneHourAgo;

    if (isNewUser) {
      // Show welcome modal after brief delay
      const timer = setTimeout(() => {
        toggleWelcomeModal(true);
      }, 800);

      return () => clearTimeout(timer);
    }
  }, [
    user,
    loading,
    hasCompletedWelcome,
    dontShowWelcomeAgain,
    toggleWelcomeModal,
  ]);

  return (
    <>
      <WelcomeModal />
      <TutorialOverlay />
      {children}
    </>
  );
}
```
