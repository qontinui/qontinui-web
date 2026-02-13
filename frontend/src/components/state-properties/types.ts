import type {
  State,
  StateRegion,
  StateLocation,
  StateString,
  StateImage,
  IncomingTransition,
  Transition,
} from "@/stores/automation";
import type { Workflow } from "@/lib/action-schema/action-types";

export interface StatePropertiesPanelProps {
  state: State;
  allStates: State[];
  images: Array<{ id: string; name: string; url: string }>;
  incomingTransitions: IncomingTransition[];
  workflows: Workflow[];
  updateState: (updates: Partial<State>) => void;
  addTransition: (transition: Transition) => Promise<boolean>;
  updateTransition: (transition: Transition) => void;
  deleteTransition: (transitionId: string) => void;
  addWorkflow: (workflow: Workflow) => void;
  addStateImage: () => void;
  updateStateImage: (index: number, updates: Partial<StateImage>) => void;
  removeStateImage: (index: number) => void;
  moveStateImage: (stateImageIndex: number, targetStateId: string) => void;
  addRegion: () => void;
  updateRegion: (
    index: number,
    field: keyof StateRegion,
    value: string | number | number[]
  ) => void;
  removeRegion: (index: number) => void;
  addLocation: () => void;
  updateLocation: (
    index: number,
    field: keyof StateLocation,
    value: string | number | number[]
  ) => void;
  removeLocation: (index: number) => void;
  addString: () => void;
  updateString: (
    index: number,
    field: keyof StateString,
    value: string | boolean | number[]
  ) => void;
  removeString: (index: number) => void;
}
