// Import ActionSnapshot type
import { ActionSnapshot } from '../../lib/integration-testing-framework';

// ActionHistory type for state objects
export interface ActionHistory {
  snapshots: ActionSnapshot[];
  lastUpdated?: Date;
}

// Core domain types
export interface Process {
  id: string
  name: string
  description: string
  category?: string  // Category for organizing processes
  actions: Action[]
  // Integration test configuration
  initialScreenshotId?: string  // Screenshot to start the test with
  initialStateIds?: string[]    // States that should be active at start
  projectName?: string
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

  // Relative positioning (similar to StateLocation)
  referenceImageId?: string   // ID of StateImage for relative positioning
  position?: Position         // Position within referenced image region
  offsetX?: number            // X offset in pixels (default 0)
  offsetY?: number            // Y offset in pixels (default 0)

  // SearchRegion flag
  isSearchRegion?: boolean    // If true, this region can be used as a search region for StateImages

  actionHistory?: ActionHistory
}

// Position names for relative positioning (matches qontinui PositionName enum)
export type PositionName =
  | "TOPLEFT"
  | "TOPMIDDLE"
  | "TOPRIGHT"
  | "MIDDLELEFT"
  | "MIDDLEMIDDLE"
  | "MIDDLERIGHT"
  | "BOTTOMLEFT"
  | "BOTTOMMIDDLE"
  | "BOTTOMRIGHT"

// Position within a region using percentages (0.0-1.0)
export interface Position {
  percentW: number  // 0.0 = left, 1.0 = right, 0.5 = center
  percentH: number  // 0.0 = top, 1.0 = bottom, 0.5 = center
  positionName?: PositionName  // Optional named position
}

export interface StateLocation {
  id: string
  name: string
  x: number
  y: number

  // StateLocation specific properties (from qontinui)
  fixed: boolean              // If true, location uses absolute coordinates
  anchor: boolean             // If true, used as anchor point

  // Optional offset values
  offsetX?: number            // X offset in pixels (default 0)
  offsetY?: number            // Y offset in pixels (default 0)

  // For relative positioning
  referenceImageId?: string   // ID of StateImage for relative positioning
  position?: Position         // Position within referenced image region

  // Metadata and history
  metadata?: Record<string, any>
  actionHistory?: ActionHistory
}

export interface StateString {
  id: string
  name: string
  value: string
  // Type flags - define how the string is used
  identifier?: boolean      // OCR verification flag
  inputText?: boolean      // To be typed (DEFAULT: true)
  expectedText?: boolean   // Validation/expected text flag
  regexPattern?: boolean   // Regex pattern flag
}

export interface SearchRegion {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

// Pattern represents a single image variation with its search configuration
export interface Pattern {
  id: string
  name?: string
  image: string // Base64 data URL with transparency (PNG format)
  mask?: string // Optional separate mask image (base64)
  searchRegions: SearchRegion[] // Where to search for this pattern
  fixed: boolean // If true, pattern position is fixed on screen
  similarity?: number // Similarity threshold (0.0-1.0)
  targetPosition?: Position // Click position within pattern (default: center 0.5, 0.5)
  offsetX?: number // Pixel offset for click position
  offsetY?: number // Pixel offset for click position
}

export interface StateImage {
  id: string
  name: string
  patterns: Pattern[] // Multiple patterns for visual variations (e.g., normal, hover, clicked)
  shared: boolean // If true, found in other states too
  actionHistory?: ActionHistory
  source?: 'upload' | 'pattern-optimization' // Track how the image was created
  probability?: number // Mock testing: probability image appears (0.0-1.0)
  searchRegions?: SearchRegion[] // StateImage-level search regions (precedence level 3)
}

export interface State {
  id: string
  name: string
  description: string
  initial?: boolean
  stateImages: StateImage[]
  regions: StateRegion[]
  locations: StateLocation[]
  strings: StateString[]
  position: { x: number; y: number }
  projectName?: string
}

export type TransitionType = "OutgoingTransition" | "IncomingTransition"

export interface BaseTransition {
  id: string
  type: TransitionType
  process: string
  position?: { x: number; y: number }  // For transition node positioning
  projectName?: string
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
  createdAt: Date
  usageCount: number
  usage?: ImageUsage[]
  projectName?: string
  source: 'uploaded' | 'pattern_optimization' | 'image_extraction' | 'state_discovery'
}

// Screenshot annotation types (simplified from full Screenshot types)
export interface ScreenshotRegionAnnotation {
  id: string
  screenshotId: string
  stateId: string
  name: string
  type: 'StateRegion' | 'SearchRegion'
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  linkedStateObjectId?: string
  linkedStateObjectType?: 'StateImage'
  referenceStateId?: string
  saveToStateImageId?: string
  saveToStateImageStateId?: string
}

export interface ScreenshotLocationAnnotation {
  id: string
  screenshotId: string
  stateId: string
  name: string
  x: number
  y: number
  anchor?: boolean
  anchorType?: string
  fixed?: boolean
  referenceImageId?: string
  referenceStateId?: string
  offsetX?: number
  offsetY?: number
  percentW?: number
  percentH?: number
}

export interface Screenshot {
  id: string
  name: string
  url: string
  size: number
  uploadedAt: Date
  description?: string
  tags?: string[]
  projectName?: string
  // Annotations created in Create Regions & Locations tab
  regions?: ScreenshotRegionAnnotation[]
  locations?: ScreenshotLocationAnnotation[]
  associatedStates?: string[]
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
  updateStateWithIdChange: (oldId: string, newState: State) => void
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
  updateImage: (image: ImageAsset) => void
  updateImageUsage: (imageId: string, usage: ImageUsage) => void
  removeImageUsage: (imageId: string, usageId: string) => void
  getImageUsage: (imageId: string) => { states: Array<{ id: string; name: string }>; processes: Array<{ id: string; name: string; actionCount: number }> }
  removeImageFromStates: (imageUrl: string) => Promise<number>
  markImageAsRemovedInProcesses: (imageId: string, imageName: string) => Promise<number>

  // Screenshot management
  screenshots: Screenshot[]
  addScreenshot: (screenshot: Screenshot) => void
  updateScreenshot: (screenshot: Screenshot) => void
  deleteScreenshot: (screenshotId: string) => void

  // ActionHistory management
  updateStateImageActionHistory: (stateId: string, imageId: string, actionHistory: ActionHistory) => void
  updateStateLocationActionHistory: (stateId: string, locationId: string, actionHistory: ActionHistory) => void
  updateStateRegionActionHistory: (stateId: string, regionId: string, actionHistory: ActionHistory) => void

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
