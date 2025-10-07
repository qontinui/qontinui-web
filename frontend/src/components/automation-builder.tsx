"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ProcessBuilder } from "@/components/process-builder"
import { StateStructure } from "@/components/state-machine"
import { ImagesManager } from "@/components/images-manager"
import ScreenshotUploadTab from "@/components/ScreenshotTab/ScreenshotUploadTab"
import ScreenshotAnnotationTab from "@/components/screenshot-annotation/ScreenshotAnnotationTab"
import { PatternMatchingTest } from "@/components/PatternMatching/PatternMatchingTest"
import { ProcessTestRunner } from "@/components/IntegrationTests/ProcessTestRunner"
import { PatternOptimizationSimplified } from "@/components/pattern-optimization/PatternOptimizationSimplified"
import { SemanticAnalysisTab } from "@/components/SemanticAnalysis/SemanticAnalysisTab"
import StateDiscoveryTab from "@/components/state-discovery/StateDiscoveryTab"
import { ImageExtractionTab } from "@/components/image-extraction/ImageExtractionTab"
import { AuthDialog } from "@/components/auth-dialog"
import { ProjectManager } from "@/components/project-manager"
import { SettingsTab } from "@/components/settings/SettingsTab"
import { ProjectSettingsComponent } from "@/components/project-settings"
import { Save, Download, Upload, User, LogOut, FileCode, Edit2, Check, X, Plus, Home, ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { AutomationProvider, useAutomation } from "@/contexts/automation-context"
import { useAuth } from "@/contexts/auth-context"
import { ConfigExporter } from "@/lib/config-exporter"
import { ConfigImporter } from "@/lib/config-importer"
import { projectService } from "@/services/service-factory"

import { Screenshot } from "../types/Screenshot"

function AutomationBuilderContent() {
  const [activeCategory, setActiveCategory] = useState("build")
  const [activeTab, setActiveTab] = useState("processes")
  const [authDialogOpen, setAuthDialogOpen] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [tempProjectName, setTempProjectName] = useState("")
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null)
  const [createImagesDropdownOpen, setCreateImagesDropdownOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const previousProjectName = useRef<string>('')

  // Set default tab when category changes
  useEffect(() => {
    if (activeCategory === "build") {
      setActiveTab("processes")
    } else if (activeCategory === "develop") {
      setActiveTab("state-machine")
    } else if (activeCategory === "verify") {
      setActiveTab("pattern-matching")
    } else if (activeCategory === "settings") {
      setActiveTab("settings")
    }
  }, [activeCategory])
  const {
    projectName,
    setProjectName,
    lastSaved,
    triggerSave,
    getConfiguration,
    loadConfiguration,
    clearAllData,
    images,
    processes,
    states,
    transitions,
    categories,
    settings,
    updateSettings
  } = useAutomation()
  const { user, logout } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const exporter = new ConfigExporter()
  const importer = new ConfigImporter()

  // Load project from URL parameter
  useEffect(() => {
    const projectId = searchParams.get('project')
    if (projectId) {
      loadProjectFromBackend(projectId)
    }
  }, [searchParams])

  // Sync project name to backend when it changes
  useEffect(() => {
    if (currentProjectId && projectName && projectName !== previousProjectName.current) {
      previousProjectName.current = projectName
      updateProjectName()
    }
  }, [projectName, currentProjectId])

  useEffect(() => {
    const interval = setInterval(() => {
      triggerSave()
    }, 2000)

    return () => clearInterval(interval)
  }, [triggerSave])

  // Auto-save configuration to backend every 10 seconds
  useEffect(() => {
    if (!currentProjectId) return

    const interval = setInterval(() => {
      saveConfigurationToBackend()
    }, 10000) // Every 10 seconds

    return () => clearInterval(interval)
  }, [currentProjectId, processes, states, transitions, images, screenshots])

  const loadProjectFromBackend = async (projectId: string) => {
    try {
      const project = await projectService.getProject(Number(projectId))

      // Load configuration first
      await loadConfiguration(project.configuration)

      // Then set the project name and ID from the backend (not from config)
      setProjectName(project.name)
      setCurrentProjectId(project.id)
      previousProjectName.current = project.name
    } catch (error) {
      console.error('Failed to load project:', error)
      toast.error('Failed to load project')
    }
  }

  const updateProjectName = async () => {
    if (!currentProjectId) return
    try {
      await projectService.updateProject(currentProjectId, {
        name: projectName,
      })
    } catch (error) {
      console.error('Failed to update project name:', error)
    }
  }

  const saveConfigurationToBackend = async () => {
    if (!currentProjectId) return
    try {
      const config = getConfiguration()
      await projectService.updateProject(currentProjectId, {
        configuration: config,
      })
    } catch (error) {
      console.error('Failed to auto-save configuration:', error)
    }
  }

  const startEditingName = () => {
    setTempProjectName(projectName)
    setIsEditingName(true)
    setTimeout(() => {
      nameInputRef.current?.select()
    }, 0)
  }

  const saveProjectName = () => {
    if (tempProjectName.trim()) {
      setProjectName(tempProjectName.trim())
      setIsEditingName(false)
      triggerSave()
    } else {
      cancelEditingName()
    }
  }

  const cancelEditingName = () => {
    setIsEditingName(false)
    setTempProjectName("")
  }

  const handleLogout = async () => {
    await saveConfigurationToBackend()
    logout()
    router.push('/')
    toast.success("Logged out successfully")
  }

  const handleGoToDashboard = async () => {
    await saveConfigurationToBackend()
    router.push('/dashboard')
  }

  const handleNewProject = () => {
    if (!user) {
      setAuthDialogOpen(true)
      toast.error("Authentication required", {
        description: "Please log in to create a new project.",
      })
      return
    }

    if (confirm("Create a new project from the dashboard instead? This ensures proper project isolation.")) {
      handleGoToDashboard()
    }
  }

  const handleSave = () => {
    if (!user) {
      setAuthDialogOpen(true)
      toast.error("Authentication required", {
        description: "Please log in to save your project.",
      })
      return
    }

    triggerSave()
    toast.success("Project saved", {
      description: "Your automation project has been saved successfully.",
    })
  }

  const handleExport = async () => {
    if (!user) {
      setAuthDialogOpen(true)
      toast.error("Authentication required", {
        description: "Please log in to export your project.",
      })
      return
    }

    try {
      // Use project settings from context
      const config = await exporter.exportConfiguration(
        images,
        processes,
        states,
        transitions,
        categories,
        {
          name: projectName,
          description: 'Exported from Qontinui Web',
          author: user?.username
        },
        settings, // Use project settings from context
        screenshots
      )

      const validation = exporter.validateConfiguration(config)
      if (!validation.valid) {
        toast.error("Export validation failed", {
          description: validation.errors.join(', ')
        })
        return
      }

      exporter.downloadConfiguration(config, `${projectName.replace(/\s+/g, '_')}_config.json`)

      toast.success("Export complete", {
        description: "Configuration downloaded successfully.",
      })
    } catch (error) {
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  const handleImport = async () => {
    if (!user) {
      setAuthDialogOpen(true)
      toast.error("Authentication required", {
        description: "Please log in to import a project.",
      })
      return
    }

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        const result = await importer.loadFromFile(file)

        if (result.errors.length > 0) {
          toast.error("Import failed", {
            description: result.errors.join(', ')
          })
          return
        }

        if (result.warnings.length > 0) {
          result.warnings.forEach(warning => {
            toast.warning("Import warning", { description: warning })
          })
        }

        // Update the automation context with imported data
        // This would need methods in the automation context to bulk update
        handleLoadConfiguration(result)

        toast.success("Import successful", {
          description: `Loaded ${result.states.length} states, ${result.processes.length} processes`
        })
      } catch (error) {
        toast.error("Import failed", {
          description: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    input.click()
  }

  const handleLoadConfiguration = (config: any) => {
    // This will be called by ProjectManager when loading a project
    // The automation context will handle updating all the state, including project name
    loadConfiguration(config)
  }

  return (
    <div className="h-screen bg-[#0A0A0B] text-white flex flex-col overflow-hidden">
      <header className="border-b border-gray-800 bg-[#0A0A0B]/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <Input
                  ref={nameInputRef}
                  value={tempProjectName}
                  onChange={(e) => setTempProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveProjectName()
                    if (e.key === 'Escape') cancelEditingName()
                  }}
                  className="text-xl font-bold bg-transparent border-[#00D9FF] text-[#00D9FF] h-8 px-2"
                  autoFocus
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={saveProjectName}
                  className="h-6 w-6 p-0"
                >
                  <Check className="w-4 h-4 text-green-500" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={cancelEditingName}
                  className="h-6 w-6 p-0"
                >
                  <X className="w-4 h-4 text-red-500" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h1 className="text-xl font-bold text-[#00D9FF]">{projectName}</h1>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={startEditingName}
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Edit2 className="w-4 h-4 text-gray-400 hover:text-[#00D9FF]" />
                </Button>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              {lastSaved ? `Saved ${new Date(lastSaved).toLocaleTimeString()}` : "Auto-saved"}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewProject}
              className={`border-gray-700 bg-transparent ${
                user
                  ? "text-gray-300 hover:border-[#FFD700] hover:text-[#FFD700]"
                  : "text-gray-500 hover:border-red-500 hover:text-red-500 cursor-pointer"
              }`}
              title={!user ? "Login required" : ""}
            >
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
            {user && (
              <ProjectManager
                currentConfiguration={getConfiguration()}
                onLoadConfiguration={handleLoadConfiguration}
              />
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              className={`border-gray-700 bg-transparent ${
                user
                  ? "text-gray-300 hover:border-[#00D9FF] hover:text-[#00D9FF]"
                  : "text-gray-500 hover:border-red-500 hover:text-red-500 cursor-pointer"
              }`}
              title={!user ? "Login required" : ""}
            >
              <Save className="w-4 h-4 mr-2" />
              Quick Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleImport}
              className={`border-gray-700 bg-transparent ${
                user
                  ? "text-gray-300 hover:border-[#00FF88] hover:text-[#00FF88]"
                  : "text-gray-500 hover:border-red-500 hover:text-red-500 cursor-pointer"
              }`}
              title={!user ? "Login required" : ""}
            >
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className={`border-gray-700 bg-transparent ${
                user
                  ? "text-gray-300 hover:border-[#BD00FF] hover:text-[#BD00FF]"
                  : "text-gray-500 hover:border-red-500 hover:text-red-500 cursor-pointer"
              }`}
              title={!user ? "Login required" : ""}
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            {user ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGoToDashboard}
                  className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF] bg-transparent"
                  title="Go to Dashboard"
                >
                  <Home className="w-4 h-4 mr-2" />
                  Dashboard
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLogout}
                  className="border-gray-700 hover:border-red-500 hover:text-red-500 bg-transparent"
                  title={`Signed in as ${user.username}`}
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAuthDialogOpen(true)}
                className="border-gray-700 hover:border-gray-600 bg-transparent"
              >
                <User className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col min-h-0">
        {/* Main Category Tabs */}
        <Tabs value={activeCategory} onValueChange={setActiveCategory} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full justify-start bg-[#1A1A1C] border-b border-gray-800 rounded-none h-14 flex-shrink-0">
            <TabsTrigger
              value="build"
              className="data-[state=active]:bg-[#00D9FF] data-[state=active]:text-black data-[state=inactive]:text-gray-300 font-semibold px-8 hover:text-white transition-colors h-10"
            >
              Build Automation Processes
            </TabsTrigger>
            <TabsTrigger
              value="develop"
              className="data-[state=active]:bg-[#BD00FF] data-[state=active]:text-white data-[state=inactive]:text-gray-300 font-semibold px-8 hover:text-white transition-colors h-10"
            >
              Develop State Structure
            </TabsTrigger>
            <TabsTrigger
              value="verify"
              className="data-[state=active]:bg-[#FF6B6B] data-[state=active]:text-white data-[state=inactive]:text-gray-300 font-semibold px-8 hover:text-white transition-colors h-10"
            >
              Verify Automation
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="data-[state=active]:bg-[#FFD700] data-[state=active]:text-black data-[state=inactive]:text-gray-300 font-semibold px-8 hover:text-white transition-colors h-10"
            >
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Build Category - Just Process Builder */}
          <TabsContent value="build" className="flex-1 min-h-0 mt-0">
            <ProcessBuilder />
          </TabsContent>

          {/* Develop Category - State Structure with nested sub-tabs */}
          <TabsContent value="develop" className="flex-1 min-h-0 mt-0 flex flex-col">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
              <div className="bg-[#27272A] border-b border-gray-700 h-11 flex items-center px-4 gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setActiveTab("state-machine")}
                  className={`h-9 px-6 font-medium transition-colors rounded-md ${
                    activeTab === "state-machine"
                      ? "bg-[#BD00FF] text-white"
                      : "text-gray-400 hover:text-white hover:bg-transparent"
                  }`}
                >
                  State Structure
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => setActiveTab("images")}
                  className={`h-9 px-6 font-medium transition-colors rounded-md ${
                    activeTab === "images"
                      ? "bg-[#00FF88] text-black"
                      : "text-gray-400 hover:text-white hover:bg-transparent"
                  }`}
                >
                  Image Library
                </Button>

                {/* Create Images Dropdown */}
                <DropdownMenu open={createImagesDropdownOpen} onOpenChange={setCreateImagesDropdownOpen} modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className={`h-9 px-6 font-medium transition-colors rounded-md ${
                        ["screenshots", "image-extraction", "pattern-optimization", "state-discovery"].includes(activeTab)
                          ? "bg-[#FFD700] text-black hover:bg-[#FFD700]/90"
                          : "text-gray-400 hover:text-white hover:bg-transparent"
                      }`}
                      onMouseEnter={() => setCreateImagesDropdownOpen(true)}
                      onMouseLeave={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const isMovingDown = e.clientY > rect.bottom
                        if (!isMovingDown) {
                          setCreateImagesDropdownOpen(false)
                        }
                      }}
                    >
                      Create Images
                      <ChevronDown className="ml-1 h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-56 bg-[#27272A] border-gray-700"
                    onMouseEnter={() => setCreateImagesDropdownOpen(true)}
                    onMouseLeave={() => setCreateImagesDropdownOpen(false)}
                  >
                    <DropdownMenuItem
                      onClick={() => setActiveTab("screenshots")}
                      className="cursor-pointer text-gray-300 hover:text-white hover:bg-[#FF8C42]/20 focus:bg-[#FF8C42]/20 focus:text-white"
                    >
                      <span className="w-3 h-3 rounded-full bg-[#FF8C42] mr-3" />
                      Screenshots
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setActiveTab("image-extraction")}
                      className="cursor-pointer text-gray-300 hover:text-white hover:bg-[#FFA500]/20 focus:bg-[#FFA500]/20 focus:text-white"
                    >
                      <span className="w-3 h-3 rounded-full bg-[#FFA500] mr-3" />
                      Image Extraction
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setActiveTab("pattern-optimization")}
                      className="cursor-pointer text-gray-300 hover:text-white hover:bg-[#FFD700]/20 focus:bg-[#FFD700]/20 focus:text-white"
                    >
                      <span className="w-3 h-3 rounded-full bg-[#FFD700] mr-3" />
                      Pattern Optimization
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setActiveTab("state-discovery")}
                      className="cursor-pointer text-gray-300 hover:text-white hover:bg-[#4ECDC4]/20 focus:bg-[#4ECDC4]/20 focus:text-white"
                    >
                      <span className="w-3 h-3 rounded-full bg-[#4ECDC4] mr-3" />
                      State Discovery
                      <span className="ml-2 text-xs bg-amber-500 text-black px-1.5 py-0.5 rounded">Beta</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  variant="ghost"
                  onClick={() => setActiveTab("screenshot-annotation")}
                  className={`h-9 px-6 font-medium transition-colors rounded-md ${
                    activeTab === "screenshot-annotation"
                      ? "bg-[#FF6B35] text-white"
                      : "text-gray-400 hover:text-white hover:bg-transparent"
                  }`}
                >
                  Create Regions & Locations
                </Button>
              </div>

              <TabsContent value="state-machine" className="flex-1 min-h-0 mt-0">
                <StateStructure />
              </TabsContent>
              <TabsContent value="images" className="flex-1 min-h-0 overflow-auto mt-0">
                <ImagesManager />
              </TabsContent>
              <TabsContent value="screenshot-annotation" className="flex-1 min-h-0 mt-0">
                <ScreenshotAnnotationTab states={states} />
              </TabsContent>
              <TabsContent value="pattern-optimization" className="flex-1 min-h-0 overflow-hidden mt-0">
                <PatternOptimizationSimplified />
              </TabsContent>
              <TabsContent value="image-extraction" className="flex-1 min-h-0 overflow-hidden mt-0">
                <ImageExtractionTab />
              </TabsContent>
              <TabsContent value="screenshots" className="flex-1 min-h-0 overflow-auto mt-0">
                <ScreenshotUploadTab
                  states={states}
                  onExport={setScreenshots}
                />
              </TabsContent>
              <TabsContent value="state-discovery" className="flex-1 min-h-0 mt-0">
                <StateDiscoveryTab />
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* Verify Category - Testing & Verification tabs */}
          <TabsContent value="verify" className="flex-1 min-h-0 mt-0 flex flex-col">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
              <TabsList className="w-full justify-start bg-[#27272A] border-b border-gray-700 rounded-none h-11 flex-shrink-0">
                <TabsTrigger
                  value="pattern-matching"
                  className="data-[state=active]:bg-[#FF6B6B] data-[state=active]:text-white data-[state=inactive]:text-gray-400 font-medium px-6 hover:text-white transition-colors"
                >
                  Pattern Matching
                </TabsTrigger>
                <TabsTrigger
                  value="integration-tests"
                  className="data-[state=active]:bg-[#9B59B6] data-[state=active]:text-white data-[state=inactive]:text-gray-400 font-medium px-6 hover:text-white transition-colors"
                  title="⚠️ This feature is in active development"
                >
                  <span>Integration Tests</span>
                  <span className="ml-1 text-xs bg-amber-500 text-black px-1.5 py-0.5 rounded">Beta</span>
                </TabsTrigger>
                <TabsTrigger
                  value="semantic-analysis"
                  className="data-[state=active]:bg-[#E91E63] data-[state=active]:text-white data-[state=inactive]:text-gray-400 font-medium px-6 hover:text-white transition-colors"
                  title="⚠️ This feature is in active development"
                >
                  <span>Semantic Analysis</span>
                  <span className="ml-1 text-xs bg-amber-500 text-black px-1.5 py-0.5 rounded">Beta</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pattern-matching" className="flex-1 min-h-0 overflow-hidden mt-0">
                <PatternMatchingTest screenshots={screenshots} />
              </TabsContent>
              <TabsContent value="integration-tests" className="flex-1 min-h-0 overflow-hidden mt-0">
                <ProcessTestRunner />
              </TabsContent>
              <TabsContent value="semantic-analysis" className="flex-1 min-h-0 overflow-hidden mt-0">
                <SemanticAnalysisTab />
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* Settings Category */}
          <TabsContent value="settings" className="flex-1 min-h-0 mt-0 overflow-auto p-6">
            <Tabs defaultValue="action-params" className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-gray-800">
                <TabsTrigger value="action-params">Action Parameters</TabsTrigger>
                <TabsTrigger value="app-settings">Application Settings</TabsTrigger>
              </TabsList>
              <TabsContent value="action-params" className="mt-6">
                <ProjectSettingsComponent settings={settings} onUpdateSettings={updateSettings} />
              </TabsContent>
              <TabsContent value="app-settings" className="mt-6">
                <SettingsTab />
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </main>

      <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} />
    </div>
  )
}

export default function AutomationBuilder() {
  return (
    <AutomationProvider>
      <AutomationBuilderContent />
    </AutomationProvider>
  )
}
