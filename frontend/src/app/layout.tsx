import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/auth-context";
import { TutorialProvider } from "@/contexts/tutorial";
import { UIBridgeWrapper, RenderLogWrapper } from "@/lib/ui-bridge";
import { QueryProvider } from "@/lib/providers/query-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { ClientOverlays } from "@/components/ClientOverlays";
import { WorkflowUIProvider } from "@/lib/providers/workflow-ui-provider";
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
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
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
