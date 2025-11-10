"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Search, FolderOpen, User, Calendar, FileText, ChevronRight } from "lucide-react"
import { useAdminProjects } from "@/hooks/use-admin"
import ProjectDetailModal from "./ProjectDetailModal"

export default function ProjectsTab() {
  const { data: projects = [], isLoading: loading } = useAdminProjects()
  const [searchTerm, setSearchTerm] = useState("")
  const [sortBy, setSortBy] = useState("recent")
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const filteredProjects = useMemo(() => {
    let filtered = [...projects]

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(
        project =>
          project.name.toLowerCase().includes(term) ||
          project.owner_username.toLowerCase().includes(term) ||
          project.owner_email.toLowerCase().includes(term) ||
          (project.description && project.description.toLowerCase().includes(term))
      )
    }

    // Sort
    switch (sortBy) {
      case "recent":
        filtered.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        break
      case "oldest":
        filtered.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        break
      case "name":
        filtered.sort((a, b) => a.name.localeCompare(b.name))
        break
      case "owner":
        filtered.sort((a, b) => a.owner_username.localeCompare(b.owner_username))
        break
      case "complexity":
        filtered.sort((a, b) => (b.state_count + b.transition_count) - (a.state_count + a.transition_count))
        break
    }

    return filtered
  }, [searchTerm, sortBy, projects])

  const getComplexityBadge = (stateCount: number, transitionCount: number) => {
    const total = stateCount + transitionCount
    if (total === 0) return { label: "Empty", color: "bg-gray-500/10 text-gray-500" }
    if (total < 5) return { label: "Simple", color: "bg-green-500/10 text-green-500" }
    if (total < 15) return { label: "Medium", color: "bg-yellow-500/10 text-yellow-500" }
    return { label: "Complex", color: "bg-purple-500/10 text-purple-500" }
  }

  if (loading) {
    return <div className="text-center text-muted-foreground">Loading projects...</div>
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>All Projects</CardTitle>
          <CardDescription>View and analyze what users are building</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by project name, owner, or description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Recently Updated</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
                <SelectItem value="name">Name (A-Z)</SelectItem>
                <SelectItem value="owner">Owner (A-Z)</SelectItem>
                <SelectItem value="complexity">Most Complex</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredProjects.length} of {projects.length} projects
          </div>
        </CardContent>
      </Card>

      {/* Projects List */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {filteredProjects.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {searchTerm ? "No projects found matching your search" : "No projects yet"}
              </div>
            ) : (
              filteredProjects.map((project) => {
                const complexity = getComplexityBadge(project.state_count, project.transition_count)
                return (
                  <div
                    key={project.id}
                    className="p-4 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedProjectId(project.id)
                      setIsModalOpen(true)
                    }}
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <FolderOpen className="h-4 w-4 text-primary flex-shrink-0" />
                          <span className="font-medium truncate">{project.name}</span>
                          <Badge className={complexity.color}>
                            {complexity.label}
                          </Badge>
                        </div>
                        {project.description && (
                          <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                            {project.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {project.owner_username}
                          </span>
                          <span className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            {project.state_count} states, {project.transition_count} transitions
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Created {new Date(project.created_at).toLocaleDateString()}
                          </span>
                          <span className="flex items-center gap-1">
                            Updated {new Date(project.updated_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Project Insights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{projects.length}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Avg Complexity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {projects.length > 0
                ? (projects.reduce((sum, p) => sum + p.state_count + p.transition_count, 0) / projects.length).toFixed(1)
                : 0}
            </div>
            <p className="text-xs text-muted-foreground">States + Transitions</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {projects.filter(p => {
                const daysSinceUpdate = (Date.now() - new Date(p.updated_at).getTime()) / (1000 * 60 * 60 * 24)
                return daysSinceUpdate < 7
              }).length}
            </div>
            <p className="text-xs text-muted-foreground">Updated in last 7 days</p>
          </CardContent>
        </Card>
      </div>

      {/* Project Detail Modal */}
      <ProjectDetailModal
        projectId={selectedProjectId}
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
      />
    </div>
  )
}
