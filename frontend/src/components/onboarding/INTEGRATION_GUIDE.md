# Onboarding System Integration Guide

Complete guide for integrating WelcomeModal and TutorialOverlay into your dashboard.

## Quick Start

### 1. Add Onboarding Components to Dashboard

Open `/app/(app)/dashboard/page.tsx` and add the following:

```tsx
// Add imports at the top
import { WelcomeModal, TutorialOverlay } from '@/components/onboarding';
import { useOnboardingStore } from '@/stores/onboarding-store';

// Inside the Dashboard component, add this effect
useEffect(() => {
  // Show welcome modal for new users
  if (user && !authLoading) {
    const { hasCompletedWelcome, dontShowWelcomeAgain, toggleWelcomeModal } =
      useOnboardingStore.getState();

    if (!hasCompletedWelcome && !dontShowWelcomeAgain) {
      // Check if user is new (created within last hour)
      const createdAt = new Date(user.created_at);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const isNewUser = createdAt > oneHourAgo;

      if (isNewUser) {
        setTimeout(() => {
          toggleWelcomeModal(true);
        }, 1000);
      }
    }
  }
}, [user, authLoading]);

// Add components before closing tag
return (
  <div className="min-h-screen bg-gradient-to-br...">
    {/* Your dashboard content with data-tour attributes */}

    {/* Add both onboarding components at the end */}
    <WelcomeModal />
    <TutorialOverlay />
  </div>
);
```

### 2. Add data-tour Attributes to Dashboard Elements

Add `data-tour` attributes to elements you want to highlight during the tutorial:

```tsx
// Projects section heading
<h3 className="text-xl font-semibold" data-tour="projects">
  Your Projects
</h3>

// New project button
<Button
  data-tour="new-project"
  onClick={handleNewProject}
  className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
>
  <Plus className="w-4 h-4 mr-2" />
  New Project
</Button>

// Quick start checklist (if you have one)
<Card data-tour="quick-start" className="...">
  <CardHeader>
    <CardTitle>Quick Start Guide</CardTitle>
  </CardHeader>
  {/* ... */}
</Card>

// Documentation link
<a data-tour="documentation" href="/docs" className="...">
  <BookOpen className="w-4 h-4" />
  Documentation
</a>

// Profile button
<Button
  data-tour="profile"
  onClick={() => router.push('/profile')}
  className="..."
>
  <UserIcon className="w-4 h-4" />
</Button>
```

### 3. Verify Dependencies

Ensure these components are available:
- ✓ `/components/ui/dialog.tsx` - Dialog component (already exists)
- ✓ `/components/ui/button.tsx` - Button component (already exists)
- ✓ `/components/ui/checkbox.tsx` - Checkbox component (already exists)
- ✓ `/components/ui/label.tsx` - Label component (already exists)
- ✓ `/stores/onboarding-store.ts` - Onboarding store (already exists)
- ✓ `/lib/utils.ts` - cn utility (already exists)

All dependencies are already in place!

### 4. Test the Integration

1. **Clear your browser's localStorage:**
   ```javascript
   localStorage.removeItem('qontinui-onboarding-state');
   ```

2. **Refresh the dashboard page**

3. **Test Welcome Modal:**
   - Modal should appear after 1 second
   - Click "Take Tour" - should start tutorial and close modal
   - Click "Skip to Dashboard" - should close modal
   - Check "Don't show again" - preference should persist
   - Press Escape key - should close modal

4. **Test Tutorial Overlay:**
   - After clicking "Take Tour", spotlight should highlight first element
   - Click "Next" or press → to advance
   - Click "Previous" or press ← to go back
   - Press Escape to skip tutorial
   - Click on highlighted element to advance
   - Verify all 5 steps work correctly

5. **Test Persistence:**
   - Start tutorial, go to step 3
   - Refresh page
   - Tutorial should resume at step 3

6. **Test Responsive Design:**
   - Resize browser window
   - Tooltip should stay within viewport
   - Spotlight should follow target element

## Complete Example

Here's a minimal working example for the dashboard:

```tsx
"use client"

import { useEffect } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useOnboardingStore } from "@/stores/onboarding-store"
import { WelcomeModal } from "@/components/onboarding"

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth()

  // Show welcome modal for new users
  useEffect(() => {
    if (!authLoading && user) {
      const {
        hasCompletedWelcome,
        dontShowWelcomeAgain,
        toggleWelcomeModal
      } = useOnboardingStore.getState()

      // Only show for users who haven't completed welcome
      if (!hasCompletedWelcome && !dontShowWelcomeAgain) {
        // Optional: Check if user is truly new
        const createdAt = new Date(user.created_at)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
        const isNewUser = createdAt > oneHourAgo

        if (isNewUser) {
          setTimeout(() => toggleWelcomeModal(true), 1000)
        }
      }
    }
  }, [user, authLoading])

  return (
    <div className="min-h-screen">
      <WelcomeModal />
      {/* Your dashboard content */}
    </div>
  )
}
```

