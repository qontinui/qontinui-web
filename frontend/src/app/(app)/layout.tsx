'use client';

import type React from "react";
import { AuthProvider } from "@/contexts/auth-context";
import { AutomationProvider } from "@/contexts/automation-context";
import { OfflineIndicator } from "@/components/offline-indicator";
import { OnboardingTour } from "@/components/onboarding-tour";
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
        <div className="min-h-screen bg-background">
          {children}
          <OfflineIndicator />
          <OnboardingTour />
        </div>
      </AutomationProvider>
    </AuthProvider>
  );
}
