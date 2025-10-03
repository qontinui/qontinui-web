/**
 * Utility functions for managing state names as identifiers
 * Aligns with qontinui library's approach of using state names
 */

import { State } from '@/contexts/automation-context/types';

/**
 * Sanitize a state name to be used as an ID
 * - Replace spaces with underscores
 * - Remove special characters except underscores and hyphens
 * - Ensure it starts with a letter
 */
export function sanitizeStateName(name: string): string {
  // Replace spaces with underscores
  let sanitized = name.replace(/\s+/g, '_');

  // Remove special characters except letters, numbers, underscores, and hyphens
  sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '');

  // Ensure it starts with a letter (prefix with 'state_' if it doesn't)
  if (!/^[a-zA-Z]/.test(sanitized)) {
    sanitized = 'state_' + sanitized;
  }

  // Default to 'state' if empty
  if (!sanitized) {
    sanitized = 'state';
  }

  return sanitized;
}

/**
 * Generate a unique state name/ID based on the desired name
 * Appends a number if the name already exists
 */
export function generateUniqueStateName(
  desiredName: string,
  existingStates: State[]
): string {
  const baseName = sanitizeStateName(desiredName);

  // Check if the base name is already unique
  if (!existingStates.find(s => s.id === baseName)) {
    return baseName;
  }

  // Find the next available number suffix
  let counter = 1;
  let uniqueName = `${baseName}_${counter}`;

  while (existingStates.find(s => s.id === uniqueName)) {
    counter++;
    uniqueName = `${baseName}_${counter}`;
  }

  return uniqueName;
}

/**
 * Generate a default state name based on existing states
 */
export function generateDefaultStateName(existingStates: State[]): string {
  return generateUniqueStateName('New_State', existingStates);
}

/**
 * Update state ID when name changes
 * Returns the new ID or null if the name would create a duplicate
 */
export function updateStateIdFromName(
  currentState: State,
  newName: string,
  existingStates: State[]
): string | null {
  const sanitizedName = sanitizeStateName(newName);

  // Check if another state already has this ID (excluding current state)
  const duplicate = existingStates.find(
    s => s.id === sanitizedName && s.id !== currentState.id
  );

  if (duplicate) {
    // Try to generate a unique variant
    const uniqueName = generateUniqueStateName(newName,
      existingStates.filter(s => s.id !== currentState.id)
    );
    return uniqueName;
  }

  return sanitizedName;
}


/**
 * Validate that a state name can be used as an ID
 */
export function isValidStateName(name: string): boolean {
  if (!name || name.trim().length === 0) {
    return false;
  }

  // After sanitization, should have at least one character
  const sanitized = sanitizeStateName(name);
  return sanitized.length > 0;
}