## Customization Options

### Change Display Timing

```tsx
// Show immediately
toggleWelcomeModal(true)

// Show after 2 seconds
setTimeout(() => toggleWelcomeModal(true), 2000)

// Show after page interaction
window.addEventListener('click', () => {
  toggleWelcomeModal(true)
}, { once: true })
```

### Customize New User Detection

```tsx
// Show for users created in last 24 hours
const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
const isNewUser = createdAt > oneDayAgo

// Show for all users without projects
const isNewUser = projects.length === 0

// Show based on custom flag
const isNewUser = user.is_onboarding_required
```

### Manual Trigger Button

Add a button anywhere in your app to re-show the welcome modal:

```tsx
import { Button } from '@/components/ui/button'
import { useOnboardingStore } from '@/stores/onboarding-store'
import { HelpCircle } from 'lucide-react'

export function WelcomeButton() {
  const { toggleWelcomeModal } = useOnboardingStore()

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => toggleWelcomeModal(true)}
      className="border-gray-700"
    >
      <HelpCircle className="w-4 h-4 mr-2" />
      Getting Started
    </Button>
  )
}
```

## Integration with Tutorial Tour

The WelcomeModal works seamlessly with the TutorialOverlay:

```tsx
import { WelcomeModal } from '@/components/onboarding'
import { TutorialOverlay } from '@/components/onboarding'

export default function Dashboard() {
  return (
    <div>
      <WelcomeModal />
      <TutorialOverlay />
      {/* Your content */}
    </div>
  )
}
```

When users click "Take Tour" in the WelcomeModal, it automatically:
1. Marks welcome as completed
2. Calls `startTour()` which sets `showTutorialOverlay: true`
3. Closes the welcome modal
4. TutorialOverlay component will then display

## Monitoring & Analytics

### Track User Interactions

```tsx
import { useOnboardingStore } from '@/stores/onboarding-store'

// Monitor when welcome is completed
useEffect(() => {
  const unsubscribe = useOnboardingStore.subscribe(
    (state) => state.hasCompletedWelcome,
    (hasCompleted) => {
      if (hasCompleted) {
        // Track analytics
        analytics.track('Welcome Completed')
      }
    }
  )

  return unsubscribe
}, [])

// Monitor tour starts
useEffect(() => {
  const unsubscribe = useOnboardingStore.subscribe(
    (state) => state.hasStartedTour,
    (hasStarted) => {
      if (hasStarted) {
        analytics.track('Tour Started')
      }
    }
  )

  return unsubscribe
}, [])
```

### Track Skip vs. Take Tour

Modify the WelcomeModal component to add tracking:

```tsx
const handleTakeTour = () => {
  // Add tracking before existing logic
  if (typeof window !== 'undefined' && window.analytics) {
    window.analytics.track('Onboarding: Take Tour Clicked')
  }

  if (dontShowAgain) {
    setDontShowWelcomeAgain(true)
  }
  completeWelcome()
  startTour()
  handleClose()
}

const handleSkipToDashboard = () => {
  // Add tracking before existing logic
  if (typeof window !== 'undefined' && window.analytics) {
    window.analytics.track('Onboarding: Skipped to Dashboard')
  }

  if (dontShowAgain) {
    setDontShowWelcomeAgain(true)
  }
  completeWelcome()
  handleClose()
}
```

## Troubleshooting

### Modal not appearing?

1. Check localStorage:
   ```javascript
   console.log(localStorage.getItem('qontinui-onboarding-state'))
   ```

2. Check store state:
   ```javascript
   console.log(useOnboardingStore.getState())
   ```

3. Manually trigger:
   ```javascript
   useOnboardingStore.getState().toggleWelcomeModal(true)
   ```

### Modal appears every time?

1. Verify `completeWelcome()` is being called
2. Check Zustand persistence is working
3. Ensure localStorage is not being cleared

### Styling issues?

1. Verify Tailwind is processing the file
2. Check that custom colors are defined in `tailwind.config.js`
3. Ensure all shadcn/ui components are properly installed

## Next Steps

After integrating the WelcomeModal:

1. **Add TutorialOverlay** - Guide users through key features
2. **Add FirstProjectWizard** - Help create their first project
3. **Add QuickStartChecklist** - Track onboarding progress
4. **Set up analytics** - Monitor onboarding completion rates
5. **A/B test variations** - Optimize conversion rates

## Support

For questions or issues:
- Check the main README at `/components/onboarding/README.md`
- Review usage examples at `/components/onboarding/USAGE_EXAMPLE.md`
- Examine the component source at `/components/onboarding/WelcomeModal.tsx`
- Check the onboarding store at `/stores/onboarding-store.ts`
