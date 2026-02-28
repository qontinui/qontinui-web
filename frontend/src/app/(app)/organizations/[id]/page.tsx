"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useOrganization } from "@/hooks/useOrganization";
import { organizationService } from "@/services/service-factory";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Settings, Activity, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type {
  Organization,
  OrganizationStatistics,
  Activity as ActivityType,
} from "@/types/collaboration";

export default function OrganizationDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const orgId = params?.id as string;

  const { user, loading: authLoading } = useAuth();
  const { switchOrg, members, getMembers } = useOrganization();

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [statistics, setStatistics] = useState<OrganizationStatistics | null>(
    null
  );
  const [_activities, _setActivities] = useState<ActivityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [activeTab, setActiveTab] = useState<
    "overview" | "members" | "activity"
  >("overview");

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!orgId || !user) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      try {
        await switchOrg(orgId);
        const org = await organizationService.getOrganization(orgId);
        setOrganization(org);

        try {
          const stats = await organizationService.getStatistics(orgId);
          setStatistics(stats);
        } catch (err) {
          console.error("Failed to load statistics:", err);
        }

        await getMembers(orgId);
      } catch (err) {
        console.error("Failed to load organization:", err);
        setError(err as Error);
        toast.error("Failed to load organization details");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [orgId, user, switchOrg, getMembers]);

  const getUserRole = (org: Organization | null, userId: string): string => {
    if (!org) return "Member";
    if (org.owner_id === userId) return "Owner";
    return "Member";
  };

  const getRoleBadgeColor = (org: Organization | null, userId: string) => {
    if (!org) return "bg-primary/10 text-primary";
    if (org.owner_id === userId) {
      return "bg-primary/10 text-primary";
    }
    return "bg-primary/10 text-primary";
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

  if (loading) {
    return (
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Loading organization...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !organization) {
    return (
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-400 mb-4">Failed to load organization</p>
            <Button
              onClick={() => router.push("/organizations")}
              variant="outline"
              className="border-border hover:border-primary"
            >
              Back to Organizations
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{organization.name}</h1>
          <Badge className={getRoleBadgeColor(organization, user.id)}>
            {getUserRole(organization, user.id)}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => router.push(`/organizations/${orgId}/members`)}
            variant="outline"
            size="sm"
            className="border-border"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Manage Members
          </Button>
          {organization.owner_id === user.id && (
            <Button
              onClick={() => router.push(`/organizations/${orgId}/settings`)}
              variant="outline"
              size="sm"
              className="border-border"
            >
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-px bg-border shrink-0">
        <div className="bg-background px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Members
          </p>
          <p className="text-xl font-semibold tabular-nums mt-1">
            {statistics?.member_count ?? organization.member_count}
          </p>
        </div>
        <div className="bg-background px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Projects
          </p>
          <p className="text-xl font-semibold tabular-nums mt-1">
            {statistics?.project_count ?? organization.project_count}
          </p>
        </div>
        <div className="bg-background px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Active Today
          </p>
          <p className="text-xl font-semibold tabular-nums mt-1">
            {statistics?.active_users_today ?? 0}
          </p>
        </div>
        <div className="bg-background px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Workflows
          </p>
          <p className="text-xl font-semibold tabular-nums mt-1">
            {statistics?.total_workflows ?? 0}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 px-6 py-2 border-b border-border shrink-0">
        {(["overview", "members", "activity"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-sm rounded-md capitalize ${
              activeTab === tab
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Organization Details
              </h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Name</p>
                  <p className="text-sm font-medium">{organization.name}</p>
                </div>
                {organization.description && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">
                      Description
                    </p>
                    <p className="text-sm text-foreground">
                      {organization.description}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">
                    Created
                  </p>
                  <p className="text-sm text-foreground">
                    {new Date(organization.created_at).toLocaleDateString(
                      "en-US",
                      {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      }
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">
                    Last Updated
                  </p>
                  <p className="text-sm text-foreground">
                    {new Date(organization.updated_at).toLocaleDateString(
                      "en-US",
                      {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      }
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Quick Actions
              </h3>
              <div className="space-y-2">
                <Button
                  onClick={() => router.push(`/organizations/${orgId}/members`)}
                  variant="outline"
                  className="w-full justify-start border-border"
                >
                  <Users className="w-4 h-4 mr-2" />
                  View All Members
                </Button>
                {organization.owner_id === user.id && (
                  <Button
                    onClick={() =>
                      router.push(`/organizations/${orgId}/settings`)
                    }
                    variant="outline"
                    className="w-full justify-start border-border"
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    Organization Settings
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "members" && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Team Members ({members.length})
              </h3>
              <Button
                onClick={() => router.push(`/organizations/${orgId}/members`)}
                size="sm"
                className="bg-primary text-primary-foreground"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Invite Members
              </Button>
            </div>
            {members.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No members found</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                  <tr>
                    <th className="text-left text-xs text-muted-foreground uppercase tracking-wider font-medium px-4 py-2">
                      Member
                    </th>
                    <th className="text-left text-xs text-muted-foreground uppercase tracking-wider font-medium px-4 py-2">
                      Email
                    </th>
                    <th className="text-left text-xs text-muted-foreground uppercase tracking-wider font-medium px-4 py-2">
                      Role
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.slice(0, 5).map((member) => (
                    <tr key={member.id} className="hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center text-xs font-bold text-primary">
                            {(member.name || member.email)
                              .charAt(0)
                              .toUpperCase()}
                          </div>
                          <span className="font-medium text-sm">
                            {member.name || "Unknown"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {member.email}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={`text-xs ${
                            member.role === "owner"
                              ? "bg-primary/10 text-primary"
                              : member.role === "admin"
                                ? "bg-blue-500/10 text-blue-500"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {member.role}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {members.length > 5 && (
              <div className="mt-3">
                <Button
                  variant="ghost"
                  onClick={() => router.push(`/organizations/${orgId}/members`)}
                  className="w-full text-sm text-primary hover:text-primary/80"
                >
                  View all {members.length} members
                </Button>
              </div>
            )}
          </div>
        )}

        {activeTab === "activity" && (
          <div className="p-6">
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No recent activity</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
