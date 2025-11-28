/**
 * TutorialOverlay Integration Example
 *
 * This file demonstrates how to integrate the TutorialOverlay component
 * into your application. Follow these steps to add interactive tours.
 */

import { TutorialOverlay } from "./TutorialOverlay";
import { useOnboardingStore } from "@/stores/onboarding-store";

// ============================================================================
// Step 1: Add TutorialOverlay to your root layout or page
// ============================================================================

export function DashboardWithTutorial() {
  const { startTour } = useOnboardingStore();

  return (
    <div className="min-h-screen">
      {/* Your dashboard content */}
      <div className="p-6">
        {/* Add data-tour attributes to elements you want to highlight */}
        <div data-tour="projects" className="mb-4">
          <h2>Your Projects</h2>
          {/* Project list */}
        </div>

        <button
          data-tour="new-project"
          onClick={() => {
            /* create project */
          }}
          className="btn-primary"
        >
          New Project
        </button>

        <div data-tour="quick-start" className="sidebar">
          {/* Quick start checklist */}
        </div>

        <a data-tour="documentation" href="/docs">
          Documentation
        </a>

        <button data-tour="profile" className="profile-button">
          Profile
        </button>

        {/* Button to start tutorial */}
        <button onClick={startTour}>Take Tour</button>
      </div>

      {/* Add the TutorialOverlay component */}
      <TutorialOverlay />
    </div>
  );
}

// ============================================================================
// Step 2: Add data-tour attributes to your existing components
// ============================================================================

/*
Example modifications to dashboard components:

// Projects section
<div data-tour="projects" className="projects-grid">
  {projects.map(project => (
    <ProjectCard key={project.id} {...project} />
  ))}
</div>

// New project button
<Button
  data-tour="new-project"
  onClick={handleNewProject}
  className="..."
>
  <Plus className="..." />
  New Project
</Button>

// Quick start checklist
<Card data-tour="quick-start" className="...">
  <CardHeader>
    <CardTitle>Quick Start</CardTitle>
  </CardHeader>
  <CardContent>
    {/* checklist items *\/}
  </CardContent>
</Card>

// Documentation link
<a
  data-tour="documentation"
  href="/docs"
  className="..."
>
  Documentation
</a>

// Profile button
<Button
  data-tour="profile"
  onClick={() => router.push('/profile')}
  className="..."
>
  <User className="..." />
</Button>
*/

// ============================================================================
// Step 3: Trigger tutorial from Welcome Modal
// ============================================================================

export function WelcomeModal() {
  const { startTour, toggleWelcomeModal } = useOnboardingStore();

  const handleTakeTour = () => {
    toggleWelcomeModal(false); // Close welcome modal
    startTour(); // Start tutorial
  };

  return (
    <div className="modal">
      <h2>Welcome to Qontinui!</h2>
      <p>Would you like to take a quick tour?</p>
      <button onClick={handleTakeTour}>Take Tour</button>
      <button onClick={() => toggleWelcomeModal(false)}>Skip</button>
    </div>
  );
}

// ============================================================================
// Step 4: Programmatically control tutorial
// ============================================================================

export function TutorialControls() {
  const {
    showTutorialOverlay,
    currentTourStep,
    startTour,
    skipTour,
    setTourStep,
  } = useOnboardingStore();

  return (
    <div className="tutorial-controls">
      {/* Start tutorial button */}
      {!showTutorialOverlay && (
        <button onClick={startTour}>Start Tutorial</button>
      )}

      {/* Skip tutorial button */}
      {showTutorialOverlay && <button onClick={skipTour}>Skip Tutorial</button>}

      {/* Jump to specific step */}
      {showTutorialOverlay && (
        <div>
          <button onClick={() => setTourStep(0)}>Go to Step 1</button>
          <button onClick={() => setTourStep(1)}>Go to Step 2</button>
          <button onClick={() => setTourStep(2)}>Go to Step 3</button>
          <p>Current Step: {currentTourStep + 1}</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Step 5: Custom tutorial steps (modify TutorialOverlay.tsx)
// ============================================================================

/*
To customize the tutorial steps, edit the TUTORIAL_STEPS array in TutorialOverlay.tsx:

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    target: '[data-tour="your-element"]',
    title: 'Your Feature',
    description: 'Description of what this does.',
    placement: 'bottom', // or 'top', 'left', 'right', 'auto'
  },
  // ... more steps
];
*/

// ============================================================================
// Step 6: Styling and customization
// ============================================================================

/*
The TutorialOverlay uses Tailwind CSS and can be customized by:

1. Modifying the spotlight effect:
   - Adjust SPOTLIGHT_PADDING constant
   - Change the glow animation in the pulse-glow keyframes
   - Modify box-shadow colors (currently using #00D9FF - cyan)

2. Customizing the tooltip:
   - Update Card styles
   - Modify button colors (Next = #00D9FF, Complete = #00FF88)
   - Adjust spacing and padding

3. Changing animations:
   - Modify ANIMATION_DURATION constant
   - Update transition classes
   - Customize pulse-glow animation

4. Backdrop customization:
   - Change bg-black/60 to adjust darkness
   - Modify backdrop-blur-sm for blur amount
*/

// ============================================================================
// Step 7: Accessibility features
// ============================================================================

/*
The TutorialOverlay includes:

✅ Keyboard navigation:
   - Arrow Right / Enter: Next step
   - Arrow Left: Previous step
   - Escape: Skip tutorial

✅ ARIA attributes:
   - role="dialog"
   - aria-modal="true"
   - aria-labelledby and aria-describedby

✅ Focus management:
   - Auto-scroll to target elements
   - Visible focus indicators

✅ Screen reader support:
   - Semantic HTML structure
   - Descriptive labels
   - Progress indicators
*/

// ============================================================================
// Step 8: Testing the tutorial
// ============================================================================

/*
To test the tutorial:

1. Reset onboarding state:
   ```typescript
   const { resetOnboarding } = useOnboardingStore();
   resetOnboarding(); // Call this from dev tools or a debug button
   ```

2. Manually trigger tutorial:
   ```typescript
   const { startTour } = useOnboardingStore();
   startTour();
   ```

3. Check for target elements:
   - Ensure all data-tour attributes are present
   - Verify elements are visible and not hidden
   - Test on different screen sizes

4. Test keyboard navigation:
   - Try all keyboard shortcuts
   - Verify focus management
   - Test with screen reader

5. Test edge cases:
   - What if target element doesn't exist?
   - What if element is off-screen?
   - What happens on window resize?
*/

// ============================================================================
// Step 9: Mobile responsiveness
// ============================================================================

/*
The TutorialOverlay is mobile-responsive by default:

- Tooltip width is capped at 360px
- Auto-adjusts position to stay in viewport
- Responsive padding and margins
- Touch-friendly button sizes

For additional mobile customizations:
- Add media queries to adjust tooltip size
- Modify TOOLTIP_OFFSET for smaller screens
- Consider different step orders for mobile
*/

// ============================================================================
// Step 10: Persistence and analytics
// ============================================================================

export function TutorialAnalytics() {
  const { hasStartedTour, hasCompletedWelcome, currentTourStep } =
    useOnboardingStore();

  // Track tutorial progress
  // You can send this data to your analytics service
  const tutorialProgress = {
    started: hasStartedTour,
    completed: hasCompletedWelcome,
    currentStep: currentTourStep,
  };

  // Example: Send to analytics
  // useEffect(() => {
  //   if (hasStartedTour) {
  //     analytics.track('Tutorial Started');
  //   }
  // }, [hasStartedTour]);

  return null;
}
