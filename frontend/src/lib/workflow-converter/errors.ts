/**
 * Error types for workflow conversion
 */

/**
 * Error thrown when a graph workflow cannot be linearized
 */
export class NonLinearWorkflowError extends Error {
  constructor(
    message: string,
    public readonly issues: string[]
  ) {
    super(message);
    this.name = 'NonLinearWorkflowError';
  }
}

/**
 * Error thrown when workflow validation fails
 */
export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}
