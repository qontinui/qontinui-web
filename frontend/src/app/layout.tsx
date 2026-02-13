import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/auth-context";
import { TutorialProvider } from "@/contexts/tutorial";
import { UIBridgeWrapper, RenderLogWrapper } from "@/lib/ui-bridge";
import { QueryProvider } from "@/lib/providers/query-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { RefreshTokenExpiryWarning } from "@/components/refresh-token-expiry-warning";
import { OfflineIndicator } from "@/components/offline-indicator";
import { OnboardingTour } from "@/components/onboarding-tour";
import { ContextualTutorialEnhanced } from "@/components/tutorial";
import { DBErrorHandler } from "@/components/db-error-handler";
import "./globals.css";
import "@/styles/tutorial.css";

export const dynamic = "force-dynamic";
export const dynamicParams = true;
export const revalidate = 0;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Qontinui - AI Development Companion",
  description:
    "Desktop companion app for AI development with verification loops, error monitoring, and workflow orchestration",
  icons: {
    icon: "/q-logo.png",
    apple: "/q-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <DBErrorHandler />
        <ErrorBoundary>
          <QueryProvider>
            <AuthProvider>
              <TutorialProvider>
                <UIBridgeWrapper>
                  <RenderLogWrapper
                    enableOnMount={true}
                    enableMutationObserver={false}
                    mutationDebounceMs={500}
                  >
                    {/* <ActivityTracker /> */}
                    {/* BetaBanner moved to app layout to properly respect sidebar */}
                    {children}
                    {/* <SessionTimeoutWarning /> */}
                    <RefreshTokenExpiryWarning />
                    <OfflineIndicator />
                    <OnboardingTour />
                    <ContextualTutorialEnhanced />
                  </RenderLogWrapper>
                </UIBridgeWrapper>
              </TutorialProvider>
            </AuthProvider>
          </QueryProvider>
        </ErrorBoundary>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--surface-raised)",
              border: "1px solid var(--border-subtle)",
              color: "var(--foreground)",
            },
          }}
        />
      </body>
      <GoogleAnalytics gaId="G-HVSXBK77XN" />
    </html>
  );
}
