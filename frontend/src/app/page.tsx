"use client";

import React from "react";

import { AuthDialog } from "@/components/auth-dialog";
import { AuthProvider } from "@/contexts/auth-context";
import { Footer } from "@/components/marketing/footer";
import { useLandingPage } from "./_hooks/use-landing-page";
import { Header } from "./_components/header";
import { HeroSection } from "./_components/hero-section";
import { UIBridgeSection } from "./_components/ui-bridge-section";
import { ProviderSection } from "./_components/provider-section";
import { KeyFeaturesSection } from "./_components/key-features-section";
import { HowItWorksSection } from "./_components/how-it-works-section";
import { ComparisonSection } from "./_components/comparison-section";
import { ResearchSection } from "./_components/research-section";
import { DownloadCTASection } from "./_components/download-cta-section";

function LandingContent() {
  const {
    authDialogOpen,
    setAuthDialogOpen,
    signupMode,
    platform,
    user,
    router,
    handleDownload,
    openSignIn,
  } = useLandingPage();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header user={user} router={router} openSignIn={openSignIn} />
      <HeroSection platform={platform} handleDownload={handleDownload} />
      <UIBridgeSection />
      <ProviderSection />
      <KeyFeaturesSection />
      <HowItWorksSection />
      <ComparisonSection />
      <ResearchSection />
      <DownloadCTASection platform={platform} handleDownload={handleDownload} />

      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        defaultTab={signupMode ? "signup" : "signin"}
      />

      <Footer />
    </div>
  );
}

export default function QontinuiLanding() {
  return (
    <AuthProvider>
      <LandingContent />
    </AuthProvider>
  );
}
