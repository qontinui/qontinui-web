import type {
  UIBridgeJobStatus,
  UIBridgeRawResults,
  SuggestedTransition,
} from "@/hooks/useUIBridgeExploration";

export interface UIBridgeResultsViewProps {
  job: UIBridgeJobStatus;
  results?: UIBridgeRawResults | null;
  onAcceptTransition?: (transition: SuggestedTransition) => void;
  onAcceptAllTransitions?: (transitions: SuggestedTransition[]) => void;
}
