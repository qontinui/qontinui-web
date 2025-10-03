import { State, Transition } from "./types"
import { StateIdManager } from "./state-id-manager"
import { TransitionReferenceUpdater } from "./transition-reference-updater"

/**
 * Result of a state update operation
 */
export interface StateUpdateResult {
  updatedState: State
  idChanged: boolean
  oldId?: string
  newId?: string
  affectedTransitions: Transition[]
}

/**
 * Coordinates complex state updates that may affect IDs and transitions.
 * Single Responsibility: Orchestrate multi-step state update operations
 */
export class StateUpdateCoordinator {
  /**
   * Prepare a state update, calculating ID changes and affected transitions
   */
  static prepareStateUpdate(
    currentState: State,
    updates: Partial<State>,
    allStates: State[],
    allTransitions: Transition[]
  ): StateUpdateResult {
    const updatedState = { ...currentState, ...updates }

    // Check if name change requires ID change
    if (updates.name && updates.name !== currentState.name) {
      const newId = StateIdManager.calculateNewId(currentState, updates.name, allStates)

      if (newId && newId !== currentState.id) {
        // ID needs to change
        const stateWithNewId = { ...updatedState, id: newId }
        const affectedTransitions = TransitionReferenceUpdater.getAffectedTransitions(
          allTransitions,
          currentState.id
        )

        return {
          updatedState: stateWithNewId,
          idChanged: true,
          oldId: currentState.id,
          newId: newId,
          affectedTransitions: affectedTransitions
        }
      }
    }

    // No ID change needed
    return {
      updatedState: updatedState,
      idChanged: false,
      affectedTransitions: []
    }
  }

  /**
   * Calculate updated transitions after a state ID change
   */
  static calculateUpdatedTransitions(
    transitions: Transition[],
    oldStateId: string,
    newStateId: string
  ): Transition[] {
    return TransitionReferenceUpdater.updateStateReferences(transitions, oldStateId, newStateId)
  }

  /**
   * Create a new state with a unique ID
   */
  static createNewState(
    desiredName: string,
    existingStates: State[],
    position: { x: number; y: number }
  ): State {
    const uniqueId = StateIdManager.generateUniqueName(desiredName, existingStates)

    return {
      id: uniqueId,
      name: desiredName,
      description: "",
      stateImages: [],
      regions: [],
      locations: [],
      strings: [],
      position: position,
    }
  }

  /**
   * Generate a default state with auto-generated name
   */
  static createDefaultState(
    existingStates: State[],
    position: { x: number; y: number }
  ): State {
    const defaultName = StateIdManager.generateDefaultName(existingStates)

    return {
      id: defaultName,
      name: defaultName.replace(/_/g, ' '),
      description: "",
      stateImages: [],
      regions: [],
      locations: [],
      strings: [],
      position: position,
    }
  }
}
