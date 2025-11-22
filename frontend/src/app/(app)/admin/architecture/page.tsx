'use client'

/**
 * Qontinui Architecture Views Hub
 *
 * Central page for all architecture diagrams and documentation
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/auth-context'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Home, Shield, ArrowLeft, Network, FileText, Camera, Users, Lock, GitBranch, ArrowLeftRight, Cloud, Activity, RefreshCw, Image, Share2 } from 'lucide-react'
import { ArchitectureDiagram } from '@/components/admin/architecture/ArchitectureDiagram'
import { ComponentDetailPanel } from '@/components/admin/architecture/ComponentDetailPanel'
import { ArchitectureDocsViewer } from '@/components/admin/architecture/ArchitectureDocsViewer'
import { ScreenshotWorkflowDiagram } from '@/components/admin/architecture/ScreenshotWorkflowDiagram'
import { CollaborationWorkflowDiagram } from '@/components/admin/architecture/CollaborationWorkflowDiagram'
import { WorkflowExecutionDiagram } from '@/components/admin/architecture/WorkflowExecutionDiagram'
import AuthenticationArchitectureDiagram from '@/components/admin/architecture/AuthenticationArchitectureDiagram'
import { FrontendBackendDataFlowDiagram } from '@/components/admin/architecture/FrontendBackendDataFlowDiagram'
import { DeploymentArchitectureDiagram } from '@/components/admin/architecture/DeploymentArchitectureDiagram'
import { AutomationSessionLifecycleDiagram } from '@/components/admin/architecture/AutomationSessionLifecycleDiagram'
import { ConfigMigrationDiagram } from '@/components/admin/architecture/ConfigMigrationDiagram'
import { ImageProcessingPipelineDiagram } from '@/components/admin/architecture/ImageProcessingPipelineDiagram'
import { PermissionsArchitectureDiagram } from '@/components/admin/architecture/PermissionsArchitectureDiagram'

export type ComponentType = 'qontinui' | 'multistate' | 'qontinui-runner' | 'qontinui-web' | 'qontinui-api' | null

type ArchitectureView = 'ecosystem' | 'screenshots' | 'collaboration' | 'authentication' | 'workflow-execution' | 'frontend-backend-dataflow' | 'permissions' | 'deployment' | 'automation-session-lifecycle' | 'config-migration' | 'image-processing' | 'technical'

export default function ArchitecturePage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [selectedComponent, setSelectedComponent] = useState<ComponentType>(null)
  const [selectedView, setSelectedView] = useState<ArchitectureView>('ecosystem')

  // Protection
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/')
      return
    }

    if (!authLoading && user && !user.is_superuser) {
      toast.error('Access denied - Admin privileges required')
      router.push('/dashboard')
      return
    }
  }, [user, authLoading, router])

  // Don't render until auth is confirmed
  if (!user?.is_superuser) {
    return null
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto">
        {/* Navigation */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push('/admin')}
              className="hover:bg-primary/10"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Admin
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => router.push('/admin')}
              className="flex items-center gap-2"
            >
              <Shield className="h-4 w-4" />
              Admin
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push('/dashboard')}
              className="flex items-center gap-2"
            >
              <Home className="h-4 w-4" />
              Dashboard
            </Button>
          </div>
        </div>

        {/* Header with View Selector */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Qontinui Architecture</h1>
            <p className="text-muted-foreground">
              Comprehensive architecture diagrams and technical documentation for all subsystems
            </p>
          </div>
          <div className="min-w-[280px]">
            <label className="text-sm font-medium mb-2 block">Architecture View</label>
            <Select value={selectedView} onValueChange={(value) => setSelectedView(value as ArchitectureView)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select architecture view" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ecosystem">
                  <div className="flex items-center gap-2">
                    <Network className="h-4 w-4" />
                    <span>Ecosystem Overview</span>
                  </div>
                </SelectItem>
                <SelectItem value="screenshots">
                  <div className="flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    <span>Screenshot Workflow</span>
                  </div>
                </SelectItem>
                <SelectItem value="collaboration">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    <span>Multi-User Collaboration</span>
                  </div>
                </SelectItem>
                <SelectItem value="authentication">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    <span>Authentication & Authorization</span>
                  </div>
                </SelectItem>
                <SelectItem value="workflow-execution">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    <span>Workflow Execution Pipeline</span>
                  </div>
                </SelectItem>
                <SelectItem value="frontend-backend-dataflow">
                  <div className="flex items-center gap-2">
                    <ArrowLeftRight className="h-4 w-4" />
                    <span>Frontend-Backend Data Flow</span>
                  </div>
                </SelectItem>
                <SelectItem value="permissions">
                  <div className="flex items-center gap-2">
                    <Share2 className="h-4 w-4" />
                    <span>Project Sharing & Permissions</span>
                  </div>
                </SelectItem>
                <SelectItem value="deployment">
                  <div className="flex items-center gap-2">
                    <Cloud className="h-4 w-4" />
                    <span>Deployment Architecture</span>
                  </div>
                </SelectItem>
                <SelectItem value="automation-session-lifecycle">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    <span>Automation Session Lifecycle</span>
                  </div>
                </SelectItem>
                <SelectItem value="config-migration">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4" />
                    <span>Config Migration System</span>
                  </div>
                </SelectItem>
                <SelectItem value="image-processing">
                  <div className="flex items-center gap-2">
                    <Image className="h-4 w-4" />
                    <span>Image Processing Pipeline</span>
                  </div>
                </SelectItem>
                <SelectItem value="technical">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span>Technical Documentation</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Ecosystem View */}
        {selectedView === 'ecosystem' && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Architecture Diagram */}
              <Card className="lg:col-span-2 p-6">
                <div className="mb-4">
                  <h2 className="text-xl font-semibold mb-2">Qontinui Ecosystem</h2>
                  <p className="text-sm text-muted-foreground">
                    Interactive visualization of all components and their relationships
                  </p>
                </div>
                <ArchitectureDiagram
                  selectedComponent={selectedComponent}
                  onComponentSelect={setSelectedComponent}
                />
              </Card>

              {/* Component Details Panel */}
              <Card className="lg:col-span-1">
                <ComponentDetailPanel
                  selectedComponent={selectedComponent}
                  onClose={() => setSelectedComponent(null)}
                />
              </Card>
            </div>

            {/* Instructions */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Network className="h-5 w-5" />
                  How to Use
                </h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span><strong>Click</strong> on any component to view comprehensive details</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span><strong>Hover</strong> over components to see quick info tooltips</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span><strong>Watch</strong> as related components highlight when hovering</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span><strong>Arrows</strong> show data flow and dependencies between components</span>
                  </li>
                </ul>
              </Card>

              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  About the Ecosystem
                </h3>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    The Qontinui ecosystem is a comprehensive platform for GUI automation, built on
                    peer-reviewed academic research.
                  </p>
                  <p className="text-xs">
                    All components are open-source under the MIT license.
                  </p>
                </div>
              </Card>
            </div>
          </>
        )}

        {/* Screenshots Workflow View */}
        {selectedView === 'screenshots' && (
          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold mb-2">Screenshot Workflow Architecture</h2>
              <p className="text-sm text-muted-foreground">
                Interactive visualization of screenshot capture, storage, processing, and pattern matching
              </p>
            </div>
            <ScreenshotWorkflowDiagram />
          </Card>
        )}

        {/* Multi-User Collaboration View */}
        {selectedView === 'collaboration' && (
          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold mb-2">Multi-User Collaboration Architecture</h2>
              <p className="text-sm text-muted-foreground">
                Interactive visualization of real-time collaboration, permissions, locking, and conflict management
              </p>
            </div>
            <CollaborationWorkflowDiagram />
          </Card>
        )}

        {/* Authentication & Authorization View */}
        {selectedView === 'authentication' && (
          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold mb-2">Authentication & Authorization Architecture</h2>
              <p className="text-sm text-muted-foreground">
                Enterprise-grade security with JWT tokens, RBAC permissions, device fingerprinting, and session management
              </p>
            </div>
            <AuthenticationArchitectureDiagram />
          </Card>
        )}

        {/* Workflow Execution Pipeline View */}
        {selectedView === 'workflow-execution' && (
          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold mb-2">Workflow Execution Pipeline Architecture</h2>
              <p className="text-sm text-muted-foreground">
                Complete pipeline from visual workflow design through graph validation, export, mock/real execution, state machine navigation, and action execution with HAL & computer vision
              </p>
            </div>
            <WorkflowExecutionDiagram />
          </Card>
        )}

        {/* Frontend-Backend Data Flow View */}
        {selectedView === 'frontend-backend-dataflow' && (
          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold mb-2">Frontend-Backend Data Flow Architecture</h2>
              <p className="text-sm text-muted-foreground">
                Complete data flow from browser through API layer, authentication, middleware, to database - including React Query caching, WebSocket streaming, and optimistic updates
              </p>
            </div>
            <FrontendBackendDataFlowDiagram />
          </Card>
        )}

        {/* Project Sharing & Permissions View */}
        {selectedView === 'permissions' && (
          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold mb-2">Project Sharing & Permissions Architecture</h2>
              <p className="text-sm text-muted-foreground">
                Comprehensive hierarchical permission system: organization roles, team memberships, project-level ACLs, invitation workflows, resource locking, time-based access control, and security analysis with recommendations
              </p>
            </div>
            <PermissionsArchitectureDiagram />
          </Card>
        )}

        {/* Deployment Architecture View */}
        {selectedView === 'deployment' && (
          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold mb-2">Deployment Architecture</h2>
              <p className="text-sm text-muted-foreground">
                Complete infrastructure overview showing development (Docker containers, local services) and production (AWS Elastic Beanstalk, RDS, S3, Vercel) environments with service connections and data flows
              </p>
            </div>
            <DeploymentArchitectureDiagram />
          </Card>
        )}

        {/* Automation Session Lifecycle View */}
        {selectedView === 'automation-session-lifecycle' && (
          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold mb-2">Automation Session Lifecycle</h2>
              <p className="text-sm text-muted-foreground">
                Complete automation session flow from user initiation through desktop runner connection, real-time streaming (logs, screenshots, input events), pattern matching via Qontinui API, data persistence (PostgreSQL, S3, Redis), WebSocket updates, and session completion with analytics
              </p>
            </div>
            <AutomationSessionLifecycleDiagram />
          </Card>
        )}

        {/* Config Migration System View */}
        {selectedView === 'config-migration' && (
          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold mb-2">Config Migration System Architecture</h2>
              <p className="text-sm text-muted-foreground">
                Intelligent backward compatibility system with BFS pathfinding algorithm for automatic config versioning - handles JSON import/export migrations from any historical version to current format with safe rollback
              </p>
            </div>
            <ConfigMigrationDiagram />
          </Card>
        )}

        {/* Image Processing Pipeline View */}
        {selectedView === 'image-processing' && (
          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold mb-2">Image Processing Pipeline Architecture</h2>
              <p className="text-sm text-muted-foreground">
                End-to-end image pipeline: upload validation (MIME, magic bytes, quota), multi-tier storage (S3, PostgreSQL, Redis, IndexedDB),
                async processing (ARQ queue, thumbnail generation, WebP optimization, EXIF handling), computer vision analysis (OpenCV template matching,
                state discovery, semantic OCR, pattern optimization), and progressive delivery (lazy loading, zoom-aware quality selection, presigned URLs)
              </p>
            </div>
            <ImageProcessingPipelineDiagram />
          </Card>
        )}

        {/* Technical Documentation View */}
        {selectedView === 'technical' && (
          <ArchitectureDocsViewer />
        )}
      </div>
    </div>
  )
}
