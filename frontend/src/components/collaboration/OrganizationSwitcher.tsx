'use client';

import * as React from 'react';
import {
  Building2,
  Check,
  ChevronsUpDown,
  Plus,
  Users,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export interface Organization {
  id: string;
  name: string;
  avatar_url?: string;
  member_count: number;
  role: 'owner' | 'admin' | 'member' | 'viewer';
}

interface OrganizationSwitcherProps {
  organizations: Organization[];
  currentOrganization: Organization | null;
  onOrganizationChange: (orgId: string) => void;
  onCreateOrganization: () => void;
  loading?: boolean;
  className?: string;
}

export function OrganizationSwitcher({
  organizations,
  currentOrganization,
  onOrganizationChange,
  onCreateOrganization,
  loading = false,
  className,
}: OrganizationSwitcherProps) {
  const [open, setOpen] = React.useState(false);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select organization"
          className={cn('w-full justify-between', className)}
          disabled={loading}
        >
          {loading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading...</span>
            </div>
          ) : currentOrganization ? (
            <div className="flex items-center gap-2 min-w-0">
              <Avatar
                src={currentOrganization.avatar_url}
                fallback={
                  <Building2 className="h-4 w-4" />
                }
                className="h-6 w-6"
              />
              <span className="truncate">{currentOrganization.name}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">Select organization</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[280px]" align="start">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-[300px] overflow-y-auto">
          {organizations.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onSelect={() => {
                onOrganizationChange(org.id);
                setOpen(false);
              }}
              className="cursor-pointer"
            >
              <div className="flex items-center justify-between w-full gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Avatar
                    src={org.avatar_url}
                    fallback={
                      <span className="text-xs font-medium">
                        {getInitials(org.name)}
                      </span>
                    }
                    className="h-8 w-8"
                  />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="truncate font-medium">{org.name}</span>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      <span>
                        {org.member_count}{' '}
                        {org.member_count === 1 ? 'member' : 'members'}
                      </span>
                    </div>
                  </div>
                </div>
                {currentOrganization?.id === org.id && (
                  <Check className="h-4 w-4 shrink-0" />
                )}
              </div>
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            onCreateOrganization();
            setOpen(false);
          }}
          className="cursor-pointer"
        >
          <Plus className="mr-2 h-4 w-4" />
          <span>Create New Organization</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
