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
import { TelemetryBeaconInit } from "@/components/telemetry/telemetry-beacon-init";
import { SpecCiInit } from "@/lib/ui-bridge/spec-ci-init";
import { ClientOverlays } from "@/components/ClientOverlays";
import { WorkflowUIProvider } from "@/lib/providers/workflow-ui-provider";
import { BuildRefreshBanner } from "@/components/BuildRefreshBanner";
import { CloudExtensionsBoot } from "@/components/cloud-extensions-boot";
import { BUILD_ID } from "@/generated/build-id";
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

// Icons are file-based, beside this file, all from `public/q-logo.png`, whose
// 152×177 frame is not square and so cannot serve as an icon itself:
// `favicon.ico`, `icon1.png` (32×32) and `icon2.png` (48×48) are square
// downscales; `apple-icon.png` (180×180) is the mark at its own size, centred
// on an opaque tile of the design-token canvas. There is no `icon.svg` yet.
// It needs a vector master of the mark, no repo holds one, and a vtracer
// trace of the raster was measured and was not faithful. The social cards
// are file-based too (`opengraph-image.tsx` and `twitter-image.tsx` here and
// in `(marketing)/`).
export const metadata: Metadata = {
  metadataBase: new URL("https://qontinui.io"),
  title: "Qontinui - Open-Source Software Factory for AI Agents",
  description:
    "An open-source software factory: a fleet of AI agents plans, implements, tests and lands changes on your own codebase, against a digital twin of your development process, so they answer their own questions instead of asking you.",
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
        {/* Registers @qontinui/cloud-control's services, components and
            context providers into
            `@/lib/extension-slots` in the composed cloud build, and does
            nothing in OSS-only builds. This layout is a Server Component, so
            the registration CANNOT live in this module — the boot module
            carries "use client" precisely so the import evaluates in the
            browser graph that every slot consumer reads. See
            `docs/composed-cloud-build.md`. */}
        <CloudExtensionsBoot />
        <DevDebugInit />
        {/* Ξ_ClientTelemetry beacon. Pure no-op unless
            NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED==="1" (counsel-review gate —
            see telemetry-beacon-init.tsx / beacon.ts). */}
        <TelemetryBeaconInit />
        <SpecCiInit />
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
