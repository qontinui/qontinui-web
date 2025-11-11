"use client"

import { useEffect, useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Search, Filter, ChevronRight, Mail, Calendar, Activity, FolderOpen, Trash2 } from "lucide-react"
import { useAdminUsers, type AdminUserData } from "@/hooks/use-admin"
import { toast } from "sonner"
import { ApiConfig } from "@/services/api-config"
import { authService } from "@/services/service-factory"

export default function UsersTab() {
  const { data: users = [], isLoading: loading, refetch } = useAdminUsers({ limit: 1000 })
  const [searchTerm, setSearchTerm] = useState("")
  const [tierFilter, setTierFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [selectedUser, setSelectedUser] = useState<AdminUserData | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDeleteUser = async (userId: string, username: string) => {
    if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) {
      return
    }

    setIsDeleting(true)
    try {
      const accessToken = authService.tokenManager.getAccessToken()

      if (!accessToken) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(`${ApiConfig.API_BASE_URL}/api/v1/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Failed to delete user')
      }

      toast.success(`User "${username}" deleted successfully`)
      setSelectedUser(null)
      refetch() // Refresh the users list
    } catch (error) {
      console.error('Error deleting user:', error)
      toast.error('Failed to delete user. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  const filteredUsers = useMemo(() => {
    let filtered = [...users]

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(
        user =>
          user.email.toLowerCase().includes(term) ||
          user.username.toLowerCase().includes(term) ||
          user.id.toLowerCase().includes(term) || // UUID is already a string
          (user.full_name && user.full_name.toLowerCase().includes(term))
      )
    }

    // Tier filter
    if (tierFilter !== "all") {
      filtered = filtered.filter(user => user.subscription_tier === tierFilter)
    }

    // Status filter
    if (statusFilter === "active") {
      filtered = filtered.filter(user => user.is_active)
    } else if (statusFilter === "inactive") {
      filtered = filtered.filter(user => !user.is_active)
    } else if (statusFilter === "verified") {
      filtered = filtered.filter(user => user.email_verified)
    } else if (statusFilter === "unverified") {
      filtered = filtered.filter(user => !user.email_verified)
    }

    return filtered
  }, [searchTerm, tierFilter, statusFilter, users])

  const getTierColor = (tier: string) => {
    switch (tier) {
      case "pro":
        return "bg-purple-500/10 text-purple-500 border-purple-500/20"
      case "premium":
        return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
      default:
        return "bg-gray-500/10 text-gray-500 border-gray-500/20"
    }
  }

  if (loading) {
    return <div className="text-center text-muted-foreground">Loading users...</div>
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>User Management</CardTitle>
          <CardDescription>Search, filter, and manage user accounts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by email, username, name, or ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Subscription Tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="verified">Verified</SelectItem>
                <SelectItem value="unverified">Unverified</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredUsers.length} of {users.length} users
          </div>
        </CardContent>
      </Card>

      {/* Users List */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {filteredUsers.map((user) => (
              <div
                key={user.id}
                className="p-4 hover:bg-muted/50 transition-colors cursor-pointer flex items-center gap-4"
                onClick={() => setSelectedUser(user)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium truncate">{user.username}</span>
                    <Badge className={getTierColor(user.subscription_tier)}>
                      {user.subscription_tier}
                    </Badge>
                    {!user.email_verified && (
                      <Badge variant="outline" className="text-yellow-600 border-yellow-600/20">
                        Unverified
                      </Badge>
                    )}
                    {!user.is_active && (
                      <Badge variant="outline" className="text-red-600 border-red-600/20">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1 truncate">
                      <Mail className="h-3 w-3" />
                      {user.email}
                    </span>
                    <span className="flex items-center gap-1">
                      <FolderOpen className="h-3 w-3" />
                      {user.project_count} projects
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(user.created_at).toLocaleDateString()}
                    </span>
                    {user.last_login && (
                      <span className="flex items-center gap-1">
                        <Activity className="h-3 w-3" />
                        {new Date(user.last_login).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* User Detail Modal - Placeholder for now */}
      {selectedUser && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>User Details: {selectedUser.username}</CardTitle>
            <CardDescription>View detailed information and projects</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground">Email</div>
                <div>{selectedUser.email}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Full Name</div>
                <div>{selectedUser.full_name || "Not set"}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">User ID</div>
                <div>{selectedUser.id}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Subscription Tier</div>
                <Badge className={getTierColor(selectedUser.subscription_tier)}>
                  {selectedUser.subscription_tier}
                </Badge>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Total Projects</div>
                <div>{selectedUser.project_count}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Member Since</div>
                <div>{new Date(selectedUser.created_at).toLocaleString()}</div>
              </div>
              {selectedUser.last_login && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Last Login</div>
                  <div>{new Date(selectedUser.last_login).toLocaleString()}</div>
                </div>
              )}
              <div className="flex gap-2 mt-4">
                <Button variant="outline" onClick={() => setSelectedUser(null)}>
                  Close
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleDeleteUser(selectedUser.id, selectedUser.username)}
                  disabled={isDeleting}
                  className="ml-auto"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {isDeleting ? 'Deleting...' : 'Delete User'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
