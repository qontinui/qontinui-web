"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { profileService } from "@/services/service-factory";
import { Badge } from "@/components/ui/badge";
import { ProfileForm } from "@/components/profile/profile-form";
import { AvatarUpload } from "@/components/profile/avatar-upload";
import { StorageUsageCard } from "@/components/profile/storage-usage-card";
import { ActivityFeed } from "@/components/profile/activity-feed";
import { Button } from "@/components/ui/button";
import { Crown, Shield, ArrowLeft, Cable } from "lucide-react";
import { toast } from "sonner";
import type {
  StorageUsage,
  ActivityLog,
  ProfileUpdateData,
} from "@/services/profile-service";
import type { User } from "@/types/auth-types";

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [activities, setActivities] = useState<ActivityLog[]>([]);

  useEffect(() => {
    if (user) {
      loadProfileData();
    }
  }, [user]);

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

  if (!user) {
    return null;
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/build/workflows")}
            data-testid="profile-back-btn"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Dashboard
          </Button>
          <h1 className="text-lg font-semibold">My Profile</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/profile/runner")}
          data-testid="profile-connect-runner-btn"
        >
          <Cable className="w-4 h-4 mr-1" />
          Connect Runner
        </Button>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6">
        {/* User Header Section */}
        <div
          className="mb-8"
          data-awas-action="get_current_user"
          data-testid="user-profile-header"
        >
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-xl font-semibold mb-1">
                {user.full_name || user.username}
              </h2>
              <p className="text-muted-foreground">@{user.username}</p>
            </div>
            <div className="flex items-center gap-2">
              {user.is_superuser && (
                <Badge className="bg-yellow-500/10 text-yellow-500">
                  <Crown className="w-3 h-3 mr-1" />
                  Admin
                </Badge>
              )}
              {user.is_beta && (
                <Badge className="bg-primary/10 text-primary">
                  <Shield className="w-3 h-3 mr-1" />
                  Beta User
                </Badge>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
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
            <div className="text-lg text-muted-foreground">
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
