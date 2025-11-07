# WelcomeModal - Quick Reference

## Import

```tsx
import { WelcomeModal } from '@/components/onboarding';
```

## Basic Usage

```tsx
<WelcomeModal />
```

## Trigger on First Login

```tsx
import { useOnboardingStore } from '@/stores/onboarding-store';
import { useEffect } from 'react';

const { toggleWelcomeModal } = useOnboardingStore();

useEffect(() => {
  if (isNewUser && !hasCompletedWelcome && !dontShowWelcomeAgain) {
    setTimeout(() => toggleWelcomeModal(true), 1000);
  }
}, [isNewUser]);
```

## Manual Trigger

```tsx
const { toggleWelcomeModal } = useOnboardingStore();

<Button onClick={() => toggleWelcomeModal(true)}>
  Show Welcome
</Button>
```

## Store Methods

```tsx
const {
  showWelcomeModal,          // boolean - is modal visible?
  hasCompletedWelcome,       // boolean - has user completed?
  dontShowWelcomeAgain,      // boolean - user preference
  toggleWelcomeModal,        // (show) => void
  completeWelcome,           // () => void
  setDontShowWelcomeAgain,   // (value) => void
  startTour,                 // () => void
} = useOnboardingStore();
```

## Reset for Testing

```tsx
// Clear localStorage
localStorage.removeItem('qontinui-onboarding-state');

// Or use store method
useOnboardingStore.getState().resetOnboarding();

// Then manually show
useOnboardingStore.getState().toggleWelcomeModal(true);
```

## Key Features

- ✓ Gaming-themed dark design
- ✓ Neon colors (cyan, purple, green)
- ✓ Animated entrance/exit
- ✓ 3 key benefits with icons
- ✓ "Take Tour" / "Skip" CTAs
- ✓ "Don't show again" option
- ✓ Escape key to close
- ✓ Fully accessible
- ✓ Responsive design

## Props

None! The component is self-contained and manages its own state via the onboarding store.

## Styling

Matches the dashboard's gaming aesthetic with:
- Dark gradient background
- Neon glow effects
- Smooth animations
- Responsive layout

## Files

- Component: `/components/onboarding/WelcomeModal.tsx`
- Store: `/stores/onboarding-store.ts`
- Docs: `/components/onboarding/INTEGRATION_GUIDE.md`

## Common Tasks

**Show to new users:**
```tsx
if (user.created_at > oneHourAgo) {
  toggleWelcomeModal(true);
}
```

**Check if completed:**
```tsx
const isComplete = useOnboardingStore(state => state.hasCompletedWelcome);
```

**Reset everything:**
```tsx
useOnboardingStore.getState().resetOnboarding();
```

## Color Reference

```css
/* Primary */
#00D9FF - Cyan (main CTA, icons)

/* Secondary */
#BD00FF - Purple (secondary CTA, gradient)

/* Accent */
#00FF88 - Green (icon, gradient)

/* Background */
#0A0A0B - Dark base
#0F0F10 - Dark mid
```

## Next Steps

1. Add to dashboard page
2. Test with new user flow
3. Connect to tutorial overlay
4. Add analytics (optional)
