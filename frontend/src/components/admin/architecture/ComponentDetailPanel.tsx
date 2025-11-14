'use client'

/**
 * Component Detail Panel
 *
 * Displays detailed information about selected Qontinui ecosystem components
 */

import { ComponentType } from '@/app/(app)/admin/architecture/page'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  X,
  Github,
  Globe,
  Code2,
  Database,
  Zap,
  Users,
  Package,
  ExternalLink,
} from 'lucide-react'

interface ComponentDetailPanelProps {
  selectedComponent: ComponentType
  onClose: () => void
}

interface ComponentDetail {
  id: ComponentType
  name: string
  tagline: string
  description: string
  technologies: string[]
  features: string[]
  status: 'stable' | 'beta' | 'development'
  repository: string
  documentation?: string
  keyComponents: string[]
}

const componentDetails: Record<Exclude<ComponentType, null>, ComponentDetail> = {
  multistate: {
    id: 'multistate',
    name: 'MultiState',
    tagline: 'Manage multiple simultaneous states',
    description:
      'A Python library for managing complex state systems where multiple states can be active simultaneously. Unlike traditional finite state machines, MultiState handles coordinated transitions and state groups.',
    technologies: ['Python 3.10+', 'TypeScript', 'State Management'],
    features: [
      'Multiple active states simultaneously',
      'State groups that activate/deactivate together',
      'Pathfinding to multiple target states',
      'Coordinated transition execution with phases',
      'Incoming transitions for newly activated states',
    ],
    status: 'stable',
    repository: 'https://github.com/jspinak/multistate',
    documentation: 'https://qontinui.github.io/multistate/',
    keyComponents: ['StateManager', 'State', 'StateGroup', 'Transition'],
  },
  qontinui: {
    id: 'qontinui',
    name: 'Qontinui',
    tagline: 'GUI automation through visual recognition',
    description:
      'A Python library for automating graphical user interface interactions using model-based state management and visual recognition. Enables developers to create automated workflows by detecting UI elements and executing programmed actions.',
    technologies: ['Python 3.12+', 'OpenCV', 'PyAutoGUI', 'pynput', 'JSON'],
    features: [
      'Template-based image matching for element detection',
      'Cross-platform support (Windows, macOS, Linux)',
      'JSON-based automation configuration',
      'Process and state machine execution modes',
      'Hardware abstraction layer (HAL)',
      'Integration with MultiState for intelligent tracking',
    ],
    status: 'stable',
    repository: 'https://github.com/jspinak/qontinui',
    keyComponents: ['JSON Executor', 'State Models', 'Transition Models', 'HAL'],
  },
  'qontinui-runner': {
    id: 'qontinui-runner',
    name: 'Qontinui Runner',
    tagline: 'Desktop application for executing automations',
    description:
      'A desktop application that executes GUI automation configurations locally. Built with React, Tauri (Rust), and Python, it serves as the execution engine for Qontinui automation projects.',
    technologies: ['React', 'TypeScript', 'Rust', 'Tauri', 'Python', 'Node.js'],
    features: [
      'Real-time execution monitoring',
      'Multi-platform support (Windows, macOS, Linux)',
      'JSON configuration file handling',
      'Actual GUI automation (mouse, keyboard, vision)',
      'Multi-monitor targeting',
      'Python bridge for Qontinui engine',
    ],
    status: 'stable',
    repository: 'https://github.com/jspinak/qontinui-runner',
    keyComponents: ['React UI', 'Tauri Backend', 'Python Bridge', 'Automation Engine'],
  },
  'qontinui-web': {
    id: 'qontinui-web',
    name: 'Qontinui Web',
    tagline: 'Web-based visual automation builder',
    description:
      'A web-based configuration interface for creating and managing GUI automation projects. Provides a visual interface for state definition, element annotation, transition configuration, and mock execution for testing automation logic.',
    technologies: [
      'Next.js 14',
      'React 18',
      'TypeScript',
      'Tailwind CSS',
      'Zustand',
      'React Query',
    ],
    features: [
      'Visual state definition and management',
      'Element annotation and training',
      'Transition configuration',
      'Test scenario creation',
      'Mock execution for testing',
      'Project export for qontinui-runner',
      'Admin dashboard and analytics',
    ],
    status: 'development',
    repository: 'https://github.com/jspinak/qontinui-web',
    keyComponents: [
      'Frontend (Next.js)',
      'State Builder',
      'Element Annotator',
      'Mock Executor',
    ],
  },
  'qontinui-api': {
    id: 'qontinui-api',
    name: 'Qontinui API',
    tagline: 'FastAPI backend service',
    description:
      'The FastAPI backend service powering Qontinui Web. Handles user authentication, project management, state persistence, and provides REST API endpoints for all frontend operations.',
    technologies: [
      'FastAPI',
      'Python 3.12+',
      'SQLAlchemy',
      'PostgreSQL',
      'Redis',
      'Celery',
    ],
    features: [
      'REST API endpoints for all operations',
      'User authentication and authorization',
      'Project and state management',
      'Database operations with SQLAlchemy',
      'Caching with Redis',
      'Background task processing with Celery',
      'Admin API for system management',
    ],
    status: 'development',
    repository: 'https://github.com/jspinak/qontinui-web',
    keyComponents: ['API Endpoints', 'Database Models', 'Services', 'Auth System'],
  },
}

