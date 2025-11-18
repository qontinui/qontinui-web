'use client'

/**
 * Qontinui Ecosystem Architecture Display
 *
 * Interactive visualization of all Qontinui components and their relationships
 */

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/auth-context'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Home, Shield, ArrowLeft, ChevronRight } from 'lucide-react'
import { ArchitectureDiagram } from '@/components/admin/architecture/ArchitectureDiagram'
import { ComponentDetailPanel } from '@/components/admin/architecture/ComponentDetailPanel'

export type ComponentType = 'qontinui' | 'multistate' | 'qontinui-runner' | 'qontinui-web' | 'qontinui-api' | null
export type ArchitectureLevel = 'root' | 'qontinui-web' | 'qontinui-api' | 'qontinui-runner' | 'qontinui' | 'multistate' | 'screenshots'

export default function ArchitecturePage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedComponent, setSelectedComponent] = useState<ComponentType>(null)
  const [currentLevel, setCurrentLevel] = useState<ArchitectureLevel>('root')

  // Handle view query parameter
  useEffect(() => {
    const view = searchParams.get('view')
    if (view === 'screenshots') {
      setCurrentLevel('screenshots')
    }
  }, [searchParams])

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

  const handleDrillDown = (component: ComponentType) => {
    if (component && ['qontinui-web', 'qontinui-api', 'qontinui-runner', 'qontinui', 'multistate'].includes(component)) {
      setCurrentLevel(component as ArchitectureLevel)
      setSelectedComponent(null)
    }
  }

  const handleBreadcrumbClick = (level: ArchitectureLevel) => {
    setCurrentLevel(level)
    setSelectedComponent(null)
  }

  const getLevelTitle = (level: ArchitectureLevel): string => {
    switch (level) {
      case 'root': return 'Qontinui Ecosystem'
      case 'qontinui-web': return 'Qontinui Web Architecture'
      case 'qontinui-api': return 'Qontinui API Architecture'
      case 'qontinui-runner': return 'Qontinui Runner Architecture'
      case 'qontinui': return 'Qontinui Library Architecture'
      case 'multistate': return 'MultiState Library Architecture'
      case 'screenshots': return 'Screenshot Infrastructure'
    }
  }

  const breadcrumbs = currentLevel === 'root'
    ? [{ label: 'Qontinui Ecosystem', level: 'root' as ArchitectureLevel }]
    : [
        { label: 'Qontinui Ecosystem', level: 'root' as ArchitectureLevel },
        { label: getLevelTitle(currentLevel), level: currentLevel }
      ]

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
              variant={currentLevel === 'screenshots' ? 'default' : 'outline'}
              onClick={() => setCurrentLevel('screenshots')}
              className="flex items-center gap-2"
            >
              📸 Screenshots
            </Button>
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

        {/* Header with Breadcrumbs */}
        <div className="mb-8">
          {/* Breadcrumb Navigation */}
          <div className="flex items-center gap-2 mb-4 text-sm">
            {breadcrumbs.map((crumb, index) => (
              <div key={crumb.level} className="flex items-center gap-2">
                {index > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <button
                  onClick={() => handleBreadcrumbClick(crumb.level)}
                  className={`hover:text-primary transition-colors ${
                    index === breadcrumbs.length - 1
                      ? 'text-foreground font-semibold'
                      : 'text-muted-foreground hover:underline'
                  }`}
                  disabled={index === breadcrumbs.length - 1}
                >
                  {crumb.label}
                </button>
              </div>
            ))}
          </div>

          <h1 className="text-3xl font-bold mb-2">{getLevelTitle(currentLevel)}</h1>
          <p className="text-muted-foreground">
            {currentLevel === 'root'
              ? 'Interactive visualization of the complete Qontinui automation platform'
              : 'Click on components to view details, or navigate back using breadcrumbs above'}
          </p>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Architecture Diagram */}
          <Card className="lg:col-span-2 p-6">
            <ArchitectureDiagram
              selectedComponent={selectedComponent}
              onComponentSelect={setSelectedComponent}
              currentLevel={currentLevel}
              onDrillDown={handleDrillDown}
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

        {/* Instructions and Features */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Home className="h-5 w-5" />
              How to Use
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-1">•</span>
                <span><strong>Click</strong> on any component to view comprehensive details</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-1">•</span>
                <span><strong>Double-click</strong> on components to drill down into their architecture</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-1">•</span>
                <span><strong>Use breadcrumbs</strong> above to navigate back to higher levels</span>
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
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20">
                  📚 2 Core Libraries
                </Badge>
                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                  🖥️ 2 Applications
                </Badge>
                <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-500/20">
                  ⚙️ 1 Service
                </Badge>
              </div>
              <p className="text-xs">
                All components are open-source under the MIT license.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
