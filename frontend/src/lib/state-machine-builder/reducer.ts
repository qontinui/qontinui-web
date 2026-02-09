import type {
  BuilderState,
  BuilderAction,
  Snapshot,
  UIBridgeState,
} from "./types";

const MAX_UNDO_STACK = 50;

/** Initial builder state */
export function getInitialBuilderState(): BuilderState {
  return {
    states: [],
    transitions: [],
    fingerprintDetails: {},
    configName: "Untitled State Machine",
    configId: null,
    selectedStateId: null,
    selectedTransitionId: null,
    explorationJobId: null,
    discoveryResult: null,
    pendingStates: [],
    isDirty: false,
    undoStack: [],
    redoStack: [],
    mode: "discover",
  };
}

/** Create a snapshot for undo/redo */
function takeSnapshot(state: BuilderState): Snapshot {
  return {
    states: structuredClone(state.states),
    transitions: structuredClone(state.transitions),
  };
}

/** Push snapshot to undo stack, clear redo stack */
function pushUndo(state: BuilderState): BuilderState {
  const snapshot = takeSnapshot(state);
  const undoStack = [...state.undoStack, snapshot].slice(-MAX_UNDO_STACK);
  return { ...state, undoStack, redoStack: [], isDirty: true };
}

/** Convert a discovered state to an UIBridgeState */
function discoveredToAutomation(pending: UIBridgeState): UIBridgeState {
  return structuredClone(pending);
}

