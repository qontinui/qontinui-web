import { State } from "./types";

/**
 * Manages state ID generation and validation.
 * Single Responsibility: Handle state identification logic
 */
export class StateIdManager {
  /**
   * Sanitize a state name to create a valid ID
   */
  static sanitizeName(name: string): string {
    return name
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "");
  }

  /**
   * Generate a default state name with a unique number suffix
   */
  static generateDefaultName(existingStates: State[]): string {
    let counter = 1;
    let name = `New_State_${counter}`;

    while (existingStates.some((s) => s.id === name)) {
      counter++;
      name = `New_State_${counter}`;
    }

    return name;
  }

  /**
   * Generate a unique state name based on a desired name
   */
  static generateUniqueName(
    desiredName: string,
    existingStates: State[]
  ): string {
    const sanitized = this.sanitizeName(desiredName);

    if (!existingStates.some((s) => s.id === sanitized)) {
      return sanitized;
    }

    let counter = 1;
    let uniqueName = `${sanitized}_${counter}`;

    while (existingStates.some((s) => s.id === uniqueName)) {
      counter++;
      uniqueName = `${sanitized}_${counter}`;
    }

    return uniqueName;
  }

  /**
   * Calculate what the new ID should be based on a name change
   * Returns null if the ID doesn't need to change
   */
  static calculateNewId(
    currentState: State,
    newName: string,
    existingStates: State[]
  ): string | null {
    const proposedId = this.sanitizeName(newName);

    // If the name hasn't really changed (just formatting), keep the ID
    if (proposedId === currentState.id) {
      return null;
    }

    // Check if the proposed ID conflicts with another state
    const conflictingState = existingStates.find((s) => s.id === proposedId);
    if (conflictingState && conflictingState.id !== currentState.id) {
      // There's a conflict, generate a unique ID
      return this.generateUniqueName(newName, existingStates);
    }

    return proposedId;
  }

  /**
   * Check if an ID change is needed when updating a state name
   */
  static needsIdChange(currentState: State, newName: string): boolean {
    const proposedId = this.sanitizeName(newName);
    return proposedId !== currentState.id;
  }
}
