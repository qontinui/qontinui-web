"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ProcessBuilder } from "@/components/process-builder"
import { StateMachine } from "@/components/state-machine"
import { ImagesManager } from "@/components/images-manager"
import ScreenshotUploadTab from "@/components/ScreenshotTab/ScreenshotUploadTab"
import { AuthDialog } from "@/components/auth-dialog"
import { ProjectManager } from "@/components/project-manager"
import { Save, Download, Upload, User, LogOut, FileCode, Edit2, Check, X, Plus, Home } from "lucide-react"
import { toast } from "sonner"
import { AutomationProvider, useAutomation } from "@/contexts/automation-context"
import { useAuth } from "@/contexts/auth-context"
import { ConfigExporter } from "@/lib/config-exporter"
import { ConfigImporter } from "@/lib/config-importer"

import { Screenshot } from "../types/Screenshot"

function AutomationBuilderContent() {
  const [activeTab, setActiveTab] = useState("processes")
  const [authDialogOpen, setAuthDialogOpen] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [tempProjectName, setTempProjectName] = useState("")
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])
  const nameInputRef = useRef<HTMLInputElement>(null)
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
    categories
  } = useAutomation()
  const { user, logout } = useAuth()
  const router = useRouter()
  const exporter = new ConfigExporter()
  const importer = new ConfigImporter()

  useEffect(() => {
    const interval = setInterval(() => {
      triggerSave()
    }, 2000)

    return () => clearInterval(interval)
  }, [triggerSave])

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

  const handleLogout = () => {
    const warningMessage =
      "⚠️ WARNING: Make sure to Export or Save your current project first!\n\n" +
      "Logging out will permanently delete ALL unsaved data:\n\n" +
      "• All processes\n" +
      "• All states\n" +
      "• All transitions\n" +
      "• All uploaded images\n\n" +
      "This action cannot be undone!\n\n" +
      "Do you want to continue?"

    if (confirm(warningMessage)) {
      logout()
      router.push('/')
      toast.success("Logged out successfully")
    }
  }

  const handleGoToDashboard = () => {
    const warningMessage =
      "⚠️ WARNING: Make sure to Save your current project first!\n\n" +
      "Leaving this page may result in losing unsaved changes.\n\n" +
      "Do you want to continue?"

    if (confirm(warningMessage)) {
      router.push('/dashboard')
    }
  }

  const handleNewProject = () => {
    if (!user) {
      setAuthDialogOpen(true)
      toast.error("Authentication required", {
        description: "Please log in to create a new project.",
      })
      return
    }

    const warningMessage =
      "⚠️ WARNING: Make sure to Export or Save your current project first!\n\n" +
      "Creating a new project will permanently delete ALL unsaved data:\n\n" +
      "• All processes\n" +
      "• All states\n" +
      "• All transitions\n" +
      "• All uploaded images\n\n" +
      "This action cannot be undone!\n\n" +
      "Do you want to continue?"

    if (confirm(warningMessage)) {
      clearAllData()
      toast.success("New project created", {
        description: "All data has been cleared for your new project.",
      })
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
        undefined, // settings
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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full justify-start bg-[#27272A] border-b border-gray-800 rounded-none h-12 flex-shrink-0">
            <TabsTrigger
              value="processes"
              className="data-[state=active]:bg-[#00D9FF] data-[state=active]:text-black data-[state=inactive]:text-gray-300 font-medium px-6 hover:text-white transition-colors"
            >
              Process Builder
            </TabsTrigger>
            <TabsTrigger
              value="state-machine"
              className="data-[state=active]:bg-[#BD00FF] data-[state=active]:text-white data-[state=inactive]:text-gray-300 font-medium px-6 hover:text-white transition-colors"
            >
              State Machine
            </TabsTrigger>
            <TabsTrigger
              value="images"
              className="data-[state=active]:bg-[#00FF88] data-[state=active]:text-black data-[state=inactive]:text-gray-300 font-medium px-6 hover:text-white transition-colors"
            >
              Images
            </TabsTrigger>
            <TabsTrigger
              value="screenshots"
              className="data-[state=active]:bg-[#FFA500] data-[state=active]:text-black data-[state=inactive]:text-gray-300 font-medium px-6 hover:text-white transition-colors"
            >
              Screenshots
            </TabsTrigger>
          </TabsList>

          <TabsContent value="processes" className="flex-1 min-h-0">
            <ProcessBuilder />
          </TabsContent>

          <TabsContent value="state-machine" className="flex-1 min-h-0">
            <StateMachine />
          </TabsContent>

          <TabsContent value="images" className="flex-1 min-h-0 overflow-auto">
            <ImagesManager />
          </TabsContent>

          <TabsContent value="screenshots" className="flex-1 min-h-0 overflow-hidden">
            <ScreenshotUploadTab
              states={states}
              onExport={setScreenshots}
            />
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
