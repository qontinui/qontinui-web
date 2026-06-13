"use client";

import { useOrganization } from "@/hooks/useOrganization";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { RuleList } from "./_components/RuleList";

export default function AutoResponseRulesPage() {
  const { organizations, currentOrg, loading, switchOrg } = useOrganization();

  if (loading && organizations.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasMultiple = organizations.length > 1;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Auto-Response Rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fleet-wide rules that auto-respond to matching agent output. Rules
            apply to every runner in the organization.
          </p>
        </div>

        {hasMultiple && (
          <Select
            value={currentOrg?.id ?? undefined}
            onValueChange={(value) => void switchOrg(value)}
          >
            <SelectTrigger className="w-56 shrink-0">
              <SelectValue placeholder="Select organization" />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((org) => (
                <SelectItem key={org.id} value={org.id}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {organizations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            You don&apos;t belong to any organization yet. Create one to manage
            fleet-wide auto-response rules.
          </p>
        </div>
      ) : currentOrg ? (
        <RuleList key={currentOrg.id} orgId={currentOrg.id} />
      ) : null}
    </div>
  );
}
