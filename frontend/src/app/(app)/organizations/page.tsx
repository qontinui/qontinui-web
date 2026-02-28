"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Building2, ArrowRight, Loader2 } from "lucide-react";
import type { Organization } from "@/types/collaboration";

export default function OrganizationsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { organizations, loading, error, refresh } = useOrganization();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  const getRoleBadgeColor = (org: Organization, userId: string) => {
    if (org.owner_id === userId) {
      return "bg-primary/10 text-primary";
    }
    return "bg-primary/10 text-primary";
  };

  const getUserRole = (org: Organization, userId: string): string => {
    if (org.owner_id === userId) {
      return "Owner";
    }
    return "Member";
  };

  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60)
    );

    if (diffInHours < 1) return "Just now";
    if (diffInHours < 24) return `${diffInHours} hours ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return "1 day ago";
    return `${diffInDays} days ago`;
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Organizations</h1>
        <Button
          onClick={() => router.push("/organizations/new")}
          className="bg-primary text-primary-foreground"
          size="sm"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Organization
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-px bg-border shrink-0">
        <div className="bg-background px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Total Organizations
          </p>
          <p className="text-xl font-semibold tabular-nums mt-1">
            {organizations.length}
          </p>
        </div>
        <div className="bg-background px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Total Members
          </p>
          <p className="text-xl font-semibold tabular-nums mt-1">
            {organizations.reduce((sum, org) => sum + org.member_count, 0)}
          </p>
        </div>
        <div className="bg-background px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Owned by You
          </p>
          <p className="text-xl font-semibold tabular-nums mt-1">
            {organizations.filter((org) => org.owner_id === user.id).length}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Loading organizations...</p>
          </div>
        ) : error ? (
          <div className="px-6 py-8 text-center">
            <p className="text-red-400 mb-4">Failed to load organizations</p>
            <Button
              onClick={() => refresh()}
              variant="outline"
              className="border-border hover:border-primary"
            >
              Try Again
            </Button>
          </div>
        ) : organizations.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Building2 className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <h4 className="text-sm font-medium mb-1 text-muted-foreground">
              No organizations yet
            </h4>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first organization to collaborate with your team
            </p>
            <Button
              onClick={() => router.push("/organizations/new")}
              className="bg-primary text-primary-foreground"
              size="sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Organization
            </Button>
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
              <tr>
                <th className="text-left text-xs text-muted-foreground uppercase tracking-wider font-medium px-6 py-2">
                  Name
                </th>
                <th className="text-left text-xs text-muted-foreground uppercase tracking-wider font-medium px-6 py-2">
                  Description
                </th>
                <th className="text-left text-xs text-muted-foreground uppercase tracking-wider font-medium px-6 py-2">
                  Role
                </th>
                <th className="text-right text-xs text-muted-foreground uppercase tracking-wider font-medium px-6 py-2">
                  Members
                </th>
                <th className="text-right text-xs text-muted-foreground uppercase tracking-wider font-medium px-6 py-2">
                  Projects
                </th>
                <th className="text-right text-xs text-muted-foreground uppercase tracking-wider font-medium px-6 py-2">
                  Updated
                </th>
                <th className="w-10 px-6 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {organizations.map((org) => (
                <tr
                  key={org.id}
                  className="hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/organizations/${org.id}`)}
                >
                  <td className="px-6 py-3 font-medium">{org.name}</td>
                  <td className="px-6 py-3 text-sm text-muted-foreground truncate max-w-[300px]">
                    {org.description || "\u2014"}
                  </td>
                  <td className="px-6 py-3">
                    <Badge
                      className={`${getRoleBadgeColor(org, user.id)} text-xs`}
                    >
                      {getUserRole(org, user.id)}
                    </Badge>
                  </td>
                  <td className="px-6 py-3 text-sm text-muted-foreground text-right tabular-nums">
                    {org.member_count}
                  </td>
                  <td className="px-6 py-3 text-sm text-muted-foreground text-right tabular-nums">
                    {org.project_count}
                  </td>
                  <td className="px-6 py-3 text-sm text-muted-foreground text-right">
                    {getRelativeTime(org.updated_at)}
                  </td>
                  <td className="px-6 py-3">
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
