"use client"

/**
 * Simplified Automation Builder
 *
 * This component shows just the workflow editor without the complex tab navigation.
 * Individual features (states, images, testing, etc.) are now accessed via the
 * left sidebar navigation.
 */

import { useEffect, useState, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { AutomationBuilder as UnifiedAutomationBuilder } from "@/components/automation-builder/AutomationBuilder"
import { toast } from "sonner"
import { AutomationProvider, useAutomation } from "@/contexts/automation-context"
import { projectService } from "@/services/service-factory"

function AutomationBuilderContent() {
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null)
  const previousProjectName = useRef<string>('')
  const searchParams = useSearchParams()

  const {
    projectName,
    setProjectName,
    lastSaved,
    triggerSave,
    getConfiguration,
    loadConfiguration,
    workflows,
    states,
    transitions,
    images,
    setProjectId
  } = useAutomation()

  // Load project from URL parameter
  useEffect(() => {
    const projectId = searchParams.get('project')
    if (projectId) {
      loadProjectFromBackend(projectId)
    }
  }, [searchParams])

  // Sync projectId to context
  useEffect(() => {
    setProjectId(currentProjectId)
  }, [currentProjectId, setProjectId])

  // Auto-save to localStorage
  useEffect(() => {
    const interval = setInterval(() => {
      triggerSave()
    }, 2000)
    return () => clearInterval(interval)
  }, [triggerSave])

  // Auto-save to backend
  useEffect(() => {
    if (!currentProjectId) return

    const interval = setInterval(() => {
      saveConfigurationToBackend()
    }, 10000)
    return () => clearInterval(interval)
  }, [currentProjectId, workflows, states, transitions, images])

  const loadProjectFromBackend = async (projectId: string) => {
    try {
      if (!projectId || isNaN(Number(projectId))) {
        console.warn('[automation-builder] Invalid project ID:', projectId)
        return
      }

      const project = await projectService.getProject(Number(projectId))
      await loadConfiguration(project.configuration)
      setProjectName(project.name)
      setCurrentProjectId(project.id)
      previousProjectName.current = project.name
    } catch (error) {
      console.error('Failed to load project:', error)
      toast.error('Failed to load project')
    }
  }

  const saveConfigurationToBackend = async () => {
    if (!currentProjectId) return

    try {
      const config = getConfiguration()
      await projectService.updateProject(currentProjectId.toString(), {
        configuration: config,
      })
    } catch (error) {
      console.error('Failed to save configuration:', error)
    }
  }

  return (
    <div className="h-full w-full flex flex-col bg-[#1E1E1E]">
      {/* Project Name Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-white">
            {projectName || 'Untitled Project'}
          </h1>
          {lastSaved && (
            <span className="text-sm text-gray-400">
              Last saved: {new Date(lastSaved).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Workflow Editor */}
      <div className="flex-1 min-h-0">
        <UnifiedAutomationBuilder />
      </div>
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
