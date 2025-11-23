'use client'

import React, { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Download,
  Star,
  Calendar,
  User,
  Shield,
  ExternalLink,
  Flag,
  GitBranch,
  Package,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Code,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PackageCodePreview } from '@/components/marketplace/PackageCodePreview'
import { PackageRatings } from '@/components/marketplace/PackageRatings'
import { InstallDialog } from '@/components/marketplace/InstallDialog'
import {
  usePackageDetails,
  usePackageRatings,
  useInstallPackage,
  useRatePackage,
} from '@/hooks/useCodePackages'
import { useProjects } from '@/hooks/use-projects'
import { formatDownloads, formatRating, getCategoryLabel } from '@/types/code-packages'
import type { InstallStatus } from '@/types/code-packages'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'

export default function PackageDetailsPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [installStatus, setInstallStatus] = useState<InstallStatus>('idle')
  const [selectedTab, setSelectedTab] = useState<'readme' | 'code' | 'versions' | 'dependencies'>('readme')

  // Queries
  const { data: pkg, isLoading } = usePackageDetails(slug)
  const { data: ratings } = usePackageRatings(pkg?.id || '', !!pkg?.id)
  const { data: projects } = useProjects()

  // Mutations
  const installPackageMutation = useInstallPackage()
  const ratePackageMutation = useRatePackage()

  const handleBack = () => {
    router.push('/marketplace')
  }

  const handleInstallClick = () => {
    setInstallDialogOpen(true)
    setInstallStatus('idle')
  }

  const handleInstall = async (projectId: string, versionId?: string) => {
    if (!pkg) return

    setInstallStatus('installing')

    try {
      await installPackageMutation.mutateAsync({
        package_id: pkg.id,
        version_id: versionId,
        project_id: projectId,
      })
      setInstallStatus('installed')
      setTimeout(() => {
        setInstallDialogOpen(false)
        setInstallStatus('idle')
      }, 2000)
    } catch (error) {
      console.error('[PackageDetailsPage] Failed to install package:', error)
      setInstallStatus('failed')
    }
  }

  const handleSubmitRating = async (rating: number, review?: string) => {
    if (!pkg) return

    try {
      await ratePackageMutation.mutateAsync({
        package_id: pkg.id,
        rating,
        review,
      })
    } catch (error) {
      console.error('[PackageDetailsPage] Failed to submit rating:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading package details...</p>
        </div>
      </div>
    )
  }

  if (!pkg) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Package className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-300 mb-2">Package not found</h2>
          <p className="text-gray-500 mb-6">The package you're looking for doesn't exist.</p>
          <Button onClick={handleBack} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Marketplace
          </Button>
        </div>
      </div>
    )
  }

  const hasSecurityIssues = pkg.latest_version.security_scan.scanned && !pkg.latest_version.security_scan.passed

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-gray-800/50 bg-gradient-to-b from-cyan-500/5 via-purple-500/5 to-transparent">
        <div className="container mx-auto px-6 py-6">
          <Button
            variant="ghost"
            onClick={handleBack}
            className="mb-4 text-gray-400 hover:text-gray-300"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Marketplace
          </Button>

          <div className="flex flex-col lg:flex-row gap-6 lg:items-start lg:justify-between">
            {/* Package Info */}
            <div className="flex-1">
              <div className="flex items-start gap-3 mb-3">
                <h1 className="text-3xl font-bold text-gray-100">{pkg.name}</h1>
                {pkg.verified && (
                  <Shield className="w-6 h-6 text-cyan-500 flex-shrink-0 mt-1" title="Verified by staff" />
                )}
              </div>

              <p className="text-lg text-gray-400 mb-4">{pkg.description}</p>

              {/* Tags */}
              <div className="flex flex-wrap gap-2 mb-4">
                <Badge variant="outline">{getCategoryLabel(pkg.category)}</Badge>
                {pkg.featured && (
                  <Badge className="bg-gradient-to-r from-cyan-500 to-purple-500 text-white">
                    Featured
                  </Badge>
                )}
                {pkg.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>

              {/* Author */}
              <div className="flex items-center gap-2 text-gray-400">
                <User className="w-4 h-4" />
                <span>by</span>
                <span className="font-medium text-gray-300">{pkg.author.username}</span>
                {pkg.author.verified && <Shield className="w-3 h-3 text-cyan-500" />}
              </div>
            </div>

            {/* Install Button */}
            <div className="flex flex-col gap-4">
              <Button
                size="lg"
                onClick={handleInstallClick}
                disabled={pkg.deprecated || hasSecurityIssues}
                className="bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-600 hover:to-purple-600 w-full lg:w-auto"
              >
                <Download className="w-5 h-5 mr-2" />
                Install Package
              </Button>

              {pkg.deprecated && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <AlertTriangle className="w-4 h-4 inline mr-2" />
                    This package is deprecated
                    {pkg.deprecated_reason && `: ${pkg.deprecated_reason}`}
                  </AlertDescription>
                </Alert>
              )}

              {hasSecurityIssues && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <AlertTriangle className="w-4 h-4 inline mr-2" />
                    Security issues detected. Installation blocked.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Tabs */}
            <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as typeof selectedTab)}>
              <TabsList className="bg-gray-900/50 w-full">
                <TabsTrigger value="readme" className="flex-1">
                  <FileText className="w-4 h-4 mr-2" />
                  README
                </TabsTrigger>
                <TabsTrigger value="code" className="flex-1">
                  <Code className="w-4 h-4 mr-2" />
                  Code
                </TabsTrigger>
                <TabsTrigger value="versions" className="flex-1">
                  <GitBranch className="w-4 h-4 mr-2" />
                  Versions
                </TabsTrigger>
                <TabsTrigger value="dependencies" className="flex-1">
                  <Package className="w-4 h-4 mr-2" />
                  Dependencies
                </TabsTrigger>
              </TabsList>

              <TabsContent value="readme" className="mt-6">
                <Card className="bg-gray-900/30 border-gray-800">
                  <CardContent className="p-6">
                    {pkg.latest_version.readme ? (
                      <div className="prose prose-invert prose-cyan max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {pkg.latest_version.readme}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="text-center py-12 text-gray-500">
                        No README provided for this package.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="code" className="mt-6">
                <PackageCodePreview
                  code={pkg.latest_version.code}
                  language="python"
                  fileName={`${pkg.slug}.py`}
                  maxHeight="600px"
                />
              </TabsContent>

              <TabsContent value="versions" className="mt-6">
                <Card className="bg-gray-900/30 border-gray-800">
                  <CardHeader>
                    <CardTitle>Version History</CardTitle>
                    <CardDescription>
                      All published versions of this package
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {pkg.versions.map((version) => (
                        <div
                          key={version.id}
                          className="flex items-start justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-800"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-gray-300">
                                v{version.version}
                              </span>
                              {version.id === pkg.latest_version.id && (
                                <Badge variant="secondary">Latest</Badge>
                              )}
                            </div>
                            <div className="text-sm text-gray-500">
                              Released {formatDistanceToNow(new Date(version.created_at), { addSuffix: true })}
                            </div>
                            {version.changelog && (
                              <p className="text-sm text-gray-400 mt-2">{version.changelog}</p>
                            )}
                          </div>
                          <div className="text-sm text-gray-500">
                            {formatDownloads(version.downloads)} downloads
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="dependencies" className="mt-6">
                <Card className="bg-gray-900/30 border-gray-800">
                  <CardHeader>
                    <CardTitle>Dependencies</CardTitle>
                    <CardDescription>
                      Packages required by v{pkg.latest_version.version}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {pkg.latest_version.dependencies.length > 0 ? (
                      <div className="space-y-2">
                        {pkg.latest_version.dependencies.map((dep, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-800"
                          >
                            <div className="flex items-center gap-2">
                              <Package className="w-4 h-4 text-gray-500" />
                              <span className="font-medium text-gray-300">{dep.package_name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {dep.version_constraint}
                              </Badge>
                              {dep.optional && (
                                <Badge variant="secondary" className="text-xs">
                                  Optional
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        No dependencies required
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Ratings & Reviews */}
            <Card className="bg-gray-900/30 border-gray-800">
              <CardHeader>
                <CardTitle>Ratings & Reviews</CardTitle>
              </CardHeader>
              <CardContent>
                <PackageRatings
                  packageId={pkg.id}
                  ratings={ratings || []}
                  averageRating={pkg.average_rating}
                  totalRatings={pkg.rating_count}
                  onSubmitRating={handleSubmitRating}
                  isSubmitting={ratePackageMutation.isPending}
                />
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Stats */}
            <Card className="bg-gray-900/30 border-gray-800">
              <CardHeader>
                <CardTitle className="text-base">Statistics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-400">
                    <Download className="w-4 h-4" />
                    <span className="text-sm">Downloads</span>
                  </div>
                  <span className="font-semibold text-gray-200">
                    {formatDownloads(pkg.total_downloads)}
                  </span>
                </div>
                <Separator className="bg-gray-800" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-400">
                    <Star className="w-4 h-4" />
                    <span className="text-sm">Rating</span>
                  </div>
                  <span className="font-semibold text-gray-200">
                    {formatRating(pkg.average_rating)} ({pkg.rating_count})
                  </span>
                </div>
                <Separator className="bg-gray-800" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-400">
                    <GitBranch className="w-4 h-4" />
                    <span className="text-sm">Version</span>
                  </div>
                  <span className="font-mono text-sm font-semibold text-gray-200">
                    v{pkg.latest_version.version}
                  </span>
                </div>
                <Separator className="bg-gray-800" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-400">
                    <Calendar className="w-4 h-4" />
                    <span className="text-sm">Updated</span>
                  </div>
                  <span className="text-sm text-gray-200">
                    {formatDistanceToNow(new Date(pkg.updated_at), { addSuffix: true })}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* License */}
            <Card className="bg-gray-900/30 border-gray-800">
              <CardHeader>
                <CardTitle className="text-base">License</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="outline" className="text-sm">
                  {pkg.license}
                </Badge>
              </CardContent>
            </Card>

            {/* Links */}
            {(pkg.repository_url || pkg.homepage_url || pkg.documentation_url) && (
              <Card className="bg-gray-900/30 border-gray-800">
                <CardHeader>
                  <CardTitle className="text-base">Links</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {pkg.repository_url && (
                    <a
                      href={pkg.repository_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-cyan-500 hover:text-cyan-400"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Repository
                    </a>
                  )}
                  {pkg.homepage_url && (
                    <a
                      href={pkg.homepage_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-cyan-500 hover:text-cyan-400"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Homepage
                    </a>
                  )}
                  {pkg.documentation_url && (
                    <a
                      href={pkg.documentation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-cyan-500 hover:text-cyan-400"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Documentation
                    </a>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Security Scan */}
            {pkg.latest_version.security_scan.scanned && (
              <Card className={cn(
                'border-gray-800',
                pkg.latest_version.security_scan.passed
                  ? 'bg-green-950/20 border-green-500/50'
                  : 'bg-red-950/20 border-red-500/50'
              )}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    {pkg.latest_version.security_scan.passed ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        Security Scan Passed
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                        Security Issues Found
                      </>
                    )}
                  </CardTitle>
                </CardHeader>
                {!pkg.latest_version.security_scan.passed && pkg.latest_version.security_scan.issues && (
                  <CardContent className="space-y-2">
                    {pkg.latest_version.security_scan.issues.map((issue, index) => (
                      <div key={index} className="text-sm">
                        <Badge variant="destructive" className="mr-2">
                          {issue.severity}
                        </Badge>
                        <span className="text-gray-400">{issue.description}</span>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            )}

            {/* Report Button */}
            <Button variant="outline" className="w-full" size="sm">
              <Flag className="w-4 h-4 mr-2" />
              Report Package
            </Button>
          </div>
        </div>
      </div>

      {/* Install Dialog */}
      <InstallDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        package={pkg}
        projects={projects?.data?.map((p) => ({ id: p.id, name: p.name })) || []}
        onInstall={handleInstall}
        installStatus={installStatus}
        installProgress={installStatus === 'installing' ? 50 : installStatus === 'installed' ? 100 : 0}
      />
    </div>
  )
}
