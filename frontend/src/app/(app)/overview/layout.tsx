/**
 * Project Overview — the section written for business leaders overseeing a
 * project (plan `2026-09-19-project-overview-for-business-leaders`).
 *
 * A server layout only so the section's reading face can be loaded with
 * `next/font` here, scoped to the overview, instead of app-wide. Everything
 * interactive lives in the client `OverviewShell`.
 */

import { Newsreader } from "next/font/google";
import { OverviewShell } from "./_components/OverviewShell";

// The overview reads like a project brief, not an operator console: page and
// section headings are set in a text serif, body copy stays in the app's Geist.
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-overview-serif",
  display: "swap",
});

export default function OverviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${newsreader.variable} h-full`}>
      <OverviewShell>{children}</OverviewShell>
    </div>
  );
}
