import { State } from "./types"

export class StateManager {
  static addState(states: State[], newState: State): State[] {
    return [...states, newState]
  }

  static updateState(states: State[], updatedState: State): State[] {
    return states.map((s) => (s.id === updatedState.id ? updatedState : s))
  }

  static updateStateWithIdChange(states: State[], oldId: string, updatedState: State): State[] {
    return states.map((s) => (s.id === oldId ? updatedState : s))
  }

  static deleteState(states: State[], stateId: string): State[] {
    return states.filter((s) => s.id !== stateId)
  }
}
