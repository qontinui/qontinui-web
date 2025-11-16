"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { useOrganization } from "@/hooks/useOrganization"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Users, Building2, Settings, ArrowRight, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { Organization } from "@/types/collaboration"

export default function OrganizationsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { organizations, loading, error, refresh } = useOrganization()

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/')
    }
  }, [user, authLoading, router])

  const getRoleBadgeColor = (org: Organization, userId: string) => {
    if (org.owner_id === userId) {
      return 'bg-[#BD00FF]/20 text-[#BD00FF] border-[#BD00FF]/30'
    }
    // Default for members
    return 'bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30'
  }

  const getUserRole = (org: Organization, userId: string): string => {
    if (org.owner_id === userId) {
      return 'Owner'
    }
    return 'Member'
  }

  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))

    if (diffInHours < 1) return 'Just now'
    if (diffInHours < 24) return `${diffInHours} hours ago`
    const diffInDays = Math.floor(diffInHours / 24)
    if (diffInDays === 1) return '1 day ago'
    return `${diffInDays} days ago`
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-[#00D9FF]" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold mb-2">Organizations</h1>
              <p className="text-gray-400">Manage your organizations and teams</p>
            </div>

            <Button
              onClick={() => router.push('/organizations/new')}
              className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Organization
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[#00D9FF]/20 rounded-lg flex items-center justify-center">
                    <Building2 className="w-6 h-6 text-[#00D9FF]" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-400">Total Organizations</p>
                    <p className="text-2xl font-bold text-[#00D9FF]">{organizations.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[#BD00FF]/20 rounded-lg flex items-center justify-center">
                    <Users className="w-6 h-6 text-[#BD00FF]" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-400">Total Members</p>
                    <p className="text-2xl font-bold text-[#BD00FF]">
                      {organizations.reduce((sum, org) => sum + org.member_count, 0)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[#00FF88]/20 rounded-lg flex items-center justify-center">
                    <Settings className="w-6 h-6 text-[#00FF88]" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-400">Owned by You</p>
                    <p className="text-2xl font-bold text-[#00FF88]">
                      {organizations.filter(org => org.owner_id === user.id).length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Organizations List */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Your Organizations</h2>

          {loading ? (
            <div className="text-center py-12">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-[#00D9FF]" />
              <p className="text-gray-400">Loading organizations...</p>
            </div>
          ) : error ? (
            <Card className="bg-[#1A1A1B]/50 border-red-500/50 backdrop-blur-sm">
              <CardContent className="p-8 text-center">
                <p className="text-red-400 mb-4">Failed to load organizations</p>
                <Button
                  onClick={() => refresh()}
                  variant="outline"
                  className="border-gray-700 hover:border-[#00D9FF]"
                >
                  Try Again
                </Button>
              </CardContent>
            </Card>
          ) : organizations.length === 0 ? (
            <Card className="bg-[#1A1A1B]/30 border-gray-800/50 border-dashed backdrop-blur-sm">
              <CardContent className="p-12 text-center">
                <div className="w-16 h-16 bg-[#00D9FF]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Building2 className="w-8 h-8 text-[#00D9FF]" />
                </div>
                <h4 className="text-xl font-semibold mb-2 text-gray-300">No organizations yet</h4>
                <p className="text-gray-500 mb-6">Create your first organization to collaborate with your team</p>
                <Button
                  onClick={() => router.push('/organizations/new')}
                  className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create Organization
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {organizations.map((org) => (
                <Card
                  key={org.id}
                  className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm hover:border-[#00D9FF]/30 hover:shadow-[0_0_20px_rgba(0,217,255,0.05)] transition-all duration-300 group cursor-pointer"
                  onClick={() => router.push(`/organizations/${org.id}`)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg group-hover:text-[#00D9FF] transition-colors line-clamp-1">
                          {org.name}
                        </CardTitle>
                        {org.description && (
                          <CardDescription className="line-clamp-2 mt-1">
                            {org.description}
                          </CardDescription>
                        )}
                      </div>
                      <Badge className={`${getRoleBadgeColor(org, user.id)} text-xs ml-2 flex-shrink-0`}>
                        {getUserRole(org, user.id)}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent>
                    <div className="space-y-3">
                      {/* Stats */}
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1 text-gray-400">
                          <Users className="w-4 h-4" />
                          <span>{org.member_count} {org.member_count === 1 ? 'member' : 'members'}</span>
                        </div>
                        <div className="flex items-center gap-1 text-gray-400">
                          <Building2 className="w-4 h-4" />
                          <span>{org.project_count} {org.project_count === 1 ? 'project' : 'projects'}</span>
                        </div>
                      </div>

                      {/* Updated */}
                      <p className="text-xs text-gray-500">
                        Updated {getRelativeTime(org.updated_at)}
                      </p>

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-2">
                        <Button
                          size="sm"
                          className="flex-1 bg-[#00D9FF]/10 hover:bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/30 hover:border-[#00D9FF]/50"
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/organizations/${org.id}`)
                          }}
                        >
                          View Details
                          <ArrowRight className="w-4 h-4 ml-1" />
                        </Button>
                        {org.owner_id === user.id && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-gray-700 hover:border-[#BD00FF] hover:text-[#BD00FF] bg-transparent"
                            onClick={(e) => {
                              e.stopPropagation()
                              router.push(`/organizations/${org.id}/settings`)
                            }}
                          >
                            <Settings className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
