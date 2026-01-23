import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/auth-context";
import { UIBridgeWrapper, RenderLogWrapper } from "@/lib/ui-bridge";
import { QueryProvider } from "@/lib/providers/query-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { RefreshTokenExpiryWarning } from "@/components/refresh-token-expiry-warning";
import { OfflineIndicator } from "@/components/offline-indicator";
import { OnboardingTour } from "@/components/onboarding-tour";
import { DevDebugInit } from "@/components/dev-debug-init";
import "./globals.css";

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
  title: "Qontinui - Model-Based GUI Automation",
  description: "Visual automation builder for gamers",
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
        <DevDebugInit />
        <ErrorBoundary>
          <QueryProvider>
            <AuthProvider>
              <UIBridgeWrapper>
                <RenderLogWrapper
                  enableOnMount={true}
                  enableMutationObserver={true}
                  mutationDebounceMs={500}
                >
                  {/* <ActivityTracker /> */}
                  {/* BetaBanner moved to app layout to properly respect sidebar */}
                  {children}
                  {/* <SessionTimeoutWarning /> */}
                  <RefreshTokenExpiryWarning />
                  <OfflineIndicator />
                  <OnboardingTour />
                </RenderLogWrapper>
              </UIBridgeWrapper>
            </AuthProvider>
          </QueryProvider>
        </ErrorBoundary>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#18181B",
              border: "1px solid #27272A",
              color: "#E4E4E7",
            },
          }}
        />
      </body>
      <GoogleAnalytics gaId="G-HVSXBK77XN" />
    </html>
  );
}
