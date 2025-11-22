"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/contexts/auth-context"
import { httpClient, projectService } from "@/services/service-factory"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowLeft, Copy, Download, Loader2, RefreshCw, Monitor, Settings } from "lucide-react"
import { toast } from "sonner"
import { QRCodeSVG } from "qrcode.react"
import { ConnectionString } from "@/components/runners/ConnectionString"
import { useActiveConnections } from "@/hooks/useRunners"
import type { Project } from "@/services/project-service"
import { AutomationStreamingCard } from "@/components/profile/automation-streaming-card"

interface ConnectionInfo {
  version: string
  url: string
  token: string
  userId: string
  projectId: number | null
  createdAt: string
  backendUrl: string
  runnerTokenId?: string
}

export default function ConnectRunnerPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [useDedicatedToken, setUseDedicatedToken] = useState(true)
  const [tokenName, setTokenName] = useState("")
  const [expiresInDays, setExpiresInDays] = useState("30")

  const { data: activeConnections } = useActiveConnections(5000)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/')
      return
    }

    if (user) {
      loadData()
    }
  }, [user, authLoading, router])

  const loadData = async () => {
    try {
      setLoading(true)

      // Load connection info and projects in parallel
      const [connInfo, projectsList] = await Promise.all([
        fetchConnectionInfo(),
        projectService.getProjects()
      ])

      setConnectionInfo(connInfo)
      setProjects(projectsList)

      // Auto-select first project if available
      if (projectsList.length > 0 && !selectedProjectId) {
        setSelectedProjectId(projectsList[0].id)
      }
    } catch (error) {
      console.error('Failed to load data:', error)
      toast.error('Failed to load connection information')
    } finally {
      setLoading(false)
    }
  }

  const fetchConnectionInfo = async (): Promise<ConnectionInfo> => {
    const response = await httpClient.fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/users/me/connection-info`
    )
    if (!response.ok) {
      throw new Error('Failed to fetch connection info')
    }
    return response.json()
  }

  const getConnectionString = (): string => {
    if (!connectionInfo) return ''

    const config = {
      ...connectionInfo,
      projectId: selectedProjectId
    }

    return JSON.stringify(config, null, 2)
  }

  const handleCopyConnectionString = async () => {
    const connectionString = getConnectionString()
    try {
      await navigator.clipboard.writeText(connectionString)
      setCopied(true)
      toast.success('Connection string copied to clipboard!')
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
      toast.error('Failed to copy connection string')
    }
  }

  const handleDownloadConfig = () => {
    const connectionString = getConnectionString()
    const blob = new Blob([connectionString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'qontinui-runner-config.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('Configuration file downloaded!')
  }

  const handleRefresh = async () => {
    await loadData()
    toast.success('Connection information refreshed!')
  }

  const handleBackToDashboard = () => {
    router.push('/dashboard')
  }

  // Show loading while auth is checking
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
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
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToDashboard}
              className="text-gray-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
              Connect Runner
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-5xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold mb-2">Connect Desktop Runner</h2>
              <p className="text-gray-400">
                Use this connection information to link the qontinui-runner desktop app to your account
              </p>
            </div>
            <div className="flex gap-3">
              {activeConnections && activeConnections.length > 0 && (
                <Badge variant="outline" className="border-green-500/50 text-green-500">
                  <Monitor className="w-3 h-3 mr-1" />
                  {activeConnections.length} Active
                </Badge>
              )}
              <Link href="/runners">
                <Button variant="outline" className="border-gray-700">
                  <Settings className="w-4 h-4 mr-2" />
                  Manage Runners
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
            <div className="text-lg text-gray-400">Loading connection information...</div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Automation Streaming Settings - Full Width */}
            <AutomationStreamingCard context="connect-runner" />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column - Configuration */}
              <div className="space-y-6">
              {/* Token Options */}
              <Card className="bg-[#1A1A1B] border-gray-800 p-6">
                <h3 className="text-xl font-semibold mb-4">Connection Options</h3>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="dedicated-token"
                      checked={useDedicatedToken}
                      onCheckedChange={(checked) => setUseDedicatedToken(checked as boolean)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <Label htmlFor="dedicated-token" className="text-white cursor-pointer">
                        Create dedicated runner token (Recommended)
                      </Label>
                      <p className="text-sm text-gray-400 mt-1">
                        A dedicated token can be revoked independently and provides better security than using your JWT
                      </p>
                    </div>
                  </div>

                  {useDedicatedToken && (
                    <div className="space-y-4 pl-7">
                      <div>
                        <Label htmlFor="token-name" className="text-gray-400">Token Name</Label>
                        <Input
                          id="token-name"
                          placeholder="e.g., My Laptop, Work Desktop"
                          value={tokenName}
                          onChange={(e) => setTokenName(e.target.value)}
                          className="mt-2 bg-[#0A0A0B] border-gray-700"
                        />
                      </div>

                      <div>
                        <Label htmlFor="expiration" className="text-gray-400">Expiration</Label>
                        <select
                          id="expiration"
                          value={expiresInDays}
                          onChange={(e) => setExpiresInDays(e.target.value)}
                          className="mt-2 w-full px-3 py-2 bg-[#0A0A0B] border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#00D9FF]"
                        >
                          <option value="7">7 days</option>
                          <option value="30">30 days</option>
                          <option value="90">90 days</option>
                          <option value="365">1 year</option>
                          <option value="never">Never expires</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* Project Selection */}
              <Card className="bg-[#1A1A1B] border-gray-800 p-6">
                <h3 className="text-xl font-semibold mb-4">Select Project</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">
                      Choose the project for the runner to work with:
                    </label>
                    <select
                      value={selectedProjectId || ''}
                      onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#0A0A0B] border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#00D9FF]"
                    >
                      <option value="">Select a project</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {projects.length === 0 && (
                    <p className="text-sm text-amber-400">
                      No projects found. Create a project first.
                    </p>
                  )}
                </div>
              </Card>

              {/* Connection String */}
              <Card className="bg-[#1A1A1B] border-gray-800 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold">Connection String</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefresh}
                    className="text-gray-400 hover:text-white"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
                <div className="space-y-4">
                  <div className="relative">
                    <pre className="bg-[#0A0A0B] border border-gray-700 rounded-lg p-4 text-sm overflow-x-auto max-h-80 overflow-y-auto">
                      <code className="text-gray-300">{getConnectionString()}</code>
                    </pre>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleCopyConnectionString}
                      className="flex-1 bg-[#00D9FF] hover:bg-[#00B8DB] text-black"
                      disabled={!selectedProjectId}
                    >
                      {copied ? (
                        <>Copy Succeeded!</>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 mr-2" />
                          Copy Connection String
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={handleDownloadConfig}
                      variant="outline"
                      className="border-gray-700 hover:bg-[#1A1A1B]"
                      disabled={!selectedProjectId}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                  </div>
                  {!selectedProjectId && (
                    <p className="text-sm text-amber-400">
                      Please select a project to enable copy and download
                    </p>
                  )}
                </div>
              </Card>
            </div>

            {/* Right Column - QR Code */}
            <div className="space-y-6">
              <Card className="bg-[#1A1A1B] border-gray-800 p-6">
                <h3 className="text-xl font-semibold mb-4">QR Code</h3>
                <div className="flex flex-col items-center space-y-4">
                  {selectedProjectId && connectionInfo ? (
                    <>
                      <div className="bg-white p-4 rounded-lg">
                        <QRCodeSVG
                          value={getConnectionString()}
                          size={256}
                          level="H"
                          includeMargin={true}
                        />
                      </div>
                      <p className="text-sm text-gray-400 text-center">
                        Scan this QR code with the desktop runner app to connect instantly
                      </p>
                    </>
                  ) : (
                    <div className="bg-[#0A0A0B] border border-gray-700 rounded-lg p-12 text-center">
                      <p className="text-gray-400">
                        Select a project to generate QR code
                      </p>
                    </div>
                  )}
                </div>
              </Card>

              {/* Instructions */}
              <Card className="bg-[#1A1A1B] border-gray-800 p-6">
                <h3 className="text-xl font-semibold mb-4">How to Connect</h3>
                <ol className="space-y-3 text-sm text-gray-400">
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#00D9FF] text-black flex items-center justify-center font-semibold">
                      1
                    </span>
                    <span>Select a project from the dropdown above</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#00D9FF] text-black flex items-center justify-center font-semibold">
                      2
                    </span>
                    <span>
                      Either scan the QR code or copy the connection string
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#00D9FF] text-black flex items-center justify-center font-semibold">
                      3
                    </span>
                    <span>
                      Paste the connection string in the desktop runner app
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#00D9FF] text-black flex items-center justify-center font-semibold">
                      4
                    </span>
                    <span>
                      The runner will connect and sync with your account
                    </span>
                  </li>
                </ol>
              </Card>
            </div>
          </div>
          </div>
        )}
      </main>
    </div>
  )
}
