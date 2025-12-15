"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useOrganization } from "@/hooks/useOrganization";
import { organizationService } from "@/services/service-factory";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Users,
  Building2,
  Settings,
  Activity,
  Loader2,
  UserPlus,
  FolderOpen,
} from "lucide-react";
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
  const [, _setActivities] = useState<ActivityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

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
        // Load organization details
        await switchOrg(orgId);
        const org = await organizationService.getOrganization(orgId);
        setOrganization(org);

        // Load statistics
        try {
          const stats = await organizationService.getStatistics(orgId);
          setStatistics(stats);
        } catch (err) {
          console.error("Failed to load statistics:", err);
        }

        // Load members
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
  }, [orgId, user]);

  const getUserRole = (org: Organization | null, userId: string): string => {
    if (!org) return "Member";
    if (org.owner_id === userId) return "Owner";
    return "Member";
  };

  const getRoleBadgeColor = (org: Organization | null, userId: string) => {
    if (!org) return "bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30";
    if (org.owner_id === userId) {
      return "bg-[#BD00FF]/20 text-[#BD00FF] border-[#BD00FF]/30";
    }
    return "bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30";
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
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-[#00D9FF]" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
        <div className="p-6 max-w-7xl mx-auto">
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-[#00D9FF]" />
            <p className="text-gray-400">Loading organization...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !organization) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
        <div className="p-6 max-w-7xl mx-auto">
          <Card className="bg-[#1A1A1B]/50 border-red-500/50 backdrop-blur-sm">
            <CardContent className="p-8 text-center">
              <p className="text-red-400 mb-4">Failed to load organization</p>
              <Button
                onClick={() => router.push("/organizations")}
                variant="outline"
                className="border-gray-700 hover:border-[#00D9FF]"
              >
                Back to Organizations
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => router.push("/organizations")}
            className="mb-4 text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Organizations
          </Button>

          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold">{organization.name}</h1>
                <Badge className={getRoleBadgeColor(organization, user.id)}>
                  {getUserRole(organization, user.id)}
                </Badge>
              </div>
              {organization.description && (
                <p className="text-gray-400 mb-2">{organization.description}</p>
              )}
              <p className="text-sm text-gray-500">
                Created {getRelativeTime(organization.created_at)} • Updated{" "}
                {getRelativeTime(organization.updated_at)}
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => router.push(`/organizations/${orgId}/members`)}
                className="bg-[#00D9FF]/10 hover:bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/30"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Manage Members
              </Button>
              {organization.owner_id === user.id && (
                <Button
                  onClick={() =>
                    router.push(`/organizations/${orgId}/settings`)
                  }
                  variant="outline"
                  className="border-gray-700 hover:border-[#BD00FF] hover:text-[#BD00FF]"
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-[#00D9FF]/20 rounded-lg flex items-center justify-center">
                  <Users className="w-6 h-6 text-[#00D9FF]" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">Members</p>
                  <p className="text-2xl font-bold text-[#00D9FF]">
                    {statistics?.member_count ?? organization.member_count}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-[#BD00FF]/20 rounded-lg flex items-center justify-center">
                  <FolderOpen className="w-6 h-6 text-[#BD00FF]" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">Projects</p>
                  <p className="text-2xl font-bold text-[#BD00FF]">
                    {statistics?.project_count ?? organization.project_count}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-[#00FF88]/20 rounded-lg flex items-center justify-center">
                  <Activity className="w-6 h-6 text-[#00FF88]" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">Active Today</p>
                  <p className="text-2xl font-bold text-[#00FF88]">
                    {statistics?.active_users_today ?? 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gray-500/20 rounded-lg flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-gray-400" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">Workflows</p>
                  <p className="text-2xl font-bold text-gray-300">
                    {statistics?.total_workflows ?? 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Content Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="bg-[#1A1A1B]/50 border border-gray-800/50">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Organization Info */}
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Organization Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-400 mb-1">Name</p>
                    <p className="text-lg font-medium">{organization.name}</p>
                  </div>
                  {organization.description && (
                    <div>
                      <p className="text-sm text-gray-400 mb-1">Description</p>
                      <p className="text-gray-300">
                        {organization.description}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-gray-400 mb-1">Created</p>
                    <p className="text-gray-300">
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
                    <p className="text-sm text-gray-400 mb-1">Last Updated</p>
                    <p className="text-gray-300">
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
                </CardContent>
              </Card>

              {/* Quick Actions */}
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Quick Actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button
                    onClick={() =>
                      router.push(`/organizations/${orgId}/members`)
                    }
                    className="w-full justify-start bg-[#00D9FF]/10 hover:bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/30"
                  >
                    <Users className="w-4 h-4 mr-2" />
                    View All Members
                  </Button>
                  {organization.owner_id === user.id && (
                    <>
                      <Button
                        onClick={() =>
                          router.push(`/organizations/${orgId}/settings`)
                        }
                        className="w-full justify-start bg-[#BD00FF]/10 hover:bg-[#BD00FF]/20 text-[#BD00FF] border border-[#BD00FF]/30"
                      >
                        <Settings className="w-4 h-4 mr-2" />
                        Organization Settings
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Members Tab */}
          <TabsContent value="members">
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Team Members ({members.length})</CardTitle>
                  <Button
                    onClick={() =>
                      router.push(`/organizations/${orgId}/members`)
                    }
                    size="sm"
                    className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
                  >
                    <UserPlus className="w-4 h-4 mr-2" />
                    Invite Members
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {members.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No members found</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {members.slice(0, 5).map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-[#0A0A0B]/50 hover:bg-[#0A0A0B]/80 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-[#00D9FF] to-[#BD00FF] rounded-full flex items-center justify-center text-sm font-bold">
                            {(member.name || member.email)
                              .charAt(0)
                              .toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium">
                              {member.name || "Unknown"}
                            </p>
                            <p className="text-sm text-gray-400">
                              {member.email}
                            </p>
                          </div>
                        </div>
                        <Badge
                          className={`
                          ${member.role === "owner" ? "bg-[#BD00FF]/20 text-[#BD00FF] border-[#BD00FF]/30" : ""}
                          ${member.role === "admin" ? "bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30" : ""}
                          ${member.role === "member" ? "bg-gray-500/20 text-gray-400 border-gray-500/30" : ""}
                          ${member.role === "viewer" ? "bg-gray-600/20 text-gray-500 border-gray-600/30" : ""}
                        `}
                        >
                          {member.role}
                        </Badge>
                      </div>
                    ))}
                    {members.length > 5 && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          router.push(`/organizations/${orgId}/members`)
                        }
                        className="w-full text-[#00D9FF] hover:text-[#00D9FF]/80"
                      >
                        View all {members.length} members
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity">
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-gray-400">
                  <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No recent activity</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