export function builderReducer(
  state: BuilderState,
  action: BuilderAction
): BuilderState {
  switch (action.type) {
    // =========================================================================
    // State-modifying actions (push to undo stack)
    // =========================================================================

    case "ADD_STATE": {
      const s = pushUndo(state);
      return {
        ...s,
        states: [...s.states, action.state],
      };
    }

    case "UPDATE_STATE": {
      const s = pushUndo(state);
      return {
        ...s,
        states: s.states.map((st) =>
          st.id === action.id ? { ...st, ...action.updates } : st
        ),
      };
    }

    case "DELETE_STATE": {
      const s = pushUndo(state);
      // Cascade delete transitions referencing this state
      return {
        ...s,
        states: s.states.filter((st) => st.id !== action.id),
        transitions: s.transitions.filter(
          (t) => t.from !== action.id && t.to !== action.id
        ),
        selectedStateId:
          s.selectedStateId === action.id ? null : s.selectedStateId,
        selectedTransitionId: s.transitions.some(
          (t) =>
            t.id === s.selectedTransitionId &&
            (t.from === action.id || t.to === action.id)
        )
          ? null
          : s.selectedTransitionId,
      };
    }

    case "ADD_TRANSITION": {
      const s = pushUndo(state);
      return {
        ...s,
        transitions: [...s.transitions, action.transition],
      };
    }

    case "UPDATE_TRANSITION": {
      const s = pushUndo(state);
      return {
        ...s,
        transitions: s.transitions.map((t) =>
          t.id === action.id ? { ...t, ...action.updates } : t
        ),
      };
    }

    case "DELETE_TRANSITION": {
      const s = pushUndo(state);
      return {
        ...s,
        transitions: s.transitions.filter((t) => t.id !== action.id),
        selectedTransitionId:
          s.selectedTransitionId === action.id ? null : s.selectedTransitionId,
      };
    }

    case "ACCEPT_DISCOVERED_STATE": {
      const pending = state.pendingStates.find(
        (ps) => ps.id === action.stateId
      );
      if (!pending) return state;

      const s = pushUndo(state);
      const newState = discoveredToAutomation(pending);

      // Also accept any discovered transitions involving this state
      // if both endpoints are now in the accepted states
      const acceptedIds = new Set(s.states.map((st) => st.id));
      acceptedIds.add(newState.id);

      const newTransitions =
        s.discoveryResult?.transitions
          .filter(
            (dt) =>
              (dt.fromStateId === newState.id &&
                acceptedIds.has(dt.toStateId)) ||
              (dt.toStateId === newState.id && acceptedIds.has(dt.fromStateId))
          )
          .filter(
            (dt) =>
              !s.transitions.some(
                (t) => t.from === dt.fromStateId && t.to === dt.toStateId
              )
          )
          .map((dt, i) => ({
            id: `transition-${Date.now()}-${i}`,
            from: dt.fromStateId,
            to: dt.toStateId,
            action: { type: dt.actionType },
            count: dt.count,
          })) ?? [];

      return {
        ...s,
        states: [...s.states, newState],
        transitions: [...s.transitions, ...newTransitions],
        pendingStates: s.pendingStates.filter((ps) => ps.id !== action.stateId),
      };
    }

    case "REJECT_DISCOVERED_STATE": {
      return {
        ...state,
        pendingStates: state.pendingStates.filter(
          (ps) => ps.id !== action.stateId
        ),
      };
    }

    case "ACCEPT_ALL": {
      if (state.pendingStates.length === 0) return state;

      const s = pushUndo(state);
      const newStates = s.pendingStates.map(discoveredToAutomation);
      const allIds = new Set([
        ...s.states.map((st) => st.id),
        ...newStates.map((st) => st.id),
      ]);

      const newTransitions =
        s.discoveryResult?.transitions
          .filter(
            (dt) => allIds.has(dt.fromStateId) && allIds.has(dt.toStateId)
          )
          .filter(
            (dt) =>
              !s.transitions.some(
                (t) => t.from === dt.fromStateId && t.to === dt.toStateId
              )
          )
          .map((dt, i) => ({
            id: `transition-${Date.now()}-${i}`,
            from: dt.fromStateId,
            to: dt.toStateId,
            action: { type: dt.actionType },
            count: dt.count,
          })) ?? [];

      return {
        ...s,
        states: [...s.states, ...newStates],
        transitions: [...s.transitions, ...newTransitions],
        pendingStates: [],
      };
    }

    case "LOAD_CONFIG": {
      return {
        ...getInitialBuilderState(),
        states: action.config.states,
        transitions: action.config.transitions,
        fingerprintDetails: action.config.fingerprintDetails ?? {},
        configName: action.config.name,
        mode: "edit",
      };
    }

    case "RESET": {
      return getInitialBuilderState();
    }

    case "UNDO": {
      if (state.undoStack.length === 0) return state;
      const snapshot = state.undoStack[state.undoStack.length - 1]!;
      const currentSnapshot = takeSnapshot(state);
      return {
        ...state,
        states: snapshot.states,
        transitions: snapshot.transitions,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, currentSnapshot],
        isDirty: true,
      };
    }

    case "REDO": {
      if (state.redoStack.length === 0) return state;
      const snapshot = state.redoStack[state.redoStack.length - 1]!;
      const currentSnapshot = takeSnapshot(state);
      return {
        ...state,
        states: snapshot.states,
        transitions: snapshot.transitions,
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, currentSnapshot],
        isDirty: true,
      };
    }

    // =========================================================================
    // Non-modifying actions
    // =========================================================================

    case "SELECT_STATE":
      return {
        ...state,
        selectedStateId: action.id,
        selectedTransitionId: action.id ? null : state.selectedTransitionId,
      };

    case "SELECT_TRANSITION":
      return {
        ...state,
        selectedTransitionId: action.id,
        selectedStateId: action.id ? null : state.selectedStateId,
      };

    case "SET_MODE":
      return { ...state, mode: action.mode };

    case "SET_EXPLORATION_JOB_ID":
      return { ...state, explorationJobId: action.jobId };

    case "SET_DISCOVERY_RESULT": {
      if (!action.result) {
        return {
          ...state,
          discoveryResult: null,
          pendingStates: [],
        };
      }

      // Convert discovered states to pending UIBridgeStates
      const pendingStates: UIBridgeState[] = action.result.states.map((ds) => ({
        id: ds.stateId,
        name: ds.name,
        fingerprints: ds.fingerprintHashes,
        isGlobal: ds.isGlobal,
        isModal: ds.isModal,
        positionZone: ds.positionZone,
        landmarkContext: ds.landmarkContext,
        confidence: ds.confidence,
        observationCount: ds.observationCount,
      }));

      return {
        ...state,
        discoveryResult: action.result,
        fingerprintDetails: {
          ...state.fingerprintDetails,
          ...action.result.fingerprintDetails,
        },
        pendingStates: pendingStates,
      };
    }

    case "SET_PENDING_STATES":
      return { ...state, pendingStates: action.states };

    case "SET_CONFIG_NAME":
      return { ...state, configName: action.name, isDirty: true };

    case "SET_CONFIG_ID":
      return { ...state, configId: action.configId };

    case "MARK_SAVED":
      return { ...state, isDirty: false };

    case "MERGE_DISCOVERY_RESULT": {
      // Add only states not already accepted into pendingStates
      const existingIds = new Set(state.states.map((s) => s.id));
      const existingPendingIds = new Set(state.pendingStates.map((s) => s.id));

      const newPending: UIBridgeState[] = action.result.states
        .filter(
          (ds) =>
            !existingIds.has(ds.stateId) && !existingPendingIds.has(ds.stateId)
        )
        .map((ds) => ({
          id: ds.stateId,
          name: ds.name,
          fingerprints: ds.fingerprintHashes,
          isGlobal: ds.isGlobal,
          isModal: ds.isModal,
          positionZone: ds.positionZone,
          landmarkContext: ds.landmarkContext,
          confidence: ds.confidence,
          observationCount: ds.observationCount,
        }));

      return {
        ...state,
        discoveryResult: action.result,
        fingerprintDetails: {
          ...state.fingerprintDetails,
          ...action.result.fingerprintDetails,
        },
        pendingStates: [...state.pendingStates, ...newPending],
      };
    }

    default:
      return state;
  }
}
