import React from "react";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Header } from "@/components/marketing/header";
import { Footer } from "@/components/marketing/footer";
import "./marketing.css";

export const metadata: Metadata = {
  title: "Qontinui - Open Source AI Development Platform",
  description:
    "An open-source desktop app that orchestrates AI coding sessions with automated feedback loops, verification, and error monitoring. Multi-provider support for Claude and Gemini — no vendor lock-in.",
  openGraph: {
    title: "Qontinui - Open Source AI Development Platform",
    description:
      "An open-source desktop app that orchestrates AI coding sessions with automated feedback loops, verification, and error monitoring. Multi-provider support for Claude and Gemini.",
    siteName: "Qontinui",
    images: [
      {
        url: "/q-logo.png",
        width: 512,
        height: 512,
        alt: "Qontinui Logo",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Qontinui - Open Source AI Development Platform",
    description:
      "An open-source desktop app that orchestrates AI coding sessions with automated feedback loops, verification, and error monitoring.",
    images: ["/q-logo.png"],
  },
};

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Qontinui",
    url: "https://qontinui.io",
    logo: "https://qontinui.io/q-logo.png",
    description:
      "An open-source desktop app that orchestrates AI coding sessions with automated feedback loops, verification, and error monitoring.",
  };

  return (
    <div className="min-h-screen flex flex-col">
      <script type="application/ld+json" suppressHydrationWarning>
        {JSON.stringify(jsonLd)}
      </script>
      <Header />
      {/* No Suspense boundary around `children`. A `fallback={null}` boundary
          here bought no fallback UI and cost the page its server-rendered
          body: React's streaming SSR deferred the whole `<main>` out-of-order
          into a `<div hidden id="S:n">` staging container, so the HTML this
          route actually serves carried an EMPTY `<main>` (measured: 48 bytes
          of boundary markers) and the content appeared only after the
          client-side reveal. On public marketing and docs pages that is the
          content that most wants to be in the first response. It also opened
          a window in which the page was in the DOM twice — the client copy
          plus the staged one — which is what broke 20 Playwright assertions
          on shard 3 of run 34039419789. Pages under this layout that call
          `useSearchParams()` (`/login`, `/auth/callback`) carry their own
          boundary. */}
      <main className="flex-1 pt-16">{children}</main>
      <Footer />
      <Analytics />
    </div>
  );
}