export function ComponentDetailPanel({ selectedComponent, onClose }: ComponentDetailPanelProps) {
  if (!selectedComponent) {
    return (
      <CardContent className="flex items-center justify-center h-full min-h-[600px]">
        <div className="text-center text-muted-foreground">
          <Package className="h-16 w-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium mb-2">No Component Selected</p>
          <p className="text-sm">Click on a component in the diagram to view details</p>
        </div>
      </CardContent>
    )
  }

  const detail = componentDetails[selectedComponent]

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'stable':
        return 'bg-green-500/10 text-green-500 border-green-500/20'
      case 'beta':
        return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
      case 'development':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20'
      default:
        return 'bg-gray-500/10 text-gray-500 border-gray-500/20'
    }
  }

  return (
    <>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <CardTitle className="text-2xl">{detail.name}</CardTitle>
              <Badge variant="outline" className={getStatusColor(detail.status)}>
                {detail.status}
              </Badge>
            </div>
            <CardDescription className="text-base">{detail.tagline}</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <ScrollArea className="h-[calc(100vh-250px)]">
        <CardContent className="space-y-6">
          {/* Description */}
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Code2 className="h-4 w-4" />
              Overview
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{detail.description}</p>
          </div>

          <Separator />

          {/* Technologies */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Database className="h-4 w-4" />
              Technologies
            </h3>
            <div className="flex flex-wrap gap-2">
              {detail.technologies.map((tech) => (
                <Badge key={tech} variant="secondary" className="text-xs">
                  {tech}
                </Badge>
              ))}
            </div>
          </div>

          <Separator />

          {/* Key Features */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Key Features
            </h3>
            <ul className="space-y-2">
              {detail.features.map((feature, index) => (
                <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <Separator />

          {/* Key Components */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Key Components
            </h3>
            <div className="flex flex-wrap gap-2">
              {detail.keyComponents.map((component) => (
                <Badge key={component} variant="outline" className="text-xs">
                  {component}
                </Badge>
              ))}
            </div>
          </div>

          <Separator />

          {/* Links */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Resources
            </h3>
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => window.open(detail.repository, '_blank')}
              >
                <Github className="h-4 w-4 mr-2" />
                View Repository
                <ExternalLink className="h-3 w-3 ml-auto" />
              </Button>
              {detail.documentation && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => window.open(detail.documentation, '_blank')}
                >
                  <Globe className="h-4 w-4 mr-2" />
                  Documentation
                  <ExternalLink className="h-3 w-3 ml-auto" />
                </Button>
              )}
            </div>
          </div>

          {/* Project Info */}
          <div className="bg-muted/50 rounded-lg p-4">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Users className="h-4 w-4" />
              Project Information
            </h3>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                <span className="font-medium">License:</span> MIT (Open Source)
              </p>
              <p>
                <span className="font-medium">Maintainer:</span> Joshua Spinak
              </p>
              <p>
                <span className="font-medium">Status:</span>{' '}
                <span className="capitalize">{detail.status}</span>
              </p>
            </div>
          </div>
        </CardContent>
      </ScrollArea>
    </>
  )
}
