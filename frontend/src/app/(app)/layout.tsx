'use client';

import type React from "react";
import { AuthProvider } from "@/contexts/auth-context";
import { AutomationProvider } from "@/contexts/automation-context";
import { OfflineIndicator } from "@/components/offline-indicator";
import { OnboardingTour } from "@/components/onboarding-tour";
import { TutorialProvider } from "@/components/tutorial/integration/TutorialProvider";
import { TutorialTrigger } from "@/components/tutorial/integration/TutorialTrigger";
import { TutorialMenuButton } from "@/components/tutorial/TutorialMenuButton";
import { allTutorials } from "@/data/tutorials";
import "@/components/tutorial/integration/tutorial-targets.css";
import "../globals.css";

export const dynamic = 'force-dynamic'

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthProvider>
      <AutomationProvider>
        <TutorialProvider defaultMode="contextual">
          <div className="min-h-screen bg-background">
            {children}
            <OfflineIndicator />
            <OnboardingTour />
            <TutorialTrigger tutorials={allTutorials} enabled={true} />
            <TutorialMenuButton />
          </div>
        </TutorialProvider>
      </AutomationProvider>
    </AuthProvider>
  );
}
