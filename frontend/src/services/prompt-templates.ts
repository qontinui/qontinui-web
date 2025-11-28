/**
 * Prompt Templates - Pre-defined templates for workflow generation
 *
 * Provides example prompts and templates for common workflow patterns.
 */

import type { ActionType } from "../lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  template: string;
  examples: string[];
  parameters?: Array<{
    name: string;
    placeholder: string;
    required: boolean;
  }>;
  preferredActions?: ActionType[];
  tags?: string[];
}

// ============================================================================
// Templates
// ============================================================================

export const PROMPT_TEMPLATES: Record<string, PromptTemplate> = {
  // Web Scraping
  web_scraping: {
    id: "web_scraping",
    name: "Web Scraping",
    description: "Extract data from websites",
    category: "Data Extraction",
    template:
      "Create a workflow that scrapes {target} and extracts {data_points}",
    examples: [
      "product prices from Amazon",
      "article titles from news sites",
      "email addresses from company websites",
      "reviews from product pages",
    ],
    parameters: [
      { name: "target", placeholder: "website or page", required: true },
      { name: "data_points", placeholder: "what to extract", required: true },
    ],
    preferredActions: ["FIND", "CLICK", "SCROLL", "SCREENSHOT"],
    tags: ["scraping", "data", "extraction"],
  },

  // Browser Automation
  automation: {
    id: "automation",
    name: "Browser Automation",
    description: "Automate web interactions",
    category: "Automation",
    template: "Build a bot that {action} on {website}",
    examples: [
      "fills out forms automatically",
      "posts content to social media",
      "monitors price changes",
      "downloads files periodically",
    ],
    parameters: [
      { name: "action", placeholder: "what to do", required: true },
      { name: "website", placeholder: "which website", required: true },
    ],
    preferredActions: ["CLICK", "TYPE", "FIND", "WAIT"],
    tags: ["automation", "web", "bot"],
  },

  // Data Processing
  data_processing: {
    id: "data_processing",
    name: "Data Processing",
    description: "Process and transform data",
    category: "Data",
    template: "Process {data_source} by {operations}",
    examples: [
      "filtering invalid entries",
      "sorting by date",
      "aggregating totals",
      "removing duplicates",
    ],
    parameters: [
      {
        name: "data_source",
        placeholder: "where data comes from",
        required: true,
      },
      { name: "operations", placeholder: "what to do with it", required: true },
    ],
    preferredActions: ["FILTER", "SORT", "MAP", "REDUCE"],
    tags: ["data", "processing", "transformation"],
  },

  // Login Flow
  login: {
    id: "login",
    name: "Login Workflow",
    description: "Automated login to websites",
    category: "Authentication",
    template: "Create a login workflow for {website} using {method}",
    examples: [
      "username and password",
      "email and password with 2FA",
      "OAuth authentication",
      "social media login",
    ],
    parameters: [
      { name: "website", placeholder: "which website", required: true },
      { name: "method", placeholder: "authentication method", required: true },
    ],
    preferredActions: ["FIND", "CLICK", "TYPE", "WAIT"],
    tags: ["login", "authentication", "security"],
  },

  // Form Filling
  form_filling: {
    id: "form_filling",
    name: "Form Filling",
    description: "Automatically fill out forms",
    category: "Automation",
    template: "Fill out {form_type} with {data_source}",
    examples: [
      "contact forms with customer data",
      "registration forms with user info",
      "survey forms with responses",
      "application forms with saved data",
    ],
    parameters: [
      { name: "form_type", placeholder: "type of form", required: true },
      {
        name: "data_source",
        placeholder: "where data comes from",
        required: true,
      },
    ],
    preferredActions: ["FIND", "CLICK", "TYPE", "SCROLL"],
    tags: ["forms", "automation", "data entry"],
  },

  // Testing
  testing: {
    id: "testing",
    name: "UI Testing",
    description: "Test user interfaces automatically",
    category: "Testing",
    template: "Test {feature} by {test_steps}",
    examples: [
      "login functionality with valid and invalid credentials",
      "checkout flow with multiple payment methods",
      "search feature with various queries",
      "responsive design on different screen sizes",
    ],
    parameters: [
      { name: "feature", placeholder: "what to test", required: true },
      { name: "test_steps", placeholder: "how to test it", required: true },
    ],
    preferredActions: ["FIND", "CLICK", "TYPE", "EXISTS", "SCREENSHOT"],
    tags: ["testing", "qa", "validation"],
  },

  // Monitoring
  monitoring: {
    id: "monitoring",
    name: "Website Monitoring",
    description: "Monitor websites for changes",
    category: "Monitoring",
    template: "Monitor {target} for {change_type} every {frequency}",
    examples: [
      "product availability",
      "price changes",
      "content updates",
      "error messages",
    ],
    parameters: [
      { name: "target", placeholder: "what to monitor", required: true },
      {
        name: "change_type",
        placeholder: "what changes to look for",
        required: true,
      },
      { name: "frequency", placeholder: "how often", required: true },
    ],
    preferredActions: ["FIND", "EXISTS", "VANISH", "SCREENSHOT", "WAIT"],
    tags: ["monitoring", "alerts", "tracking"],
  },

  // Screenshot Capture
  screenshot: {
    id: "screenshot",
    name: "Screenshot Capture",
    description: "Capture screenshots automatically",
    category: "Documentation",
    template: "Take screenshots of {target} when {condition}",
    examples: [
      "error messages",
      "page content at specific times",
      "changes detected",
      "completed tasks",
    ],
    parameters: [
      { name: "target", placeholder: "what to capture", required: true },
      { name: "condition", placeholder: "when to capture", required: true },
    ],
    preferredActions: ["SCREENSHOT", "FIND", "WAIT"],
    tags: ["screenshots", "documentation", "capture"],
  },

  // Data Entry
  data_entry: {
    id: "data_entry",
    name: "Data Entry",
    description: "Enter data into systems",
    category: "Automation",
    template: "Enter {data_type} from {source} into {destination}",
    examples: [
      "customer records from spreadsheet into CRM",
      "invoice data from PDFs into accounting software",
      "inventory data from emails into database",
      "order details from website into ERP",
    ],
    parameters: [
      { name: "data_type", placeholder: "type of data", required: true },
      { name: "source", placeholder: "where data comes from", required: true },
      { name: "destination", placeholder: "where to enter it", required: true },
    ],
    preferredActions: ["FIND", "CLICK", "TYPE", "GET_VARIABLE"],
    tags: ["data entry", "automation", "migration"],
  },

  // Batch Processing
  batch_processing: {
    id: "batch_processing",
    name: "Batch Processing",
    description: "Process multiple items automatically",
    category: "Automation",
    template: "Process {items} by {operation} for each one",
    examples: [
      "downloading files from a list",
      "updating records one by one",
      "generating reports for multiple accounts",
      "converting files in bulk",
    ],
    parameters: [
      { name: "items", placeholder: "what to process", required: true },
      {
        name: "operation",
        placeholder: "what to do with each",
        required: true,
      },
    ],
    preferredActions: ["LOOP", "FIND", "CLICK", "GET_VARIABLE"],
    tags: ["batch", "bulk", "processing"],
  },

  // Conditional Logic
  conditional: {
    id: "conditional",
    name: "Conditional Workflow",
    description: "Execute actions based on conditions",
    category: "Control Flow",
    template: "If {condition} then {action_true} else {action_false}",
    examples: [
      "element exists, click it, otherwise wait",
      "price is below threshold, buy, otherwise monitor",
      "form is valid, submit, otherwise show errors",
      "user is logged in, proceed, otherwise login",
    ],
    parameters: [
      { name: "condition", placeholder: "condition to check", required: true },
      { name: "action_true", placeholder: "if true", required: true },
      { name: "action_false", placeholder: "if false", required: false },
    ],
    preferredActions: ["IF", "EXISTS", "FIND"],
    tags: ["conditional", "logic", "control flow"],
  },

  // Error Handling
  error_handling: {
    id: "error_handling",
    name: "Error Handling",
    description: "Handle errors gracefully",
    category: "Reliability",
    template: "Try {main_action} and if it fails {fallback_action}",
    examples: [
      "clicking button, retry 3 times",
      "finding element, use alternative selector",
      "submitting form, capture error screenshot",
      "downloading file, notify on failure",
    ],
    parameters: [
      { name: "main_action", placeholder: "primary action", required: true },
      {
        name: "fallback_action",
        placeholder: "what to do on error",
        required: true,
      },
    ],
    preferredActions: ["TRY_CATCH", "WAIT", "SCREENSHOT"],
    tags: ["error", "reliability", "fallback"],
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: string): PromptTemplate[] {
  return Object.values(PROMPT_TEMPLATES).filter((t) => t.category === category);
}

/**
 * Get all categories
 */
export function getTemplateCategories(): string[] {
  return [...new Set(Object.values(PROMPT_TEMPLATES).map((t) => t.category))];
}

/**
 * Search templates
 */
export function searchTemplates(query: string): PromptTemplate[] {
  const lowerQuery = query.toLowerCase();
  return Object.values(PROMPT_TEMPLATES).filter(
    (t) =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery) ||
      t.tags?.some((tag) => tag.includes(lowerQuery))
  );
}

/**
 * Fill template with parameters
 */
export function fillTemplate(
  template: PromptTemplate,
  params: Record<string, string>
): string {
  let filled = template.template;

  for (const [key, value] of Object.entries(params)) {
    filled = filled.replace(`{${key}}`, value);
  }

  return filled;
}

/**
 * Get example prompts for a template
 */
export function getExamplePrompts(template: PromptTemplate): string[] {
  return template.examples.map((example) => {
    const params =
      template.parameters?.reduce(
        (acc, param) => {
          acc[param.name] = example;
          return acc;
        },
        {} as Record<string, string>
      ) || {};

    return fillTemplate(template, params);
  });
}
