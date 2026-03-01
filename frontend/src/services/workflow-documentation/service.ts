/**
 * Workflow Documentation Service
 *
 * Core service class that orchestrates documentation management,
 * including CRUD operations, versioning, and persistence.
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  WorkflowDocumentation,
  ActionComment,
  DocumentationVersion,
  ExportOptions,
} from "./types";
import {
  generateDependenciesList,
  generateDocumentation as generateDocContent,
  generateFlowchart,
  generateVariablesTable,
} from "./generator";
import { getTemplates } from "./templates";
import {
  generateTOC,
  searchDocumentation,
  compareDocVersions,
} from "./formatter";
import {
  exportDocumentation,
  exportAllDocumentation,
  exportProjectReadme,
} from "./exporter";
import { createLogger } from "@/lib/logger";
const logger = createLogger("WorkflowDocumentation");

export class WorkflowDocumentationService {
  private static instance: WorkflowDocumentationService;
  private documentations: Map<string, WorkflowDocumentation> = new Map();
  private comments: Map<string, ActionComment> = new Map();
  private versions: Map<string, DocumentationVersion[]> = new Map();
  private readonly DOCS_STORAGE_KEY = "workflow-documentation";
  private readonly COMMENTS_STORAGE_KEY = "workflow-action-comments";
  private readonly VERSIONS_STORAGE_KEY = "workflow-documentation-versions";

  private constructor() {
    this.loadFromStorage();
  }

  static getInstance(): WorkflowDocumentationService {
    if (!WorkflowDocumentationService.instance) {
      WorkflowDocumentationService.instance =
        new WorkflowDocumentationService();
    }
    return WorkflowDocumentationService.instance;
  }

  // ==========================================================================
  // 1. Documentation Management
  // ==========================================================================

  createDocumentation(
    workflowId: string,
    content: string,
    options?: {
      format?: "markdown" | "html" | "plain";
      author?: string;
      tags?: string[];
    }
  ): WorkflowDocumentation {
    const doc: WorkflowDocumentation = {
      workflowId,
      content,
      format: options?.format || "markdown",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      version: 1,
      author: options?.author,
      tags: options?.tags || [],
    };

    this.documentations.set(workflowId, doc);
    this.saveDocumentationVersion(workflowId, content, "Initial documentation");
    this.saveToStorage();

    return doc;
  }

  updateDocumentation(
    workflowId: string,
    content: string,
    changeDescription?: string
  ): WorkflowDocumentation | null {
    const doc = this.documentations.get(workflowId);
    if (!doc) {
      return null;
    }

    doc.content = content;
    doc.updated = new Date().toISOString();
    doc.version++;

    this.saveDocumentationVersion(workflowId, content, changeDescription);
    this.saveToStorage();

    return doc;
  }

  getDocumentation(workflowId: string): WorkflowDocumentation | null {
    return this.documentations.get(workflowId) || null;
  }

  deleteDocumentation(workflowId: string): boolean {
    const deleted = this.documentations.delete(workflowId);
    if (deleted) {
      this.versions.delete(workflowId);
      const commentIds = Array.from(this.comments.values())
        .filter((c) => c.workflowId === workflowId)
        .map((c) => c.id);
      commentIds.forEach((id) => this.comments.delete(id));
      this.saveToStorage();
    }
    return deleted;
  }

  hasDocumentation(workflowId: string): boolean {
    return this.documentations.has(workflowId);
  }

  // ==========================================================================
  // 2. Action Comments
  // ==========================================================================

  addActionComment(
    workflowId: string,
    actionId: string,
    comment: string,
    author?: string
  ): ActionComment {
    const commentObj: ActionComment = {
      id: `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      workflowId,
      actionId,
      comment,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      author,
    };

    this.comments.set(commentObj.id, commentObj);
    this.saveToStorage();

    return commentObj;
  }

  updateActionComment(
    commentId: string,
    comment: string
  ): ActionComment | null {
    const commentObj = this.comments.get(commentId);
    if (!commentObj) {
      return null;
    }

    commentObj.comment = comment;
    commentObj.updated = new Date().toISOString();
    this.saveToStorage();

    return commentObj;
  }

  deleteActionComment(commentId: string): boolean {
    const deleted = this.comments.delete(commentId);
    if (deleted) {
      this.saveToStorage();
    }
    return deleted;
  }

  getActionComment(actionId: string): ActionComment | null {
    return (
      Array.from(this.comments.values()).find((c) => c.actionId === actionId) ||
      null
    );
  }

  getAllActionComments(workflowId: string): ActionComment[] {
    return Array.from(this.comments.values()).filter(
      (c) => c.workflowId === workflowId
    );
  }

  // ==========================================================================
  // 3. Auto-Generated Documentation
  // ==========================================================================

  generateDocumentation(workflow: Workflow): string {
    return generateDocContent(
      workflow,
      (actionId) => this.getActionComment(actionId),
      (workflowId) => this.getDocumentationHistory(workflowId)
    );
  }

  // Delegate to generator functions (public API preserved)
  generateVariablesTable(workflow: Workflow): string {
    return generateVariablesTable(workflow);
  }

  generateDependenciesList(workflow: Workflow): string {
    return generateDependenciesList(workflow);
  }

  generateFlowchart(workflow: Workflow): string {
    return generateFlowchart(workflow);
  }

  // ==========================================================================
  // 4. Documentation Templates
  // ==========================================================================

  getTemplates() {
    return getTemplates();
  }

  applyTemplate(
    workflowId: string,
    templateName: string,
    workflow: Workflow
  ): boolean {
    const template = this.getTemplates().find((t) => t.name === templateName);
    if (!template) {
      return false;
    }

    let content = template.content;
    content = content.replace(/{workflow\.name}/g, workflow.name);
    content = content.replace(
      /{workflow\.description}/g,
      workflow.description || ""
    );
    content = content.replace(/{workflow\.version}/g, workflow.version);

    this.createDocumentation(workflowId, content, {
      tags: [template.category],
    });

    return true;
  }

  // ==========================================================================
  // 5. Table of Contents
  // ==========================================================================

  generateTOC(content: string): string {
    return generateTOC(content);
  }

  updateTOC(workflowId: string): boolean {
    const doc = this.getDocumentation(workflowId);
    if (!doc) {
      return false;
    }

    const toc = generateTOC(doc.content);

    // Remove existing TOC if present
    let content = doc.content.replace(
      /## Table of Contents\n\n([\s\S]*?)\n\n##/m,
      "##"
    );

    // Add new TOC after title
    const lines = content.split("\n");
    const titleIndex = lines.findIndex((l) => l.startsWith("#"));

    if (titleIndex !== -1) {
      lines.splice(titleIndex + 1, 0, "", toc);
      content = lines.join("\n");
    }

    this.updateDocumentation(workflowId, content, "Updated table of contents");

    return true;
  }

  // ==========================================================================
  // 6. Search
  // ==========================================================================

  searchDocumentation(query: string) {
    return searchDocumentation(this.documentations, query);
  }

  findWorkflowsByDocContent(query: string): string[] {
    return this.searchDocumentation(query).map((r) => r.workflowId);
  }

  // ==========================================================================
  // 7. Version History
  // ==========================================================================

  saveDocumentationVersion(
    workflowId: string,
    content: string,
    changeDescription?: string
  ): void {
    const versions = this.versions.get(workflowId) || [];

    const version: DocumentationVersion = {
      version: versions.length + 1,
      content,
      timestamp: new Date().toISOString(),
      changeDescription,
    };

    versions.push(version);
    this.versions.set(workflowId, versions);

    // Keep only last 20 versions to save space
    if (versions.length > 20) {
      versions.shift();
    }

    this.saveToStorage();
  }

  getDocumentationHistory(workflowId: string): DocumentationVersion[] {
    return this.versions.get(workflowId) || [];
  }

  compareDocVersions(
    version1: DocumentationVersion,
    version2: DocumentationVersion
  ) {
    return compareDocVersions(version1, version2);
  }

  // ==========================================================================
  // 8. Export
  // ==========================================================================

  exportDocumentation(
    workflowId: string,
    options: ExportOptions = { format: "markdown" }
  ): string | null {
    const doc = this.getDocumentation(workflowId);
    return exportDocumentation(
      workflowId,
      doc,
      (wfId) => this.getAllActionComments(wfId),
      options
    );
  }

  exportAllDocumentation(
    options: ExportOptions = { format: "markdown" }
  ): string {
    return exportAllDocumentation(
      this.documentations,
      (wfId) => this.getAllActionComments(wfId),
      options
    );
  }

  exportProjectReadme(workflows: Workflow[]): string {
    return exportProjectReadme(workflows, (wfId) =>
      this.getDocumentation(wfId)
    );
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  private saveToStorage(): void {
    try {
      const docsArray = Array.from(this.documentations.entries());
      localStorage.setItem(this.DOCS_STORAGE_KEY, JSON.stringify(docsArray));

      const commentsArray = Array.from(this.comments.entries());
      localStorage.setItem(
        this.COMMENTS_STORAGE_KEY,
        JSON.stringify(commentsArray)
      );

      const versionsArray = Array.from(this.versions.entries());
      localStorage.setItem(
        this.VERSIONS_STORAGE_KEY,
        JSON.stringify(versionsArray)
      );
    } catch (error) {
      logger.error("Failed to save documentation to storage:", error);
    }
  }

  private loadFromStorage(): void {
    if (typeof window === "undefined") return;
    try {
      const docsJson = localStorage.getItem(this.DOCS_STORAGE_KEY);
      if (docsJson) {
        const docsArray = JSON.parse(docsJson);
        this.documentations = new Map(docsArray);
      }

      const commentsJson = localStorage.getItem(this.COMMENTS_STORAGE_KEY);
      if (commentsJson) {
        const commentsArray = JSON.parse(commentsJson);
        this.comments = new Map(commentsArray);
      }

      const versionsJson = localStorage.getItem(this.VERSIONS_STORAGE_KEY);
      if (versionsJson) {
        const versionsArray = JSON.parse(versionsJson);
        this.versions = new Map(versionsArray);
      }
    } catch (error) {
      logger.error("Failed to load documentation from storage:", error);
    }
  }

  clearAll(): void {
    this.documentations.clear();
    this.comments.clear();
    this.versions.clear();
    localStorage.removeItem(this.DOCS_STORAGE_KEY);
    localStorage.removeItem(this.COMMENTS_STORAGE_KEY);
    localStorage.removeItem(this.VERSIONS_STORAGE_KEY);
  }
}
