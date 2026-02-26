"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  SETTINGS_ITEMS,
  isItemAvailable,
  type NavigationItem,
} from "qontinui-navigation";
import { resolveIcon } from "@/components/navigation/sidebar/icon-resolver";

function getSettingsNavItems(): {
  id: string;
  label: string;
  icon: React.ReactNode;
  href: string;
  description: string;
}[] {
  return SETTINGS_ITEMS.filter((item) => isItemAvailable(item, "web")).map(
    (item: NavigationItem) => ({
      id: item.id,
      label: item.label,
      icon: resolveIcon(item.icon, "size-4"),
      href: item.route ?? `/settings/${item.id.replace("settings-", "")}`,
      description: item.description ?? "",
    })
  );
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
      <nav className="w-56 shrink-0 border-r border-border-subtle/50 bg-surface-canvas/50 overflow-y-auto">
        <div className="p-3">
          <h2 className="px-3 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
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
                      ? "bg-brand-primary/10 text-brand-primary font-medium"
                      : "text-text-muted hover:text-text-primary hover:bg-surface-raised/50"
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
