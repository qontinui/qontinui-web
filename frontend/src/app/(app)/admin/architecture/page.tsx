'use client'

/**
 * Qontinui Ecosystem Architecture Display
 *
 * Interactive visualization of all Qontinui components and their relationships
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/auth-context'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Home, Shield, ArrowLeft } from 'lucide-react'
import { ArchitectureDiagram } from '@/components/admin/architecture/ArchitectureDiagram'
import { ComponentDetailPanel } from '@/components/admin/architecture/ComponentDetailPanel'

export type ComponentType = 'qontinui' | 'multistate' | 'qontinui-runner' | 'qontinui-web' | 'qontinui-api' | null

export default function ArchitecturePage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [selectedComponent, setSelectedComponent] = useState<ComponentType>(null)

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

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Qontinui Ecosystem Architecture</h1>
          <p className="text-muted-foreground">
            Interactive visualization of the complete Qontinui automation platform
          </p>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Architecture Diagram */}
          <Card className="lg:col-span-2 p-6">
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
        <Card className="mt-6 p-6">
          <h3 className="text-lg font-semibold mb-3">How to Use</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Click on any component in the diagram to view detailed information</li>
            <li>• Hover over components to see their names and status</li>
            <li>• Arrows indicate data flow and dependencies between components</li>
            <li>• Color coding: Blue = Core Libraries, Green = Applications, Purple = Services</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
