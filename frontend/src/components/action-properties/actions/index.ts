/**
 * Action property components export and registration.
 */

import { actionConfigRegistry } from "../ActionConfigRegistry"

// Import all action property components
export { FindActionProperties } from "./FindActionProperties"
export { FindStateImageProperties } from "./FindStateImageProperties"
export { ClickActionProperties } from "./ClickActionProperties"
export { MouseMoveProperties, MouseButtonProperties, SimpleClickProperties } from "./MouseActionProperties"
export { KeyboardActionProperties } from "./KeyboardActionProperties"
export { DragActionProperties } from "./DragActionProperties"
export { TypeActionProperties } from "./TypeActionProperties"
export { ScrollActionProperties } from "./ScrollActionProperties"
export { VanishActionProperties } from "./VanishActionProperties"
export { GoToStateActionProperties } from "./GoToStateActionProperties"
export { RunProcessActionProperties } from "./RunProcessActionProperties"

// Register components with the registry
import { FindActionProperties } from "./FindActionProperties"
import { FindStateImageProperties } from "./FindStateImageProperties"
import { ClickActionProperties } from "./ClickActionProperties"
import { MouseMoveProperties, MouseButtonProperties, SimpleClickProperties } from "./MouseActionProperties"
import { KeyboardActionProperties } from "./KeyboardActionProperties"
import { DragActionProperties } from "./DragActionProperties"
import { TypeActionProperties } from "./TypeActionProperties"
import { ScrollActionProperties } from "./ScrollActionProperties"
import { VanishActionProperties } from "./VanishActionProperties"
import { GoToStateActionProperties } from "./GoToStateActionProperties"
import { RunProcessActionProperties } from "./RunProcessActionProperties"

// Register all action types with their components
actionConfigRegistry.register("FIND", FindActionProperties, "FIND")
actionConfigRegistry.register("FIND_STATE_IMAGE", FindStateImageProperties, "FIND_STATE_IMAGE")
actionConfigRegistry.register("CLICK", ClickActionProperties, "CLICK")
actionConfigRegistry.register("MOUSE_MOVE", MouseMoveProperties, "MOUSE_MOVE")
actionConfigRegistry.registerMultiple(["MOUSE_DOWN", "MOUSE_UP"], MouseButtonProperties, "MOUSE_DOWN/MOUSE_UP")
actionConfigRegistry.registerMultiple(["DOUBLE_CLICK", "RIGHT_CLICK"], SimpleClickProperties, "DOUBLE_CLICK/RIGHT_CLICK")
actionConfigRegistry.registerMultiple(["KEY_PRESS", "KEY_DOWN", "KEY_UP"], KeyboardActionProperties, "KEY_PRESS/KEY_DOWN/KEY_UP")
actionConfigRegistry.register("DRAG", DragActionProperties, "DRAG")
actionConfigRegistry.register("TYPE", TypeActionProperties, "TYPE")
actionConfigRegistry.register("SCROLL", ScrollActionProperties, "SCROLL")
actionConfigRegistry.register("VANISH", VanishActionProperties, "VANISH")
actionConfigRegistry.register("GO_TO_STATE", GoToStateActionProperties, "GO_TO_STATE")
actionConfigRegistry.register("RUN_PROCESS", RunProcessActionProperties, "RUN_PROCESS")
