/**
 * Template Manager
 *
 * Handles template CRUD operations and application of templates
 * to create new states. Includes built-in template initialization.
 */

import type {
  State,
  StateImage,
  StateRegion,
  StateLocation,
  StateString,
  SearchRegion,
} from "@/contexts/automation-context/types";

import type {
  StateTemplate,
  StateTemplateConfig,
  RegionTemplate,
  LocationTemplate,
  StringTemplate,
  TemplateOperationResult,
  StateOperationResult,
  StateMetadata,
} from "@/types/state-organization/types";

import type { ServiceState, PersistenceCallbacks } from "./types";

export class TemplateManager {
  constructor(
    private state: ServiceState,
    private persistence: PersistenceCallbacks
  ) {}

  /**
   * Create a new state template
   */
  createStateTemplate(
    name: string,
    config: StateTemplateConfig
  ): TemplateOperationResult {
    try {
      if (!name || !name.trim()) {
        return { success: false, error: "Template name cannot be empty" };
      }

      const template: StateTemplate = {
        id: this.generateId("template"),
        name: name.trim(),
        description: config.defaultDescription || "",
        category: "custom",
        config,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.state.templates.set(template.id, template);
      this.persistence.save();

      return { success: true, template };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create template: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get a template by ID
   */
  getStateTemplate(id: string): TemplateOperationResult {
    const template = this.state.templates.get(id);
    if (!template) {
      return { success: false, error: `Template not found: ${id}` };
    }
    return { success: true, template: { ...template } };
  }

  /**
   * Get all templates
   */
  getAllStateTemplates(): StateTemplate[] {
    return Array.from(this.state.templates.values()).map((t) => ({ ...t }));
  }

  /**
   * Create a new state from template
   */
  createStateFromTemplate(
    templateId: string,
    name: string
  ): StateOperationResult {
    try {
      const templateResult = this.getStateTemplate(templateId);
      if (!templateResult.success || !templateResult.template) {
        return { success: false, error: templateResult.error };
      }

      const template = templateResult.template;
      const config = template.config;

      // Create state from template
      const state: State = {
        id: this.generateId("state"),
        name: name.trim(),
        description: config.defaultDescription,
        initial: false,
        stateImages: config.stateImages.map((img) =>
          this.createStateImageFromTemplate(img)
        ),
        regions: config.regions.map((region) =>
          this.createRegionFromTemplate(region)
        ),
        locations: config.locations.map((loc) =>
          this.createLocationFromTemplate(loc)
        ),
        strings: config.strings.map((str) =>
          this.createStringFromTemplate(str)
        ),
        position: { x: 0, y: 0 },
      };

      // Initialize metadata
      const metadata: StateMetadata = {
        tags: [`template:${template.name}`],
        createdAt: new Date().toISOString(),
        notes: `Created from template: ${template.name}`,
      };
      this.state.metadata.set(state.id, metadata);
      this.persistence.save();

      return { success: true, state };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create state from template: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Initialize built-in templates
   */
  initializeBuiltInTemplates(): void {
    const builtInTemplates: Array<{
      name: string;
      config: StateTemplateConfig;
    }> = [
      {
        name: "Login Page",
        config: {
          defaultDescription:
            "Login page with username, password, and submit button",
          stateImages: [
            {
              name: "Username Field",
              placeholder: true,
              patterns: 1,
              shared: false,
            },
            {
              name: "Password Field",
              placeholder: true,
              patterns: 1,
              shared: false,
            },
            {
              name: "Login Button",
              placeholder: true,
              patterns: 2, // normal + hover
              shared: false,
            },
          ],
          regions: [
            {
              name: "Form Area",
              x: 0,
              y: 0,
              width: 400,
              height: 300,
              isSearchRegion: true,
            },
          ],
          locations: [
            {
              name: "Username Click",
              x: 200,
              y: 100,
              fixed: false,
              anchor: false,
            },
            {
              name: "Password Click",
              x: 200,
              y: 150,
              fixed: false,
              anchor: false,
            },
            {
              name: "Submit Click",
              x: 200,
              y: 200,
              fixed: false,
              anchor: false,
            },
          ],
          strings: [
            { name: "Username", value: "", inputText: true },
            { name: "Password", value: "", inputText: true },
          ],
        },
      },
      {
        name: "Navigation Menu",
        config: {
          defaultDescription: "Standard navigation menu with multiple items",
          stateImages: [
            { name: "Menu Icon", placeholder: true, patterns: 2, shared: true },
            {
              name: "Menu Item 1",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
            {
              name: "Menu Item 2",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
            {
              name: "Menu Item 3",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
          ],
          regions: [
            {
              name: "Menu Bar",
              x: 0,
              y: 0,
              width: 200,
              height: 400,
              isSearchRegion: true,
            },
          ],
          locations: [
            { name: "Menu Toggle", x: 20, y: 20, fixed: true, anchor: true },
          ],
          strings: [],
        },
      },
      {
        name: "Form Page",
        config: {
          defaultDescription:
            "Form with multiple input fields and submit button",
          stateImages: [
            { name: "Field 1", placeholder: true, patterns: 1, shared: false },
            { name: "Field 2", placeholder: true, patterns: 1, shared: false },
            { name: "Field 3", placeholder: true, patterns: 1, shared: false },
            {
              name: "Submit Button",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
            {
              name: "Cancel Button",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
          ],
          regions: [
            {
              name: "Form Container",
              x: 0,
              y: 0,
              width: 500,
              height: 400,
              isSearchRegion: true,
            },
          ],
          locations: [
            {
              name: "Field 1 Click",
              x: 250,
              y: 100,
              fixed: false,
              anchor: false,
            },
            {
              name: "Field 2 Click",
              x: 250,
              y: 150,
              fixed: false,
              anchor: false,
            },
            {
              name: "Field 3 Click",
              x: 250,
              y: 200,
              fixed: false,
              anchor: false,
            },
            {
              name: "Submit Click",
              x: 200,
              y: 300,
              fixed: false,
              anchor: false,
            },
            {
              name: "Cancel Click",
              x: 300,
              y: 300,
              fixed: false,
              anchor: false,
            },
          ],
          strings: [],
        },
      },
      {
        name: "Dialog/Modal",
        config: {
          defaultDescription:
            "Modal dialog with title, content, and action buttons",
          stateImages: [
            {
              name: "Dialog Background",
              placeholder: true,
              patterns: 1,
              shared: false,
            },
            {
              name: "Close Button",
              placeholder: true,
              patterns: 2,
              shared: true,
            },
            {
              name: "OK Button",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
            {
              name: "Cancel Button",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
          ],
          regions: [
            {
              name: "Dialog Area",
              x: 0,
              y: 0,
              width: 400,
              height: 250,
              isSearchRegion: true,
            },
            {
              name: "Title Bar",
              x: 0,
              y: 0,
              width: 400,
              height: 50,
              isSearchRegion: false,
            },
          ],
          locations: [
            { name: "Close X", x: 380, y: 10, fixed: false, anchor: false },
            { name: "OK Click", x: 250, y: 220, fixed: false, anchor: false },
            {
              name: "Cancel Click",
              x: 150,
              y: 220,
              fixed: false,
              anchor: false,
            },
          ],
          strings: [{ name: "Dialog Title", value: "", expectedText: true }],
        },
      },
      {
        name: "Error Page",
        config: {
          defaultDescription: "Error state with message and retry/back options",
          stateImages: [
            {
              name: "Error Icon",
              placeholder: true,
              patterns: 1,
              shared: true,
            },
            {
              name: "Retry Button",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
            {
              name: "Back Button",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
          ],
          regions: [
            {
              name: "Error Container",
              x: 0,
              y: 0,
              width: 500,
              height: 300,
              isSearchRegion: true,
            },
          ],
          locations: [
            {
              name: "Retry Click",
              x: 250,
              y: 220,
              fixed: false,
              anchor: false,
            },
            { name: "Back Click", x: 250, y: 260, fixed: false, anchor: false },
          ],
          strings: [{ name: "Error Message", value: "", expectedText: true }],
        },
      },
    ];

    for (const { name, config } of builtInTemplates) {
      const template: StateTemplate = {
        id: this.generateId("template"),
        name,
        description: config.defaultDescription,
        category: "built-in",
        icon: this.getTemplateIcon(name),
        config,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.state.templates.set(template.id, template);
    }
  }

  /**
   * Get icon for template
   */
  private getTemplateIcon(templateName: string): string {
    const iconMap: Record<string, string> = {
      "Login Page": "lock",
      "Navigation Menu": "menu",
      "Form Page": "document",
      "Dialog/Modal": "window",
      "Error Page": "exclamation",
    };
    return iconMap[templateName] || "template";
  }

  /**
   * Create StateImage from template
   */
  private createStateImageFromTemplate(template: {
    name: string;
    patterns: number;
    shared: boolean;
    searchRegions?: unknown[];
  }): StateImage {
    return {
      id: this.generateId("image"),
      name: template.name,
      patterns: Array.from({ length: template.patterns }, (_, i) => ({
        id: this.generateId("pattern"),
        name: `Pattern ${i + 1}`,
        searchRegions: [],
        fixed: false,
      })),
      shared: template.shared,
      searchRegions:
        (template.searchRegions?.map((sr: unknown) => ({
          id: this.generateId("searchregion"),
          ...(sr as object),
        })) as SearchRegion[]) || [],
    };
  }

  /**
   * Create StateRegion from template
   */
  private createRegionFromTemplate(template: RegionTemplate): StateRegion {
    return {
      id: this.generateId("region"),
      ...template,
    };
  }

  /**
   * Create StateLocation from template
   */
  private createLocationFromTemplate(
    template: LocationTemplate
  ): StateLocation {
    return {
      id: this.generateId("location"),
      ...template,
    };
  }

  /**
   * Create StateString from template
   */
  private createStringFromTemplate(template: StringTemplate): StateString {
    return {
      id: this.generateId("string"),
      ...template,
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
