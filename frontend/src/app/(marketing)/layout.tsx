import type React from "react"
import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import { Suspense } from "react"
import "./marketing.css"

export const metadata: Metadata = {
  title: "Qontinui - GUI Automation That Thinks Like You Do",
  description:
    "Model-based GUI automation that adapts to unexpected changes instead of breaking. Beta access available now.",
  generator: "v0.app",
}

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <>
      <Suspense fallback={null}>{children}</Suspense>
      <Analytics />
    </>
  )
}
