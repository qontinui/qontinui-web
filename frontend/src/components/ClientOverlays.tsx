"use client";

import nextDynamic from "next/dynamic";

const OnboardingTour = nextDynamic(
  () =>
    import("@/components/onboarding-tour").then((m) => ({
      default: m.OnboardingTour,
    })),
  { ssr: false }
);

const ContextualTutorialEnhanced = nextDynamic(
  () =>
    import("@/components/tutorial/contextual/ContextualTutorialEnhanced").then(
      (m) => ({
        default: m.ContextualTutorialEnhanced,
      })
    ),
  { ssr: false }
);

const RefreshTokenExpiryWarning = nextDynamic(
  () =>
    import("@/components/refresh-token-expiry-warning").then((m) => ({
      default: m.RefreshTokenExpiryWarning,
    })),
  { ssr: false }
);

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

export function ClientOverlays() {
  return (
    <>
      <DBErrorHandler />
      <RefreshTokenExpiryWarning />
      <OfflineIndicator />
      <OnboardingTour />
      <ContextualTutorialEnhanced />
    </>
  );
}
