export interface SessionDividerSegment {
  type: "session-divider";
  content: string;
  sessionNumber: number;
}

export interface AiSegment {
  type: "ai";
  content: string;
  sessionNumber: number;
}

export interface UserSegment {
  type: "user";
  content: string;
  sessionNumber: number;
}

export interface FindingSegment {
  type: "finding";
  severity: string;
  category: string;
  title: string;
  sessionNumber: number;
}

export interface StepCompleteSegment {
  type: "step-complete";
  stepName: string;
  status: string;
  sessionNumber: number;
}

export interface TaskCompleteSegment {
  type: "task-complete";
  sessionNumber: number;
}

export interface OrchestratorSegment {
  type: "orchestrator";
  agent: "planning" | "verification" | "knowledge" | "orchestrator";
  content: string;
  sessionNumber: number;
}

export type ConversationSegment =
  | SessionDividerSegment
  | AiSegment
  | UserSegment
  | FindingSegment
  | StepCompleteSegment
  | TaskCompleteSegment
  | OrchestratorSegment;

export interface ConversationStats {
  sessionCount: number;
  messageCount: number;
  findingsCount: number;
  findingsBySeverity: Record<string, number>;
  stepsCompleted: number;
  taskComplete: boolean;
}
