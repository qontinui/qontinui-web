"use client"

export const dynamic = 'force-dynamic'

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { projectService } from "@/services/service-factory"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { SubscriptionBadge } from "@/components/subscription-badge"
import { Plus, Trash2, Upload, Clock, FolderOpen, LogOut, BookTemplate as Template, Play, User as UserIcon, BarChart3 } from "lucide-react"
import { toast } from "sonner"

interface Project {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
  status: 'draft' | 'testing' | 'production'
}

interface Activity {
  id: string
  type: 'created' | 'modified' | 'exported' | 'run'
  projectName: string
  timestamp: Date
  projectId: string
}

export default function Dashboard() {
  const { user, logout, loading: authLoading } = useAuth()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [activities, setActivities] = useState<Activity[]>([])

  useEffect(() => {
    // Wait for auth to finish loading before redirecting
    if (!authLoading && !user) {
      router.push('/')
      return
    }

    // Load user projects if user exists
    if (user) {
      loadProjects()
    }
  }, [user, authLoading, router])

  const loadProjects = async () => {
    try {
      setLoading(true)
      // Fetch projects from API
      const apiProjects = await projectService.getProjects()

      // Transform API projects to match our interface
      const transformedProjects = apiProjects.map((p: any) => ({
        id: p.id.toString(),
        name: p.name,
        description: p.description || 'No description',
        created_at: p.created_at,
        updated_at: p.updated_at,
        status: 'draft' as const  // Default status since API doesn't have this field yet
      }))

      // Generate activities from projects
      const generatedActivities = transformedProjects.slice(0, 5).map((p: any, idx: number) => ({
        id: `activity-${idx}`,
        type: idx === 0 ? 'created' as const : 'modified' as const,
        projectName: p.name,
        timestamp: new Date(p.updated_at),
        projectId: p.id
      }))
      setActivities(generatedActivities)

      setProjects(transformedProjects)
    } catch (error) {
      console.error('Failed to load projects:', error)
      toast.error('Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    const warningMessage = "⚠️ WARNING: Make sure to Export or Save any unsaved work before logging out.\n\nDo you want to continue?"
    if (confirm(warningMessage)) {
      logout()
      router.push('/')
      toast.success("Logged out successfully")
    }
  }

  const handleNewProject = async () => {
    try {
      console.log('Creating new project...')

      // Create a new project via API
      const newProject = await projectService.createProject({
        name: `New Automation ${new Date().toLocaleDateString()}`,
        description: 'A new automation workflow',
        configuration: {}
      })

      console.log('Project created:', newProject)

      // Reload projects list to show the new one
      await loadProjects()

      // Navigate to automation builder with the new project ID
      router.push(`/automation-builder?project=${newProject.id}`)
    } catch (error: any) {
      console.error('Failed to create project:', error)
      console.error('Error details:', error.message, error.response)
      toast.error(error.message || 'Failed to create new project')
    }
  }

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return

    try {
      await projectService.deleteProject(parseInt(projectId))
      setProjects(projects.filter(p => p.id !== projectId))
      toast.success('Project deleted successfully')
    } catch (error) {
      console.error('Failed to delete project:', error)
      toast.error('Failed to delete project')
    }
  }

  const handleImportProject = () => {
    // TODO: Implement import functionality
    toast.info('Import functionality coming soon!')
  }

  const handleBrowseTemplates = () => {
    // TODO: Implement templates
    toast.info('Templates coming soon!')
  }

  const getStatusColor = (status: Project['status']) => {
    switch (status) {
      case 'production':
        return 'bg-[#00FF88]/20 text-[#00FF88] border-[#00FF88]/30'
      case 'testing':
        return 'bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30'
      case 'draft':
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
    }
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

  const handleOpenProject = (projectId: string) => {
    router.push(`/automation-builder?project=${projectId}`)
  }

  const lastActivity = activities.length > 0 ? activities[0] : null

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
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
              Qontinui
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <SubscriptionBadge />
            <div className="text-right mr-4">
              <p className="text-sm font-medium">{user.full_name || user.username}</p>
              <p className="text-xs text-gray-400">{user.email}</p>
            </div>
            {user.is_beta && <Badge className="bg-[#BD00FF]/20 text-[#BD00FF] border-[#BD00FF]/30">Beta User</Badge>}
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/analytics')}
              className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF] bg-transparent"
              title="View Analytics"
            >
              <BarChart3 className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/profile')}
              className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF] bg-transparent"
              title="View Profile"
            >
              <UserIcon className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="border-gray-700 hover:border-red-500 hover:text-red-400 bg-transparent"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        {/* Welcome Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-3xl font-bold mb-2">Welcome back, {user.full_name || user.username}</h2>
              <p className="text-gray-400">Manage your automation configurations and projects</p>
            </div>

            <div className="flex gap-4">
              <div className="flex items-center gap-2 px-4 py-3 bg-[#1A1A1B]/50 border border-gray-800/50 rounded-lg backdrop-blur-sm">
                <FolderOpen className="w-5 h-5 text-[#00D9FF]" />
                <span className="text-sm text-gray-400">Total Projects</span>
                <span className="text-lg font-bold text-[#00D9FF]">{projects.length}</span>
              </div>

              <div className="flex items-center gap-2 px-4 py-3 bg-[#1A1A1B]/50 border border-gray-800/50 rounded-lg backdrop-blur-sm">
                <Clock className="w-5 h-5 text-[#BD00FF]" />
                <span className="text-sm text-gray-400">Last Activity</span>
                <span className="text-lg font-bold text-[#BD00FF]">
                  {lastActivity ? getRelativeTime(lastActivity.timestamp.toISOString()) : 'No activity'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions Section */}
        {projects.length > 0 && (
          <div className="mb-8">
            <h3 className="text-xl font-semibold mb-4">Quick Actions</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card
                className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm hover:border-[#00D9FF]/50 hover:shadow-[0_0_20px_rgba(0,217,255,0.1)] transition-all duration-300 cursor-pointer group"
                onClick={handleNewProject}
              >
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 bg-[#00D9FF]/20 rounded-lg flex items-center justify-center mx-auto mb-3 group-hover:bg-[#00D9FF]/30 transition-colors">
                    <Plus className="w-6 h-6 text-[#00D9FF]" />
                  </div>
                  <h4 className="font-semibold mb-2">Create New Project</h4>
                  <p className="text-sm text-gray-400">Start building a new automation configuration</p>
                </CardContent>
              </Card>

              <Card
                className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm hover:border-[#BD00FF]/50 hover:shadow-[0_0_20px_rgba(189,0,255,0.1)] transition-all duration-300 cursor-pointer group"
                onClick={handleBrowseTemplates}
              >
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 bg-[#BD00FF]/20 rounded-lg flex items-center justify-center mx-auto mb-3 group-hover:bg-[#BD00FF]/30 transition-colors">
                    <Template className="w-6 h-6 text-[#BD00FF]" />
                  </div>
                  <h4 className="font-semibold mb-2">Browse Templates</h4>
                  <p className="text-sm text-gray-400">Explore pre-built automation templates</p>
                </CardContent>
              </Card>

              <Card
                className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm hover:border-[#00FF88]/50 hover:shadow-[0_0_20px_rgba(0,255,136,0.1)] transition-all duration-300 cursor-pointer group"
                onClick={handleImportProject}
              >
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 bg-[#00FF88]/20 rounded-lg flex items-center justify-center mx-auto mb-3 group-hover:bg-[#00FF88]/30 transition-colors">
                    <Upload className="w-6 h-6 text-[#00FF88]" />
                  </div>
                  <h4 className="font-semibold mb-2">Import Configuration</h4>
                  <p className="text-sm text-gray-400">Upload existing automation files</p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Projects Section */}
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold">Your Projects</h3>
              <Button
                onClick={handleNewProject}
                className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Project
              </Button>
            </div>

            {loading ? (
              <div className="text-center py-8 text-gray-400">
                Loading projects...
              </div>
            ) : projects.length === 0 ? (
              <Card className="bg-[#1A1A1B]/30 border-gray-800/50 border-dashed backdrop-blur-sm">
                <CardContent className="p-12 text-center">
                  <div className="w-16 h-16 bg-[#00D9FF]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <FolderOpen className="w-8 h-8 text-[#00D9FF]" />
                  </div>
                  <h4 className="text-xl font-semibold mb-2 text-gray-300">No projects yet</h4>
                  <p className="text-gray-500 mb-6">Create your first automation project to get started</p>
                  <Button
                    onClick={handleNewProject}
                    className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create First Project
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {projects.map((project) => (
                  <Card
                    key={project.id}
                    className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm hover:border-[#00D9FF]/30 hover:shadow-[0_0_20px_rgba(0,217,255,0.05)] transition-all duration-300 group"
                  >
                    <CardContent className="p-6">
                      <div className="mb-4">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-semibold text-lg group-hover:text-[#00D9FF] transition-colors line-clamp-1">
                            {project.name}
                          </h4>
                          <Badge className={`${getStatusColor(project.status)} text-xs`}>{project.status}</Badge>
                        </div>
                        <p className="text-gray-400 text-sm mb-3 line-clamp-2">{project.description}</p>
                        <p className="text-xs text-gray-500">Modified {getRelativeTime(project.updated_at)}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleOpenProject(project.id)}
                          className="flex-1 bg-[#00D9FF]/10 hover:bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/30 hover:border-[#00D9FF]/50"
                        >
                          <Play className="w-4 h-4 mr-1" />
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteProject(project.id)
                          }}
                          className="border-gray-700 hover:border-red-500 hover:text-red-400 bg-transparent"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Recent Activity Sidebar */}
          {projects.length > 0 && (
            <div className="lg:col-span-1">
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Recent Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {activities.slice(0, 5).map((activity) => (
                      <div
                        key={activity.id}
                        className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-800/30 transition-colors"
                      >
                        <div className="w-2 h-2 bg-[#00D9FF] rounded-full mt-2 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-200 line-clamp-1">
                            {activity.type === 'created' ? 'Created' : 'Updated'} {activity.projectName}
                          </p>
                          <p className="text-xs text-gray-500">{getRelativeTime(activity.timestamp.toISOString())}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
