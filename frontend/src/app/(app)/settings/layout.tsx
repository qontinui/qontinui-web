"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  User,
  Bot,
  Brain,
  ShieldCheck,
  FlaskConical,
  Monitor,
  Wifi,
  FolderOpen,
  Wrench,
  HardDrive,
  Archive,
  Download,
  type LucideIcon,
} from "lucide-react";

interface SettingsNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  description: string;
  hidden?: boolean;
}

const SETTINGS_NAV: SettingsNavItem[] = [
  {
    id: "account",
    label: "Account",
    icon: User,
    href: "/settings/account",
    description: "Connection and identity",
  },
  {
    id: "ai",
    label: "AI Providers",
    icon: Bot,
    href: "/settings/ai",
    description: "AI provider configuration",
  },
  {
    id: "agentic",
    label: "Advanced AI",
    icon: Brain,
    href: "/settings/agentic",
    description: "Memory, retry, routing",
  },
  {
    id: "self-healing",
    label: "Self-Healing",
    icon: ShieldCheck,
    href: "/settings/self-healing",
    description: "Automation recovery",
  },
  {
    id: "playwright",
    label: "Playwright",
    icon: FlaskConical,
    href: "/settings/playwright",
    description: "Test configuration",
  },
  {
    id: "mobile",
    label: "Mobile",
    icon: Monitor,
    href: "/settings/mobile",
    description: "ADB device settings",
    hidden: true,
  },
  {
    id: "mcp",
    label: "MCP Servers",
    icon: Wifi,
    href: "/settings/mcp",
    description: "External tool servers",
  },
  {
    id: "log-sources",
    label: "Log Sources",
    icon: FolderOpen,
    href: "/settings/log-sources",
    description: "Global log configuration",
  },
  {
    id: "general",
    label: "General",
    icon: Wrench,
    href: "/settings/general",
    description: "Application preferences",
  },
  {
    id: "storage",
    label: "Storage",
    icon: HardDrive,
    href: "/settings/storage",
    description: "Local file management",
  },
  {
    id: "backup",
    label: "Backup",
    icon: Archive,
    href: "/settings/backup",
    description: "Export and restore data",
  },
  {
    id: "updates",
    label: "Updates",
    icon: Download,
    href: "/settings/updates",
    description: "Version and updates",
  },
  {
    id: "debug",
    label: "Debug",
    icon: FlaskConical,
    href: "/settings/debug",
    description: "Diagnostics and debug",
  },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const visibleItems = SETTINGS_NAV.filter((item) => !item.hidden);

  return (
    <div className="flex h-full">
      {/* Settings Sidebar */}
      <nav className="w-56 shrink-0 border-r border-border-subtle/50 bg-surface-canvas/50 overflow-y-auto">
        <div className="p-3">
          <h2 className="px-3 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
            Settings
          </h2>
          <div className="space-y-0.5">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href || pathname?.startsWith(item.href + "/");
              return (
                <button
                  key={item.id}
                  onClick={() => router.push(item.href)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                    isActive
                      ? "bg-brand-primary/10 text-brand-primary font-medium"
                      : "text-text-muted hover:text-text-primary hover:bg-surface-raised/50"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Settings Content */}
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
