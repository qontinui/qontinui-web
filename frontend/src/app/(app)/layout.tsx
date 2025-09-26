'use client';

import type React from "react";
import { AuthProvider } from "@/contexts/auth-context";
import { SessionTimeoutWarning } from "@/components/session-timeout-warning";
import { OfflineIndicator } from "@/components/offline-indicator";
import { OnboardingTour } from "@/components/onboarding-tour";
import "../globals.css";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-background">
        {children}
        <SessionTimeoutWarning />
        <OfflineIndicator />
        <OnboardingTour />
      </div>
    </AuthProvider>
  );
}
