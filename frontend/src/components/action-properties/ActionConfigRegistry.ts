/**
 * Action configuration registry - maps action types to their property components.
 *
 * This registry enables dynamic component lookup and eliminates the need for
 * large switch statements in the main ActionProperties component.
 */

import { Action, ActionPropertiesComponentProps } from "./types";
import React from "react";

export type ActionPropertiesComponent = (
  props: ActionPropertiesComponentProps
) => React.ReactElement;

interface ActionConfig {
  component: ActionPropertiesComponent;
  displayName: string;
}

class ActionConfigRegistry {
  private registry: Map<Action["type"], ActionConfig> = new Map();

  /**
   * Register a component for a specific action type.
   */
  register(
    actionType: Action["type"],
    component: ActionPropertiesComponent,
    displayName: string
  ): void {
    this.registry.set(actionType, { component, displayName });
  }

  /**
   * Register a component for multiple action types.
   */
  registerMultiple(
    actionTypes: Action["type"][],
    component: ActionPropertiesComponent,
    displayName: string
  ): void {
    actionTypes.forEach((type) => {
      this.registry.set(type, { component, displayName });
    });
  }

  /**
   * Get the component for a given action type.
   */
  getComponent(actionType: Action["type"]): ActionPropertiesComponent | null {
    return this.registry.get(actionType)?.component || null;
  }

  /**
   * Get the display name for a given action type.
   */
  getDisplayName(actionType: Action["type"]): string {
    return this.registry.get(actionType)?.displayName || actionType;
  }

  /**
   * Check if an action type has a registered component.
   */
  hasComponent(actionType: Action["type"]): boolean {
    return this.registry.has(actionType);
  }

  /**
   * Get all registered action types.
   */
  getRegisteredTypes(): Action["type"][] {
    return Array.from(this.registry.keys());
  }
}

// Export singleton instance
export const actionConfigRegistry = new ActionConfigRegistry();
