"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAdminProjectDetails } from "@/hooks/use-admin"
import { Loader2, User, Calendar, FileText, GitBranch, Image as ImageIcon, Network } from "lucide-react"

interface ProjectDetailModalProps {
  projectId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ProjectDetailModal({ projectId, open, onOpenChange }: ProjectDetailModalProps) {
  const { data: project, isLoading } = useAdminProjectDetails(projectId, open)

  // Debug logging
  console.log('[ProjectDetailModal] projectId:', projectId)
  console.log('[ProjectDetailModal] project data:', project)
  console.log('[ProjectDetailModal] image_library:', project?.image_library)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {project?.name || "Project Details"}
          </DialogTitle>
          <DialogDescription>
            View project information, state workflows, and image library
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : project ? (
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="states">States & Workflows</TabsTrigger>
              <TabsTrigger value="images">Image Library</TabsTrigger>
            </TabsList>

            <ScrollArea className="h-[calc(90vh-12rem)] mt-4">
              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Project Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Project Name</p>
                        <p className="text-lg font-semibold">{project.name}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Project ID</p>
                        <p className="text-sm font-mono text-muted-foreground">{project.id}</p>
                      </div>
                    </div>

                    {project.description && (
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Description</p>
                        <p className="text-sm mt-1">{project.description}</p>
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-sm">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{project.owner_username}</span>
                      <span className="text-muted-foreground">({project.owner_email})</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-xs text-muted-foreground">Created</p>
                          <p className="text-sm">{new Date(project.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-xs text-muted-foreground">Last Updated</p>
                          <p className="text-sm">{new Date(project.updated_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-4 pt-4 border-t">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-sm">
                          {project.state_count} States
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-sm">
                          {project.transition_count} Transitions
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-sm">
                          {project.image_library.length} Images
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* States & Workflows Tab */}
              <TabsContent value="states" className="space-y-4">
                {project.states && project.states.length > 0 ? (
                  <div className="space-y-4">
                    {project.states.map((state: any, index: number) => (
                      <Card key={state.id || index}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <GitBranch className="h-4 w-4" />
                              <CardTitle className="text-lg">{state.name || `State ${index + 1}`}</CardTitle>
                            </div>
                            <Badge variant="secondary">
                              {state.transitions?.length || 0} Transitions
                            </Badge>
                          </div>
                          {state.id && (
                            <CardDescription className="font-mono text-xs">
                              ID: {state.id}
                            </CardDescription>
                          )}
                        </CardHeader>
                        <CardContent>
                          {state.transitions && state.transitions.length > 0 ? (
                            <div className="space-y-2">
                              <p className="text-sm font-medium text-muted-foreground">Transitions:</p>
                              <div className="grid gap-2">
                                {state.transitions.map((transition: any, tIndex: number) => (
                                  <div
                                    key={transition.id || tIndex}
                                    className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm"
                                  >
                                    <Network className="h-3 w-3 text-muted-foreground" />
                                    <span className="font-medium">{transition.name || `Transition ${tIndex + 1}`}</span>
                                    {transition.target && (
                                      <span className="text-muted-foreground">→ {transition.target}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">No transitions defined</p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <GitBranch className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                      <p className="text-muted-foreground">No states defined in this project</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Image Library Tab */}
              <TabsContent value="images" className="space-y-4">
                {project.image_library && project.image_library.length > 0 ? (
                  <div className="grid grid-cols-2 gap-4">
                    {project.image_library.map((item: any, index: number) => (
                      <Card key={index}>
                        <CardHeader>
                          <div className="flex items-center gap-2">
                            <ImageIcon className="h-4 w-4" />
                            <CardTitle className="text-sm">
                              {item.source === 'image_library'
                                ? item.image.name || `Image ${index + 1}`
                                : item.state_name || `State Image ${index + 1}`
                              }
                            </CardTitle>
                          </div>
                          <CardDescription className="font-mono text-xs">
                            {item.source === 'image_library' ? (
                              <span>Source: Image Library</span>
                            ) : (
                              <span>Source: State ({item.state_id})</span>
                            )}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          {item.image && (
                            <div className="space-y-2">
                              {item.source === 'image_library' ? (
                                // Display ImageAsset fields
                                <>
                                  {item.image.size && (
                                    <p className="text-sm">
                                      <span className="font-medium">Size:</span> {(item.image.size / 1024).toFixed(2)} KB
                                    </p>
                                  )}
                                  {item.image.usageCount !== undefined && (
                                    <p className="text-sm">
                                      <span className="font-medium">Usage Count:</span> {item.image.usageCount}
                                    </p>
                                  )}
                                  {item.image.source && (
                                    <p className="text-sm">
                                      <span className="font-medium">Type:</span> {item.image.source.replace(/_/g, ' ')}
                                    </p>
                                  )}
                                </>
                              ) : (
                                // Display state image fields
                                <>
                                  {item.image.name && (
                                    <p className="text-sm">
                                      <span className="font-medium">Name:</span> {item.image.name}
                                    </p>
                                  )}
                                  {item.image.coordinates && (
                                    <p className="text-sm">
                                      <span className="font-medium">Coordinates:</span>{" "}
                                      ({item.image.coordinates.x}, {item.image.coordinates.y})
                                    </p>
                                  )}
                                  {item.image.pixelHash && (
                                    <p className="text-sm font-mono text-xs truncate">
                                      <span className="font-medium">Hash:</span> {item.image.pixelHash}
                                    </p>
                                  )}
                                  {item.image.stabilityScore !== undefined && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium">Stability:</span>
                                      <Badge variant={item.image.stabilityScore > 0.8 ? "default" : "secondary"}>
                                        {(item.image.stabilityScore * 100).toFixed(1)}%
                                      </Badge>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                      <p className="text-muted-foreground">No images in the library</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        ) : (
          <div className="py-12 text-center text-muted-foreground">
            Project not found
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
