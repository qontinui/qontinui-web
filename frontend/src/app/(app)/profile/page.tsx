"use client"

export const dynamic = 'force-dynamic'

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { profileService } from "@/services/service-factory"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ProfileForm } from "@/components/profile/profile-form"
import { AvatarUpload } from "@/components/profile/avatar-upload"
import { StorageUsageCard } from "@/components/profile/storage-usage-card"
import { ActivityFeed } from "@/components/profile/activity-feed"
import { ArrowLeft, Crown, Shield } from "lucide-react"
import { toast } from "sonner"
import type { StorageUsage, ActivityLog } from "@/services/profile-service"

export default function ProfilePage() {
  const { user, loading: authLoading, updateUser } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null)
  const [activities, setActivities] = useState<ActivityLog[]>([])

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/')
      return
    }

    if (user) {
      loadProfileData()
    }
  }, [user, authLoading, router])

  const loadProfileData = async () => {
    try {
      setLoading(true)

      // Load storage usage and activity in parallel
      const [storageData, activityData] = await Promise.all([
        profileService.getStorageUsage().catch(() => ({
          used_bytes: 524288000, // 500 MB default
          total_bytes: 5368709120, // 5 GB default
          used_percentage: 10
        })),
        profileService.getActivity(10).catch(() => [])
      ])

      setStorageUsage(storageData)
      setActivities(activityData)
    } catch (error) {
      console.error('Failed to load profile data:', error)
      toast.error('Failed to load some profile data')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateProfile = async (data: any) => {
    await profileService.updateProfile(data)
    await updateUser(data)
  }

  const handleUploadAvatar = async (file: File) => {
    return await profileService.uploadAvatar(file)
  }

  const handleDeleteAvatar = async () => {
    await profileService.deleteAvatar()
  }

  const handleBackToDashboard = () => {
    router.push('/dashboard')
  }

  // Show loading while auth is checking
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    )
  }

  // Don't render anything if no user (will redirect)
  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      {/* Header */}
      <header className="border-b border-gray-800/50 bg-[#0A0A0B]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToDashboard}
              className="text-gray-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
              My Profile
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        {/* User Header Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-3xl font-bold mb-2">{user.full_name || user.username}</h2>
              <p className="text-gray-400">@{user.username}</p>
            </div>
            <div className="flex items-center gap-2">
              {user.is_superuser && (
                <Badge className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 text-yellow-400 border-yellow-500/30">
                  <Crown className="w-3 h-3 mr-1" />
                  Admin
                </Badge>
              )}
              {user.is_beta && (
                <Badge className="bg-[#BD00FF]/20 text-[#BD00FF] border-[#BD00FF]/30">
                  <Shield className="w-3 h-3 mr-1" />
                  Beta User
                </Badge>
              )}
            </div>
          </div>
          <p className="text-sm text-gray-500">
            Member since {new Date(user.created_at).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric'
            })}
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="text-lg text-gray-400">Loading profile data...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Profile Form and Avatar */}
            <div className="lg:col-span-2 space-y-6">
              <ProfileForm
                user={user}
                onUpdate={handleUpdateProfile}
              />

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
  )
}
