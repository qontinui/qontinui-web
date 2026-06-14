"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  SETTINGS_ITEMS,
  isItemAvailable,
  type NavigationItem,
} from "@qontinui/navigation";
import { resolveIcon } from "@/components/navigation/sidebar/icon-resolver";

/**
 * Locally-defined extra settings entries that haven't been added to the
 * shared ``qontinui-navigation`` package yet. The co-pilot entry is
 * §4.5 of the production-safe UI Bridge plan; we surface it here
 * directly rather than gating on a navigation-package release.
 */
const LOCAL_EXTRA_SETTINGS: NavigationItem[] = [
  {
    id: "settings-co-pilot",
    label: "AI Co-Pilot",
    icon: "Bot",
    description: "Opt in to the AI co-pilot and view activity audit log",
    route: "/settings/co-pilot",
    color: "#FFD700",
  },
  {
    id: "settings-notifications",
    label: "Notifications",
    icon: "Bell",
    description: "Per-type notification delivery preferences (in-app and email)",
    route: "/settings/notifications",
    color: "#FFD700",
    platforms: ["web"],
  },
  {
    id: "settings-auto-response",
    label: "Auto-Response Rules",
    icon: "MessageSquare",
    description:
      "Fleet-wide rules that auto-respond to matching agent output",
    route: "/settings/auto-response",
    color: "#FFD700",
    platforms: ["web"],
  },
];

function getSettingsNavItems(): {
  id: string;
  label: string;
  icon: React.ReactNode;
  href: string;
  description: string;
}[] {
  return [...SETTINGS_ITEMS, ...LOCAL_EXTRA_SETTINGS]
    .filter((item) => isItemAvailable(item, "web"))
    .map((item: NavigationItem) => ({
      id: item.id,
      label: item.label,
      icon: resolveIcon(item.icon, "size-4"),
      href: item.route ?? `/settings/${item.id.replace("settings-", "")}`,
      description: item.description ?? "",
    }));
}

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const visibleItems = getSettingsNavItems();

  return (
    <div className="flex h-full">
      {/* Settings Sidebar */}
      <nav className="w-56 shrink-0 border-r border-border bg-background overflow-y-auto">
        <div className="p-3">
          <h2 className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Settings
          </h2>
          <div className="space-y-0.5">
            {visibleItems.map((item) => {
              const isActive =
                pathname === item.href || pathname?.startsWith(item.href + "/");
              return (
                <button
                  key={item.id}
                  onClick={() => router.push(item.href)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <span className="shrink-0">{item.icon}</span>
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
