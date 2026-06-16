"use client";

import { ChevronDown, FileText, LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface UserMenuProps {
  isCollapsed: boolean;
  user: {
    username?: string;
    email: string;
    tenant_id?: string | null;
    tenant_slug?: string | null;
  } | null;
  onLogout: () => void;
  onDocs: () => void;
}

function formatTenant(
  tenantSlug: string | null | undefined,
  tenantId: string | null | undefined,
): string {
  if (tenantSlug) return tenantSlug;
  if (tenantId) return tenantId;
  return "(not assigned)";
}

export function UserMenu({
  isCollapsed,
  user,
  onLogout,
  onDocs,
}: UserMenuProps) {
  if (!user) return null;

  const initials = user.username
    ? user.username.slice(0, 2).toUpperCase()
    : user.email.slice(0, 2).toUpperCase();

  const tenantLabel = formatTenant(user.tenant_slug, user.tenant_id);

  if (isCollapsed) {
    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button className="flex size-10 items-center justify-center rounded-md transition-colors hover:bg-surface-hover">
                <Avatar className="size-8">
                  <AvatarFallback
                    className="text-xs"
                    style={{
                      backgroundColor: "var(--brand-primary)",
                      color: "white",
                    }}
                  >
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Account</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{user.username || user.email}</p>
            <p className="text-xs text-text-muted">{user.email}</p>
            <p
              className="mt-1 truncate text-xs text-text-muted"
              data-testid="user-menu-tenant"
            >
              Tenant: <span className="font-mono">{tenantLabel}</span>
            </p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDocs}>
            <FileText className="mr-2 size-4" />
            Documentation
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onLogout} className="text-error">
            <LogOut className="mr-2 size-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-tutorial-id="sidebar-user-menu"
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-hover"
        >
          <Avatar className="size-7">
            <AvatarFallback
              className="text-[10px]"
              style={{
                backgroundColor: "var(--brand-primary)",
                color: "white",
              }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col items-start text-left">
            <span className="text-xs font-medium text-text-primary">
              {user.username || user.email.split("@")[0]}
            </span>
            <span className="truncate text-[11px] text-text-muted">
              {user.email}
            </span>
          </div>
          <ChevronDown className="size-3.5 shrink-0 text-text-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{user.username || user.email}</p>
          <p className="text-xs text-text-muted">{user.email}</p>
          <p
            className="mt-1 truncate text-xs text-text-muted"
            data-testid="user-menu-tenant"
          >
            Tenant: <span className="font-mono">{tenantLabel}</span>
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDocs}>
          <FileText className="mr-2 size-4" />
          Documentation
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} className="text-error">
          <LogOut className="mr-2 size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
