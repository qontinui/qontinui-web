/**
 * Shared types for action properties components.
 */

export interface Action {
  id: string
  type:
    // Pure mouse actions
    | "MOUSE_MOVE" | "MOUSE_DOWN" | "MOUSE_UP" | "MOUSE_SCROLL"
    // Pure keyboard actions
    | "KEY_DOWN" | "KEY_UP" | "KEY_PRESS"
    // Combined mouse actions
    | "CLICK" | "DOUBLE_CLICK" | "RIGHT_CLICK" | "DRAG" | "SCROLL"
    // Combined keyboard actions
    | "TYPE"
    // Other actions
    | "FIND" | "FIND_STATE_IMAGE" | "VANISH" | "GO_TO_STATE" | "RUN_PROCESS"
  config: Record<string, any>
}

export interface ActionPropertiesComponentProps {
  action: Action
  updateConfig: (key: string, value: any, additionalUpdates?: Record<string, any>) => void
  images: any[]
  states: any[]
  processes: any[]
  textAreaRef?: React.RefObject<HTMLTextAreaElement>
  shouldOpenImageSelector?: boolean
  onUpdateAction?: (action: Action) => void
}
