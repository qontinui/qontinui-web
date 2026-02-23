/**
 * page-sweep-generator.ts
 *
 * Pure logic for generating workflows from a Page Sweep config.
 * Builds per-page prompts and orchestrates calling generateWorkflowAsync
 * for each selected page, then creates a WorkflowSequence.
 */

import type { LocalStorageItem } from "@/hooks/useLocalStorageCrud";
import type { BuilderItem } from "@/components/builders/BuilderLayout";
import type { DiscoveredSpec, SpecGroup } from "@/lib/spec-prompt-builder";

// =============================================================================
// Data Model
// =============================================================================

export interface AssertionEntry {
  id: string;
  description: string;
  category: string;
  severity: "critical" | "warning" | "info";
  enabled: boolean;
}

export interface SpecGroupEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  assertion_count: number;
  assertions: AssertionEntry[];
  selected: boolean;
}

export interface PageEntry {
  page_url: string;
  spec_id: string;
  spec_description: string;
  groups: SpecGroupEntry[];
  selected: boolean;
  has_specs: boolean;
  additional_instructions?: string;
}

export interface SweepOptions {
  provider?: string;
  model?: string;
  discovery_mode: "auto" | "enabled" | "disabled";
  additional_context?: string;
}

export interface PageSweepItem extends LocalStorageItem, BuilderItem {
  tags: string[];
  app_url: string;
  pages: PageEntry[];
  sweep_options: SweepOptions;
  last_sequence_id?: string;
  last_generated_at?: string;
}

// =============================================================================
// Form State
// =============================================================================

export interface PageSweepForm {
  name: string;
  description: string;
  tags: string[];
  app_url: string;
  pages: PageEntry[];
  sweep_options: SweepOptions;
  last_sequence_id?: string;
  last_generated_at?: string;
}

export function toForm(item: PageSweepItem): PageSweepForm {
  return {
    name: item.name,
    description: item.description || "",
    tags: item.tags || [],
    app_url: item.app_url || "",
    pages: item.pages || [],
    sweep_options: item.sweep_options || defaultSweepOptions(),
    last_sequence_id: item.last_sequence_id,
    last_generated_at: item.last_generated_at,
  };
}

export function defaultSweepOptions(): SweepOptions {
  return {
    discovery_mode: "auto",
  };
}

export function defaultForm(): PageSweepForm {
  return {
    name: "",
    description: "",
    tags: [],
    app_url: "http://localhost:3001",
    pages: [],
    sweep_options: defaultSweepOptions(),
  };
}

export function toPayload(form: PageSweepForm): Record<string, unknown> {
  return {
    name: form.name,
    description: form.description || undefined,
    tags: form.tags,
    app_url: form.app_url,
    pages: form.pages,
    sweep_options: form.sweep_options,
    last_sequence_id: form.last_sequence_id,
    last_generated_at: form.last_generated_at,
  };
}

// =============================================================================
// Discovery helpers
// =============================================================================

/** Convert a DiscoveredSpec into PageEntry format */
export function specToPageEntry(spec: DiscoveredSpec): PageEntry {
  const pageUrl = spec.config?.metadata?.pageUrl || spec.specId;
  const groups: SpecGroupEntry[] = (spec.config?.groups ?? []).map(
    (g: SpecGroup) => ({
      id: g.id,
      name: g.name,
      description: g.description || "",
      category: g.category || "unknown",
      assertion_count: g.assertions.filter((a) => a.enabled).length,
      assertions: g.assertions.map((a) => ({
        id: a.id,
        description: a.description,
        category: a.category,
        severity: a.severity,
        enabled: a.enabled,
      })),
      selected: true,
    })
  );

  return {
    page_url: pageUrl,
    spec_id: spec.specId,
    spec_description: spec.config?.description || "",
    groups,
    selected: true,
    has_specs: true,
  };
}

/** Create a no-spec PageEntry for a discovered page without specs */
export function noSpecPageEntry(pageUrl: string): PageEntry {
  return {
    page_url: pageUrl,
    spec_id: "",
    spec_description: "",
    groups: [],
    selected: false,
    has_specs: false,
  };
}

/** Merge newly discovered pages into existing page entries.
 *  Accepts either DiscoveredSpec[] (converted to PageEntry) or raw PageEntry[].
 *  No-spec entries never overwrite existing has-spec entries. */
export function mergeDiscoveredPages(
  existing: PageEntry[],
  incoming: DiscoveredSpec[] | PageEntry[]
): PageEntry[] {
  const byUrl = new Map(existing.map((p) => [p.page_url, p]));

  const first = incoming[0];
  const newEntries: PageEntry[] =
    first !== undefined && "specId" in first
      ? (incoming as DiscoveredSpec[]).map(specToPageEntry)
      : (incoming as PageEntry[]);

  for (const entry of newEntries) {
    const existingEntry = byUrl.get(entry.page_url);
    if (existingEntry) {
      // Don't overwrite a has-spec entry with a no-spec entry
      if (existingEntry.has_specs && !entry.has_specs) continue;

      // Update spec data but preserve user selection state
      byUrl.set(entry.page_url, {
        ...entry,
        selected: existingEntry.selected,
        additional_instructions: existingEntry.additional_instructions,
        groups: entry.groups.map((g) => {
          const existingGroup = existingEntry.groups.find(
            (eg) => eg.id === g.id
          );
          return existingGroup ? { ...g, selected: existingGroup.selected } : g;
        }),
      });
    } else {
      byUrl.set(entry.page_url, entry);
    }
  }

  return Array.from(byUrl.values());
}

// =============================================================================
// Prompt builder (per-page)
// =============================================================================

/** Build the AI generation prompt for a single page */
export function buildPerPagePrompt(
  page: PageEntry,
  globalContext?: string
): string {
  const lines: string[] = [
    "Create a verification workflow for a single page based on UI Bridge page specifications.",
    "",
    `## Page: ${page.page_url}`,
  ];

  if (page.spec_description) {
    lines.push(`Spec: ${page.spec_description}`);
  }
  lines.push("");

  const selectedGroups = page.groups.filter((g) => g.selected);
  if (selectedGroups.length > 0) {
    for (const group of selectedGroups) {
      lines.push(`### ${group.name} (${group.category})`);
      if (group.description) {
        lines.push(group.description);
      }
      lines.push(`${group.assertion_count} assertions to verify.`);
      lines.push("");
    }
  }

  lines.push(
    `Summary: ${selectedGroups.length} spec group${selectedGroups.length !== 1 ? "s" : ""} for page ${page.page_url}.`,
    "",
    "Create verification steps using UI Bridge SDK assertions for each spec group.",
    "Include setup (navigate + connect), agentic (fix failures), and completion (summary) steps."
  );

  if (globalContext) {
    lines.push("", "## Global Context", globalContext);
  }

  if (page.additional_instructions) {
    lines.push("", "## Additional Instructions", page.additional_instructions);
  }

  return lines.join("\n");
}
