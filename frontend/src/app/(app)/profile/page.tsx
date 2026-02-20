"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { profileService } from "@/services/service-factory";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProfileForm } from "@/components/profile/profile-form";
import { AvatarUpload } from "@/components/profile/avatar-upload";
import { StorageUsageCard } from "@/components/profile/storage-usage-card";
import { ActivityFeed } from "@/components/profile/activity-feed";
import { ArrowLeft, Crown, Shield, Cable } from "lucide-react";
import { toast } from "sonner";
import type {
  StorageUsage,
  ActivityLog,
  ProfileUpdateData,
} from "@/services/profile-service";
import type { User } from "@/types/auth-types";

export default function ProfilePage() {
  const { user, loading: authLoading, updateUser } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [activities, setActivities] = useState<ActivityLog[]>([]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
      return;
    }

    if (user) {
      loadProfileData();
    }
  }, [user, authLoading, router]);

  const loadProfileData = async () => {
    try {
      setLoading(true);

      // Load storage usage and activity in parallel
      const [storageData, activityData] = await Promise.all([
        profileService.getStorageUsage().catch(() => ({
          used_bytes: 524288000, // 500 MB default
          total_bytes: 5368709120, // 5 GB default
          used_percentage: 10,
        })),
        profileService.getActivity(10).catch(() => []),
      ]);

      setStorageUsage(storageData);
      setActivities(activityData);
    } catch (error) {
      console.error("Failed to load profile data:", error);
      toast.error("Failed to load some profile data");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async (data: ProfileUpdateData) => {
    await profileService.updateProfile(data);
    await updateUser(data as Partial<User>);
  };

  const handleUploadAvatar = async (file: File) => {
    return await profileService.uploadAvatar(file);
  };

  const handleDeleteAvatar = async () => {
    await profileService.deleteAvatar();
  };

  const handleBackToDashboard = () => {
    router.push("/build/workflows");
  };

  // Show loading while auth is checking
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  // Don't render anything if no user (will redirect)
  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToDashboard}
              className="text-text-muted hover:text-white"
              data-ui-id="profile-back-btn"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/connect-runner")}
              className="border-border-default hover:border-brand-primary hover:text-brand-primary bg-transparent"
              title="Connect Desktop Runner"
              data-ui-id="profile-connect-runner-btn"
            >
              <Cable className="w-4 h-4 mr-2" />
              Connect Runner
            </Button>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
              My Profile
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        {/* User Header Section */}
        <div
          className="mb-8"
          data-awas-action="get_current_user"
          data-ui-id="user-profile-header"
        >
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-3xl font-bold mb-2">
                {user.full_name || user.username}
              </h2>
              <p className="text-text-muted">@{user.username}</p>
            </div>
            <div className="flex items-center gap-2">
              {user.is_superuser && (
                <Badge className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 text-yellow-400 border-yellow-500/30">
                  <Crown className="w-3 h-3 mr-1" />
                  Admin
                </Badge>
              )}
              {user.is_beta && (
                <Badge className="bg-brand-secondary/20 text-brand-secondary border-brand-secondary/30">
                  <Shield className="w-3 h-3 mr-1" />
                  Beta User
                </Badge>
              )}
            </div>
          </div>
          <p className="text-sm text-text-muted">
            Member since{" "}
            {new Date(user.created_at).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="text-lg text-text-muted">
              Loading profile data...
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Profile Form and Avatar */}
            <div className="lg:col-span-2 space-y-6">
              <ProfileForm user={user} onUpdate={handleUpdateProfile} />

              <AvatarUpload
                userName={user.full_name || user.username}
                onUpload={handleUploadAvatar}
                onDelete={handleDeleteAvatar}
              />
            </div>

            {/* Right Column - Storage and Activity */}
            <div className="lg:col-span-1 space-y-6">
              {storageUsage && (
                <StorageUsageCard
                  usedBytes={storageUsage.used_bytes}
                  totalBytes={storageUsage.total_bytes}
                />
              )}

              <ActivityFeed activities={activities} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
