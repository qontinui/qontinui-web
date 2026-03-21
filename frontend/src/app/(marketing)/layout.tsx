import React, { Suspense } from "react";
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
      <script
        type="application/ld+json"
        suppressHydrationWarning
      >
        {JSON.stringify(jsonLd)}
      </script>
      <Header />
      <main className="flex-1 pt-16">
        <Suspense fallback={null}>{children}</Suspense>
      </main>
      <Footer />
      <Analytics />
    </div>
  );
}
