"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDate } from "./types";

export default function OverviewLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const links = [
    { label: "Summary", href: "/overview" },
    { label: "Timeline", href: "/overview/timeline" },
    { label: "Costs", href: "/overview/financials" },
    { label: "Team", href: "/overview/team" },
    { label: "Risks", href: "/overview/risks" },
    { label: "Diagrams", href: "/overview/diagrams" },
    { label: "Documents", href: "/overview/documents" },
    { label: "Wiki", href: "/overview/wiki" },
    { label: "Slides", href: "/overview/slides" },
  ] as const;

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col" data-ui-bridge-id="overview.shell">
      <header className="border-b bg-card/70" data-ui-bridge-id="overview.header">
        <div className="px-6 py-5">
          <p className="text-sm font-medium text-muted-foreground">Project overview</p>
          <h1 className="text-2xl font-semibold tracking-tight">Warehouse Analytics Platform</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A modern analytics platform for warehouse operations.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Last updated {formatDate("2026-09-18")}</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-6" aria-label="Project sections" data-ui-bridge-id="overview.subnav">
          {links.map(({ label, href }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-sm transition-colors hover:text-foreground ${
                  isActive ? "border-primary text-foreground" : "text-muted-foreground"
                }`}
                aria-current={isActive ? "page" : undefined}
                data-ui-bridge-id={`overview.subnav.${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>
      <ScrollArea className="flex-1">
        <main>{children}</main>
      </ScrollArea>
    </div>
  );
}
