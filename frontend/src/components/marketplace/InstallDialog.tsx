'use client'

import React, { useState } from 'react'
import { AlertTriangle, Check, X, Package, ChevronRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import type { CodePackage, PackageDependency, InstallStatus } from '@/types/code-packages'

interface InstallDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  package: CodePackage
  projects: Array<{ id: string; name: string }>
  selectedProjectId?: string
  onInstall: (projectId: string, versionId?: string) => void
  installStatus?: InstallStatus
  installProgress?: number
  error?: string
}

export function InstallDialog({
  open,
  onOpenChange,
  package: pkg,
  projects,
  selectedProjectId: initialProjectId,
  onInstall,
  installStatus = 'idle',
  installProgress = 0,
  error,
}: InstallDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId || projects[0]?.id || '')
  const [selectedVersionId, setSelectedVersionId] = useState(pkg.latest_version.id)

  const selectedVersion = pkg.versions.find((v) => v.id === selectedVersionId) || pkg.latest_version
  const hasDependencies = selectedVersion.dependencies.length > 0
  const hasSecurityIssues = selectedVersion.security_scan.scanned && !selectedVersion.security_scan.passed

  const handleInstall = () => {
    if (selectedProjectId) {
      onInstall(selectedProjectId, selectedVersionId)
    }
  }

  const getStatusMessage = () => {
    switch (installStatus) {
      case 'installing':
        return 'Installing package...'
      case 'installed':
        return 'Package installed successfully!'
      case 'failed':
        return 'Installation failed'
      case 'updating':
        return 'Updating package...'
      default:
        return ''
    }
  }

  const isInstalling = installStatus === 'installing' || installStatus === 'updating'
  const isComplete = installStatus === 'installed'
  const isFailed = installStatus === 'failed'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-cyan-500" />
            Install Package
          </DialogTitle>
          <DialogDescription>
            Configure installation settings for <span className="font-semibold">{pkg.name}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Project Selection */}
          <div className="space-y-2">
            <label htmlFor="project" className="text-sm font-medium text-gray-300">
              Install to Project
            </label>
            <Select
              value={selectedProjectId}
              onValueChange={setSelectedProjectId}
              disabled={isInstalling || isComplete}
            >
              <SelectTrigger id="project" className="bg-gray-900/50 border-gray-700">
                <SelectValue placeholder="Select a project..." />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Version Selection */}
          <div className="space-y-2">
            <label htmlFor="version" className="text-sm font-medium text-gray-300">
              Version
            </label>
            <Select
              value={selectedVersionId}
              onValueChange={setSelectedVersionId}
              disabled={isInstalling || isComplete}
            >
              <SelectTrigger id="version" className="bg-gray-900/50 border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pkg.versions.map((version) => (
                  <SelectItem key={version.id} value={version.id}>
                    v{version.version}
                    {version.id === pkg.latest_version.id && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        Latest
                      </Badge>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dependencies */}
          {hasDependencies && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-300">
                Dependencies ({selectedVersion.dependencies.length})
              </div>
              <div className="p-3 bg-gray-900/30 rounded-lg border border-gray-800 space-y-2">
                {selectedVersion.dependencies.map((dep, index) => (
                  <DependencyItem key={index} dependency={dep} />
                ))}
              </div>
            </div>
          )}

          {/* Security Scan Results */}
          {selectedVersion.security_scan.scanned && (
            <Alert
              variant={hasSecurityIssues ? 'destructive' : 'default'}
              className={cn(
                !hasSecurityIssues && 'border-green-500/50 bg-green-950/20'
              )}
            >
              <AlertDescription className="flex items-start gap-2">
                {hasSecurityIssues ? (
                  <>
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1 flex-1">
                      <div className="font-medium">Security issues detected</div>
                      {selectedVersion.security_scan.issues?.map((issue, index) => (
                        <div key={index} className="text-xs">
                          <Badge
                            variant="destructive"
                            className="mr-2"
                          >
                            {issue.severity}
                          </Badge>
                          {issue.description}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5 text-green-500" />
                    <div>
                      <div className="font-medium text-green-500">Security scan passed</div>
                      <div className="text-xs text-gray-400">
                        No security issues detected
                      </div>
                    </div>
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Installation Progress */}
          {isInstalling && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">{getStatusMessage()}</span>
                <span className="text-gray-400">{installProgress}%</span>
              </div>
              <Progress value={installProgress} className="h-2" />
            </div>
          )}

          {/* Success Message */}
          {isComplete && (
            <Alert className="border-green-500/50 bg-green-950/20">
              <AlertDescription className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-500" />
                <span className="text-green-500 font-medium">
                  {getStatusMessage()}
                </span>
              </AlertDescription>
            </Alert>
          )}

          {/* Error Message */}
          {isFailed && error && (
            <Alert variant="destructive">
              <AlertDescription className="flex items-start gap-2">
                <X className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1">
                  <div className="font-medium">{getStatusMessage()}</div>
                  <div className="text-xs">{error}</div>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isInstalling}
          >
            {isComplete ? 'Close' : 'Cancel'}
          </Button>
          {!isComplete && (
            <Button
              onClick={handleInstall}
              disabled={!selectedProjectId || isInstalling || hasSecurityIssues}
              className="bg-gradient-to-r from-cyan-500 to-purple-500"
            >
              {isInstalling ? (
                <>
                  <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Installing...
                </>
              ) : (
                'Install Package'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DependencyItem({ dependency }: { dependency: PackageDependency }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <ChevronRight className="w-3 h-3 text-gray-500" />
      <span className="text-gray-300">{dependency.package_name}</span>
      <Badge variant="outline" className="text-xs">
        {dependency.version_constraint}
      </Badge>
      {dependency.optional && (
        <Badge variant="secondary" className="text-xs">
          Optional
        </Badge>
      )}
    </div>
  )
}
