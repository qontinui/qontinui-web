"use client";

import nextDynamic from "next/dynamic";

// NOTE: OnboardingTour and ContextualTutorialEnhanced are disabled.
// The onboarding tutorial is geared towards visual GUI automation which will be
// introduced at a later point. It should not appear on first login.
// When visual GUI automation is ready, re-enable these components and update
// the tutorial content in components/tutorial/data/onboarding-tour.ts.

// const OnboardingTour = nextDynamic(
//   () =>
//     import("@/components/onboarding-tour").then((m) => ({
//       default: m.OnboardingTour,
//     })),
//   { ssr: false }
// );

// const ContextualTutorialEnhanced = nextDynamic(
//   () =>
//     import("@/components/tutorial/contextual/ContextualTutorialEnhanced").then(
//       (m) => ({
//         default: m.ContextualTutorialEnhanced,
//       })
//     ),
//   { ssr: false }
// );

const DBErrorHandler = nextDynamic(
  () =>
    import("@/components/db-error-handler").then((m) => ({
      default: m.DBErrorHandler,
    })),
  { ssr: false }
);

const OfflineIndicator = nextDynamic(
  () =>
    import("@/components/offline-indicator").then((m) => ({
      default: m.OfflineIndicator,
    })),
  { ssr: false }
);

// The heap badge is a leak-diagnosis tool for developers. It is fixed to the
// bottom-left corner, where it covers the sidebar's runner row, and it is the
// only thing that starts the memory-growth detector — so outside a dev build it
// is not mounted (and its chunk is never loaded) at all.
const showMemoryOverlay = process.env.NODE_ENV === "development";

const MemoryGrowthOverlay = nextDynamic(
  () =>
    import("@/components/MemoryGrowthOverlay").then((m) => ({
      default: m.MemoryGrowthOverlay,
    })),
  { ssr: false }
);

export function ClientOverlays() {
  return (
    <>
      <DBErrorHandler />
      <OfflineIndicator />
      {showMemoryOverlay && <MemoryGrowthOverlay />}
    </>
  );
}
