// Core domain types
export interface Process {
  id: string
  name: string
  description: string
  category?: string  // Category for organizing processes
  actions: Action[]
}

export interface Action {
  id: string
  type: "FIND" | "FIND_STATE_IMAGE" | "CLICK" | "TYPE" | "DRAG" | "SCROLL" | "VANISH" | "GO_TO_STATE" | "RUN_PROCESS"
  config: Record<string, any>
}

export interface StateRegion {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

export interface StateLocation {
  id: string
  name: string
  x: number
  y: number
}

export interface StateString {
  id: string
  name: string
  value: string
}

export interface State {
  id: string
  name: string
  description: string
  initial?: boolean
  identifyingImages: Array<{ image: string }>
  regions: StateRegion[]
  locations: StateLocation[]
  strings: StateString[]
  position: { x: number; y: number }
}

export type TransitionType = "OutgoingTransition" | "IncomingTransition"

export interface BaseTransition {
  id: string
  type: TransitionType
  process: string
  position?: { x: number; y: number }  // For transition node positioning
}

export interface OutgoingTransition extends BaseTransition {
  type: "OutgoingTransition"
  fromState: string
  activateStates: string[]
  staysVisible: boolean
  deactivateStates: string[]
}

export interface IncomingTransition extends BaseTransition {
  type: "IncomingTransition"
  toState: string
}

export type Transition = OutgoingTransition | IncomingTransition

export interface ImageUsage {
  type: "state" | "process"
  id: string
  name: string
}

export interface ImageAsset {
  id: string
  name: string
  url: string
  size: number
  uploadedAt: Date
  usageCount: number
  usage?: ImageUsage[]
}

// Context type
export interface AutomationContextType {
  // Project
  projectName: string
  setProjectName: (name: string) => void

  // Process management
  processes: Process[]
  addProcess: (process: Process) => void
  updateProcess: (process: Process) => void
  deleteProcess: (processId: string) => void

  // State management
  states: State[]
  addState: (state: State) => void
  updateState: (state: State) => void
  deleteState: (stateId: string) => void

  // Transition management
  transitions: Transition[]
  addTransition: (transition: Transition) => void
  updateTransition: (transition: Transition) => void
  deleteTransition: (transitionId: string) => void

  // Image management
  images: ImageAsset[]
  addImage: (image: ImageAsset) => void
  deleteImage: (imageId: string) => void
  updateImageUsage: (imageId: string, usage: ImageUsage) => void
  removeImageUsage: (imageId: string, usageId: string) => void

  // Auto-save
  lastSaved: string | null
  triggerSave: () => void

  // Category management
  categories: string[]
  addCategory: (category: string) => void
  deleteCategory: (category: string) => void

  // Configuration
  getConfiguration: () => any
  loadConfiguration: (config: any) => void
  clearAllData: () => void
}
