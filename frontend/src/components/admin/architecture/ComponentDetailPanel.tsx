'use client'

/**
 * Component Detail Panel
 *
 * Enhanced detailed information about selected Qontinui ecosystem components
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
  GitBranch,
  Star,
  BookOpen,
  Layers,
  ArrowRight,
  Target,
  CheckCircle2,
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
  useCases: string[]
  integrations: { name: string; description: string }[]
  version?: string
}

const componentDetails: Record<Exclude<ComponentType, null>, ComponentDetail> = {
  multistate: {
    id: 'multistate',
    name: 'MultiState',
    tagline: 'Manage multiple simultaneous states',
    description:
      'A Python library for managing complex state systems where multiple states can be active simultaneously. Unlike traditional finite state machines, MultiState handles coordinated transitions and state groups, making it ideal for complex application workflows.',
    technologies: ['Python 3.10+', 'TypeScript', 'State Management', 'Graph Theory'],
    features: [
      'Multiple active states simultaneously',
      'State groups that activate/deactivate together',
      'Pathfinding to multiple target states',
      'Coordinated transition execution with phases',
      'Incoming transitions for newly activated states',
      'Event-driven state changes',
      'Hierarchical state organization',
    ],
    status: 'stable',
    repository: 'https://github.com/jspinak/multistate',
    documentation: 'https://qontinui.github.io/multistate/',
    keyComponents: ['StateManager', 'State', 'StateGroup', 'Transition', 'Pathfinder'],
    useCases: [
      'Complex GUI automation workflows',
      'Multi-step process management',
      'Game state management',
      'Workflow orchestration systems',
      'Application state coordination',
    ],
    integrations: [
      {
        name: 'Qontinui',
        description: 'Powers the state management for GUI automation workflows',
      },
    ],
    version: '1.0.0',
  },
  qontinui: {
    id: 'qontinui',
    name: 'Qontinui',
    tagline: 'GUI automation through visual recognition',
    description:
      'A Python library for automating graphical user interface interactions using model-based state management and visual recognition. Enables developers to create automated workflows by detecting UI elements and executing programmed actions with precision and reliability.',
    technologies: ['Python 3.12+', 'OpenCV', 'PyAutoGUI', 'pynput', 'JSON', 'Computer Vision'],
    features: [
      'Template-based image matching for element detection',
      'Cross-platform support (Windows, macOS, Linux)',
      'JSON-based automation configuration',
      'Process and state machine execution modes',
      'Hardware abstraction layer (HAL)',
      'Integration with MultiState for intelligent tracking',
      'Mouse and keyboard simulation',
      'Multi-monitor support',
      'Screenshot capture and analysis',
    ],
    status: 'stable',
    repository: 'https://github.com/jspinak/qontinui',
    keyComponents: ['JSON Executor', 'State Models', 'Transition Models', 'HAL', 'Vision Engine'],
    useCases: [
      'Automated software testing',
      'Repetitive task automation',
      'Desktop application workflows',
      'Data entry automation',
      'GUI regression testing',
      'Process automation',
    ],
    integrations: [
      {
        name: 'MultiState',
        description: 'Uses MultiState for managing complex automation workflows',
      },
      {
        name: 'OpenCV',
        description: 'Leverages OpenCV for image recognition and template matching',
      },
    ],
    version: '1.0.0',
  },
  'qontinui-runner': {
    id: 'qontinui-runner',
    name: 'Qontinui Runner',
    tagline: 'Desktop application for executing automations',
    description:
      'A powerful desktop application that executes GUI automation configurations locally. Built with React, Tauri (Rust), and Python, it serves as the execution engine for Qontinui automation projects, providing a user-friendly interface for running and monitoring automations.',
    technologies: ['React', 'TypeScript', 'Rust', 'Tauri', 'Python', 'Node.js', 'Electron Alternative'],
    features: [
      'Real-time execution monitoring',
      'Multi-platform support (Windows, macOS, Linux)',
      'JSON configuration file handling',
      'Actual GUI automation (mouse, keyboard, vision)',
      'Multi-monitor targeting',
      'Python bridge for Qontinui engine',
      'Visual execution feedback',
      'Error handling and recovery',
      'Configuration validation',
      'Execution history and logs',
    ],
    status: 'stable',
    repository: 'https://github.com/jspinak/qontinui-runner',
    keyComponents: ['React UI', 'Tauri Backend', 'Python Bridge', 'Automation Engine', 'Process Manager'],
    useCases: [
      'Running exported automation projects',
      'Local automation execution',
      'Development and testing of automations',
      'Production automation deployment',
      'Scheduled task execution',
    ],
    integrations: [
      {
        name: 'Qontinui',
        description: 'Executes automation scripts created with the Qontinui library',
      },
      {
        name: 'Qontinui API',
        description: 'Imports configuration files exported from Qontinui Web',
      },
    ],
    version: '1.0.0',
  },
  'qontinui-web': {
    id: 'qontinui-web',
    name: 'Qontinui Web',
    tagline: 'Web-based visual automation builder',
    description:
      'A comprehensive web-based configuration interface for creating and managing GUI automation projects. Provides an intuitive visual interface for state definition, element annotation, transition configuration, and mock execution for testing automation logic before deployment.',
    technologies: [
      'Next.js 14',
      'React 18',
      'TypeScript',
      'Tailwind CSS',
      'Zustand',
      'React Query',
      'FastAPI',
    ],
    features: [
      'Visual state definition and management',
      'Element annotation and training',
      'Transition configuration',
      'Test scenario creation',
      'Mock execution for testing',
      'Project export for qontinui-runner',
      'Admin dashboard and analytics',
      'User authentication and authorization',
      'Project collaboration features',
      'Version control integration',
      'Cloud storage for projects',
    ],
    status: 'development',
    repository: 'https://github.com/jspinak/qontinui-web',
    keyComponents: [
      'Frontend (Next.js)',
      'State Builder',
      'Element Annotator',
      'Mock Executor',
      'Project Manager',
    ],
    useCases: [
      'Visual automation design',
      'Team collaboration on automation projects',
      'Testing automation logic',
      'Training ML models for element detection',
      'Managing automation configurations',
      'Prototyping automation workflows',
    ],
    integrations: [
      {
        name: 'Qontinui API',
        description: 'Backend service providing REST API for all operations',
      },
      {
        name: 'Qontinui',
        description: 'Mock execution using Qontinui principles',
      },
    ],
    version: '0.1.0-beta',
  },
  'qontinui-api': {
    id: 'qontinui-api',
    name: 'Qontinui API',
    tagline: 'FastAPI backend service',
    description:
      'The robust FastAPI backend service powering Qontinui Web. Handles user authentication, project management, state persistence, and provides comprehensive REST API endpoints for all frontend operations with high performance and security.',
    technologies: [
      'FastAPI',
      'Python 3.12+',
      'SQLAlchemy',
      'PostgreSQL',
      'Redis',
      'Celery',
      'Pydantic',
      'JWT',
    ],
    features: [
      'REST API endpoints for all operations',
      'User authentication and authorization',
      'Project and state management',
      'Database operations with SQLAlchemy',
      'Caching with Redis',
      'Background task processing with Celery',
      'Admin API for system management',
      'WebSocket support for real-time updates',
      'API rate limiting',
      'Comprehensive API documentation',
      'Health monitoring endpoints',
    ],
    status: 'development',
    repository: 'https://github.com/jspinak/qontinui-web',
    keyComponents: ['API Endpoints', 'Database Models', 'Services', 'Auth System', 'Task Queue'],
    useCases: [
      'Backend for Qontinui Web',
      'Project data persistence',
      'User management',
      'Configuration storage',
      'Analytics and metrics collection',
      'Integration with external services',
    ],
    integrations: [
      {
        name: 'PostgreSQL',
        description: 'Primary database for storing projects, users, and configurations',
      },
      {
        name: 'Redis',
        description: 'Caching layer and session management',
      },
      {
        name: 'Celery',
        description: 'Background task processing for long-running operations',
      },
    ],
    version: '0.1.0-alpha',
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
      <CardHeader className="border-b">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <CardTitle className="text-2xl">{detail.name}</CardTitle>
              {detail.version && (
                <Badge variant="outline" className="text-xs">
                  v{detail.version}
                </Badge>
              )}
              <Badge variant="outline" className={getStatusColor(detail.status)}>
                {detail.status}
              </Badge>
            </div>
            <CardDescription className="text-base">{detail.tagline}</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="flex-shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <ScrollArea className="h-[calc(100vh-280px)]">
        <CardContent className="space-y-6 pt-6">
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
              Technologies & Stack
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
                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <Separator />

          {/* Use Cases */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Target className="h-4 w-4" />
              Use Cases
            </h3>
            <ul className="space-y-2">
              {detail.useCases.map((useCase, index) => (
                <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                  <ArrowRight className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <span>{useCase}</span>
                </li>
              ))}
            </ul>
          </div>

          <Separator />

          {/* Key Components */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Layers className="h-4 w-4" />
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

          {/* Integrations */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              Integrations
            </h3>
            <div className="space-y-3">
              {detail.integrations.map((integration, index) => (
                <div key={index} className="p-3 rounded-lg bg-muted/50 border border-border">
                  <div className="font-medium text-sm mb-1">{integration.name}</div>
                  <div className="text-xs text-muted-foreground">{integration.description}</div>
                </div>
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
                  <BookOpen className="h-4 w-4 mr-2" />
                  Documentation
                  <ExternalLink className="h-3 w-3 ml-auto" />
                </Button>
              )}
            </div>
          </div>

          {/* Project Info */}
          <div className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-lg p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Users className="h-4 w-4" />
              Project Information
            </h3>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Star className="h-3 w-3" />
                <span className="font-medium">License:</span> MIT (Open Source)
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-3 w-3" />
                <span className="font-medium">Maintainer:</span> Joshua Spinak
              </div>
              <div className="flex items-center gap-2">
                <Package className="h-3 w-3" />
                <span className="font-medium">Status:</span>{' '}
                <span className="capitalize">{detail.status}</span>
              </div>
              {detail.version && (
                <div className="flex items-center gap-2">
                  <GitBranch className="h-3 w-3" />
                  <span className="font-medium">Version:</span> {detail.version}
                </div>
              )}
            </div>
          </div>

          {/* Academic Foundation */}
          <div className="bg-accent/50 rounded-lg p-4 border border-border">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Academic Foundation
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Based on peer-reviewed research published in Springer&apos;s Software and Systems
              Modeling journal (October 2025), reducing GUI automation complexity from exponential
              to polynomial levels.
            </p>
          </div>
        </CardContent>
      </ScrollArea>
    </>
  )
}
