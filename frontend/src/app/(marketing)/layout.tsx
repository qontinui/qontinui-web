import React from "react";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Header } from "@/components/marketing/header";
import { Footer } from "@/components/marketing/footer";
import "./marketing.css";

// Card images come from `opengraph-image.tsx` / `twitter-image.tsx` beside
// this layout, never from `images` here. This object REPLACES the openGraph
// and twitter objects inherited from the root, cards included, so this
// segment needs its own card files. And Next merges a file-based card only
// into a segment whose own `openGraph` / `twitter` has no `images` key. So
// declaring `images` here silently drops the generated card; that is how
// this layout once served the 152×177 `q-logo.png` declared as 512×512.
// Copy follows the served intent documents (plan
// 2026-10-09-qontinui-marketing-studio-animated-process-explainers, D5:
// `product_intent/vision`, audience `audience_profile/external-operator`).
export const metadata: Metadata = {
  title: "Qontinui - Open-Source Software Factory for AI Agents",
  description:
    "An open-source software factory: a fleet of AI agents plans, implements, tests and lands changes on your own codebase, against a digital twin of your development process, so they answer their own questions instead of asking you.",
  openGraph: {
    title: "Qontinui - Open-Source Software Factory for AI Agents",
    description:
      "A fleet of AI agents that plans, implements, tests and lands changes on your own codebase, against a digital twin of your development process.",
    siteName: "Qontinui",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Qontinui - Open-Source Software Factory for AI Agents",
    description:
      "A fleet of AI agents that plans, implements, tests and lands changes on your own codebase, against a digital twin of your development process.",
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
      "A fleet of AI agents that plans, implements, tests and lands changes on your own codebase, against a digital twin of your development process.",
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
