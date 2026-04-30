import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/auth-context";
import { TutorialProvider } from "@/contexts/tutorial";
import { UIBridgeWrapper, RenderLogWrapper } from "@/lib/ui-bridge";
import { QueryProvider } from "@/lib/providers/query-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { DevDebugInit } from "@/components/dev-debug-init";
import { ClientOverlays } from "@/components/ClientOverlays";
import { WorkflowUIProvider } from "@/lib/providers/workflow-ui-provider";
import { BuildRefreshBanner } from "@/components/BuildRefreshBanner";
import { BUILD_ID } from "@/generated/build-id";
import "./globals.css";
import "@/styles/tutorial.css";

// Cloud-control side-effect import. Dynamic; webpack treeshakes it out
// when @qontinui/cloud-control isn't linked. The .catch() swallows the
// module-not-found that fires on OSS-only deployments.
import("@qontinui/cloud-control").catch(() => {});

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
  metadataBase: new URL("https://qontinui.io"),
  title: "Qontinui - Open Source AI Development Platform",
  description:
    "An open-source desktop app that orchestrates AI coding sessions with automated feedback loops, verification, and error monitoring. Multi-provider support for Claude and Gemini.",
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
  // Build-id mirrors the supervisor's `<meta name="build-id">` tag so
  // `useBuildIdWatcher` (from @qontinui/ui-bridge/react) picks it up
  // identically across hosts. Source of truth is the generated module
  // (regenerated on every `npm run build`); env var is the secondary path.
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID || BUILD_ID;
  return (
    <html lang="en" className="dark">
      <head>
        <meta name="build-id" content={buildId} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <DevDebugInit />
        <ErrorBoundary>
          <QueryProvider>
            <AuthProvider>
              <TutorialProvider>
                <WorkflowUIProvider>
                  <UIBridgeWrapper>
                    <RenderLogWrapper
                      enableOnMount={true}
                      enableMutationObserver={false}
                      mutationDebounceMs={500}
                    >
                      {children}
                      <ClientOverlays />
                      <BuildRefreshBanner />
                    </RenderLogWrapper>
                  </UIBridgeWrapper>
                </WorkflowUIProvider>
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
