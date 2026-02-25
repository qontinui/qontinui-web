import type { Transition, TransitionTemplate } from "./types";

export class TemplateManager {
  private templates: Map<string, TransitionTemplate> = new Map();

  constructor() {
    this.loadTemplates();
    this.initializeBuiltinTemplates();
  }

  createTransitionTemplate(
    name: string,
    config: TransitionTemplate["config"],
    options: {
      description?: string;
      category?: TransitionTemplate["category"];
      tags?: string[];
      icon?: string;
    } = {}
  ): TransitionTemplate {
    const template: TransitionTemplate = {
      id: `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      description: options.description || "",
      category: options.category || "custom",
      icon: options.icon,
      builtin: false,
      config,
      tags: options.tags || [],
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    this.templates.set(template.id, template);
    this.saveTemplates();
    return template;
  }

  getTemplate(id: string): TransitionTemplate | undefined {
    return this.templates.get(id);
  }

  getAllTemplates(): TransitionTemplate[] {
    return Array.from(this.templates.values());
  }

  getTemplatesByCategory(
    category: TransitionTemplate["category"]
  ): TransitionTemplate[] {
    return Array.from(this.templates.values()).filter(
      (t) => t.category === category
    );
  }

  createFromTemplate(
    templateId: string,
    fromStateId: string,
    toStateId?: string,
    customConfig?: Partial<TransitionTemplate["config"]>
  ): Transition | null {
    const template = this.templates.get(templateId);
    if (!template) {
      return null;
    }

    template.usageCount = (template.usageCount || 0) + 1;
    this.saveTemplates();

    const config = { ...template.config, ...customConfig };

    const transition: Transition = {
      id: `transition-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: config.type,
      workflows: config.workflows || [],
      timeout: config.timeout,
      retryCount: config.retryCount,
      ...(config.type === "OutgoingTransition"
        ? {
            fromState: fromStateId,
            toState: toStateId || "",
            staysVisible: config.staysVisible || false,
            activateStates: config.activateStates || [],
            deactivateStates: config.deactivateStates || [],
          }
        : {
            toState: toStateId || fromStateId,
          }),
    } as Transition;

    return transition;
  }

  deleteTemplate(id: string): boolean {
    const template = this.templates.get(id);
    if (!template || template.builtin) {
      return false;
    }
    this.templates.delete(id);
    this.saveTemplates();
    return true;
  }

  loadTemplates(): void {
    try {
      const json = localStorage.getItem("transition-templates");
      if (json) {
        const templates = JSON.parse(json) as TransitionTemplate[];
        templates.forEach((t) => this.templates.set(t.id, t));
      }
    } catch (error) {
      console.error("Failed to load transition templates:", error);
    }
  }

  saveTemplates(): void {
    try {
      const templates = Array.from(this.templates.values());
      localStorage.setItem("transition-templates", JSON.stringify(templates));
    } catch (error) {
      console.error("Failed to save transition templates:", error);
    }
  }

  private initializeBuiltinTemplates(): void {
    const hasBuiltins = Array.from(this.templates.values()).some(
      (t) => t.builtin
    );
    if (hasBuiltins) return;

    const builtins: TransitionTemplate[] = [
      {
        id: "builtin-click-button",
        name: "Click Button",
        description: "Standard button click transition with default timeout",
        category: "interaction",
        icon: "\uD83D\uDDB1\uFE0F",
        builtin: true,
        config: {
          type: "OutgoingTransition",
          workflows: [],
          timeout: 5000,
          retryCount: 3,
          staysVisible: false,
          activateStates: [],
          deactivateStates: [],
        },
        tags: ["click", "button", "interaction"],
        usageCount: 0,
        metadata: { created: new Date().toISOString() },
      },
      {
        id: "builtin-form-submit",
        name: "Form Submit",
        description: "Form submission with validation and longer timeout",
        category: "interaction",
        icon: "\uD83D\uDCDD",
        builtin: true,
        config: {
          type: "OutgoingTransition",
          workflows: [],
          timeout: 10000,
          retryCount: 2,
          staysVisible: false,
          activateStates: [],
          deactivateStates: [],
        },
        tags: ["form", "submit", "validation"],
        usageCount: 0,
        metadata: { created: new Date().toISOString() },
      },
      {
        id: "builtin-navigation",
        name: "Navigation",
        description: "Menu or link click navigation with page load timeout",
        category: "navigation",
        icon: "\uD83E\uDDED",
        builtin: true,
        config: {
          type: "OutgoingTransition",
          workflows: [],
          timeout: 15000,
          retryCount: 2,
          staysVisible: false,
          activateStates: [],
          deactivateStates: [],
        },
        tags: ["navigation", "menu", "link"],
        usageCount: 0,
        metadata: { created: new Date().toISOString() },
      },
      {
        id: "builtin-timeout-auto",
        name: "Timeout/Auto",
        description: "Automatic transition after delay with no interaction",
        category: "automation",
        icon: "\u23F1\uFE0F",
        builtin: true,
        config: {
          type: "OutgoingTransition",
          workflows: [],
          timeout: 3000,
          retryCount: 0,
          staysVisible: true,
          activateStates: [],
          deactivateStates: [],
        },
        tags: ["timeout", "automatic", "delay"],
        usageCount: 0,
        metadata: { created: new Date().toISOString() },
      },
      {
        id: "builtin-conditional",
        name: "Conditional",
        description: "IF-based transition with multiple possible outcomes",
        category: "conditional",
        icon: "\u2753",
        builtin: true,
        config: {
          type: "OutgoingTransition",
          workflows: [],
          timeout: 5000,
          retryCount: 1,
          staysVisible: true,
          activateStates: [],
          deactivateStates: [],
        },
        tags: ["conditional", "if", "branching"],
        usageCount: 0,
        metadata: { created: new Date().toISOString() },
      },
      {
        id: "builtin-error-handler",
        name: "Error Handler",
        description: "Error state transition with recovery workflow",
        category: "error-handling",
        icon: "\u26A0\uFE0F",
        builtin: true,
        config: {
          type: "OutgoingTransition",
          workflows: [],
          timeout: 10000,
          retryCount: 5,
          staysVisible: false,
          activateStates: [],
          deactivateStates: [],
        },
        tags: ["error", "recovery", "fallback"],
        usageCount: 0,
        metadata: { created: new Date().toISOString() },
      },
    ];

    builtins.forEach((t) => this.templates.set(t.id, t));
    this.saveTemplates();
  }
}
