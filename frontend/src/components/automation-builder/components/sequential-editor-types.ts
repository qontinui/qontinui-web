/**
 * SequentialEditor - Shared Type Definitions
 *
 * Types used across the SequentialEditor and its sub-components.
 */

export interface StateType {
  id: string;
  name: string;
  stateImages?: Array<{ id: string; name: string }>;
  strings?: Array<{ id: string; value: string; name?: string }>;
}

export interface WorkflowType {
  id: string;
  name: string;
}

export interface ImageType {
  id: string;
  name: string;
}

export interface ActionTemplate {
  readonly type: string;
  readonly label: string;
  readonly color: string;
  readonly preset?: string;
}
