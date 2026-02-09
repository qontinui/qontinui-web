import type React from "react";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Suspense } from "react";
import { Header } from "@/components/marketing/header";
import { Footer } from "@/components/marketing/footer";
import "./marketing.css";

export const metadata: Metadata = {
  title: "Qontinui - Open Source AI Development Platform",
  description:
    "An open-source desktop app that orchestrates AI coding sessions with verification loops, error monitoring, and visual feedback through UI Bridge. Multi-provider support for Claude and Gemini — no vendor lock-in.",
};

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-16">
        <Suspense fallback={null}>{children}</Suspense>
      </main>
      <Footer />
      <Analytics />
    </div>
  );
}
