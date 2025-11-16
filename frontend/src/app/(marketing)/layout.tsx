import type React from "react"
import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import { Suspense } from "react"
import { Header } from "@/components/marketing/header"
import { Footer } from "@/components/marketing/footer"
import "./marketing.css"

export const metadata: Metadata = {
  title: "Qontinui - GUI Automation That Thinks Like You Do",
  description:
    "Model-based GUI automation that adapts to unexpected changes instead of breaking. Based on peer-reviewed research published in Springer. Free during early access until February 2026.",
  generator: "v0.app",
}

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode
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
  )
}
