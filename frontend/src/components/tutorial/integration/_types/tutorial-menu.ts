import type { Tutorial } from "@/types/tutorial";

export interface TutorialMenuProps {
  tutorials: Tutorial[];
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  customFilter?: (tutorial: Tutorial) => boolean;
}

export type CompletionFilter =
  | "all"
  | "completed"
  | "in-progress"
  | "not-started";

export type TutorialStatus = "completed" | "in-progress" | "not-started";
