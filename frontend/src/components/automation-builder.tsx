"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AutomationBuilder as UnifiedAutomationBuilder } from "@/components/automation-builder/AutomationBuilder"
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
import { BackgroundRemovalTab } from "@/components/background-removal/BackgroundRemovalTab"
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
import { TabStateProvider } from "@/contexts/tab-state-context"
import { useAuth } from "@/contexts/auth-context"
import { ConfigExporter } from "@/lib/config-exporter"
import { ConfigImporter } from "@/lib/config-importer"
import { projectService } from "@/services/service-factory"
import { useQueryClient } from "@tanstack/react-query"
import { projectKeys } from "@/hooks/use-projects"

import { Screenshot } from "../types/Screenshot"

function AutomationBuilderContent() {
  const [authDialogOpen, setAuthDialogOpen] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [tempProjectName, setTempProjectName] = useState("")
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null)
  const [createImagesDropdownOpen, setCreateImagesDropdownOpen] = useState(false)
  const [imageAssetsDropdownOpen, setImageAssetsDropdownOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const previousProjectName = useRef<string>('')
  const {
    projectName,
    setProjectName,
    renameProject,
    lastSaved,
    triggerSave,
    getConfiguration,
    loadConfiguration,
    clearAllData,
    images,
    workflows,
    states,
    transitions,
    categories,
    settings,
    updateSettings,
    setProjectId
  } = useAutomation()
  const { user, logout } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const exporter = new ConfigExporter()
  const importer = new ConfigImporter()

  // Get active category and tab from URL parameters
  const activeCategory = searchParams.get('category') || 'build'
  const activeTab = searchParams.get('tab') || getDefaultTab(activeCategory)

  // Helper to get default tab for a category
  function getDefaultTab(category: string): string {
    switch (category) {
      case 'build':
        return 'processes'
      case 'develop':
        return 'state-machine'
      case 'verify':
        return 'pattern-matching'
      case 'settings':
        return 'action-params'
      default:
        return 'processes'
    }
  }

  // Helper to update URL with new category/tab
  const updateRoute = (category: string, tab: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('category', category)
    params.set('tab', tab)
    router.push(`/automation-builder?${params.toString()}`)
  }

  // Load project from URL parameter
  useEffect(() => {
    const projectId = searchParams.get('project')
    if (projectId) {
      loadProjectFromBackend(projectId)
    }
  }, [searchParams])

  // Sync projectId to context whenever currentProjectId changes
  useEffect(() => {
    setProjectId(currentProjectId)
  }, [currentProjectId, setProjectId])

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
  }, [currentProjectId, workflows, states, transitions, images, screenshots])

  const loadProjectFromBackend = async (projectId: string) => {
    try {
      // Guard against invalid project IDs
      if (!projectId || isNaN(Number(projectId))) {
        console.warn('[automation-builder] Invalid project ID:', projectId)
        return
      }

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
      // Invalidate the projects list cache so dashboard shows updated name
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(currentProjectId) })
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

  const saveProjectName = async () => {
    if (tempProjectName.trim()) {
      await renameProject(tempProjectName.trim())
      setIsEditingName(false)
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
        workflows,
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

      // Validation for informational purposes only - don't block export
      const validation = exporter.validateConfiguration(config)
      if (!validation.valid) {
        console.warn('Validation warnings (not blocking export):', validation.errors)
      }

      // Download without auto-fix - export code should generate correct data
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
          description: `Loaded ${result.states.length} states, ${result.workflows?.length || 0} workflows`
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
        {/* Build Category - Unified Automation Builder */}
        {activeCategory === 'build' && (
          <UnifiedAutomationBuilder />
        )}

        {/* Develop Category - State Structure with nested sub-tabs */}
        {activeCategory === 'develop' && (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Render the appropriate component based on activeTab */}
            {activeTab === 'state-machine' && <StateStructure />}
            {activeTab === 'images' && <ImagesManager />}
            {activeTab === 'screenshots' && (
              <ScreenshotUploadTab
                states={states}
                onExport={setScreenshots}
              />
            )}
            {activeTab === 'screenshot-annotation' && <ScreenshotAnnotationTab states={states} />}
            {activeTab === 'image-extraction' && <ImageExtractionTab />}
            {activeTab === 'pattern-optimization' && <PatternOptimizationSimplified />}
            {activeTab === 'state-discovery' && <StateDiscoveryTab />}
            {activeTab === 'background-removal' && <BackgroundRemovalTab />}
          </div>
        )}

        {/* Verify Category - Testing & Verification tabs */}
        {activeCategory === 'verify' && (
          <div className="flex-1 min-h-0 flex flex-col">
            {activeTab === 'pattern-matching' && <PatternMatchingTest screenshots={screenshots} />}
            {activeTab === 'integration-tests' && <ProcessTestRunner />}
            {activeTab === 'semantic-analysis' && <SemanticAnalysisTab />}
          </div>
        )}

        {/* Settings Category */}
        {activeCategory === 'settings' && (
          <div className="flex-1 min-h-0 overflow-auto p-6">
            {activeTab === 'action-params' && (
              <ProjectSettingsComponent settings={settings} onUpdateSettings={updateSettings} />
            )}
            {activeTab === 'app-settings' && <SettingsTab />}
          </div>
        )}
      </main>

      <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} />
    </div>
  )
}

export default function AutomationBuilder() {
  return (
    <AutomationProvider>
      <TabStateProvider>
        <AutomationBuilderContent />
      </TabStateProvider>
    </AutomationProvider>
  )
}
