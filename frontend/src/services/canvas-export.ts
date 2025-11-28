/**
 * Canvas Export Service
 *
 * Export canvas/workflow in various formats:
 * - PNG - Raster image export
 * - SVG - Vector image export
 * - PDF - Document export
 * - JSON - Workflow data (via WorkflowFileManager)
 * - Markdown - Documentation export
 *
 * Features:
 * - Full canvas or selection export
 * - Custom dimensions
 * - Background options (transparent/white/grid)
 * - Quality settings
 */

import { Workflow, Action } from "../lib/action-schema/action-types";
import { workflowFileManager } from "./workflow-file-manager";

// ============================================================================
// Types
// ============================================================================

export type ExportFormat = "png" | "svg" | "pdf" | "json" | "markdown";

export interface ExportOptions {
  format: ExportFormat;
  filename?: string;
  quality?: number; // 0-1 for PNG
  scale?: number; // Scale factor
  width?: number; // Custom width
  height?: number; // Custom height
  background?: "transparent" | "white" | "grid" | "color";
  backgroundColor?: string;
  includeMetadata?: boolean;
  selectionOnly?: boolean;
  selectedActionIds?: string[];
}

export interface CanvasExportResult {
  success: boolean;
  data?: string | Blob;
  filename?: string;
  error?: string;
}

// ============================================================================
// CanvasExportService Class
// ============================================================================

export class CanvasExportService {
  private static instance: CanvasExportService;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): CanvasExportService {
    if (!CanvasExportService.instance) {
      CanvasExportService.instance = new CanvasExportService();
    }
    return CanvasExportService.instance;
  }

  // ==========================================================================
  // Main Export Function
  // ==========================================================================

  /**
   * Export workflow/canvas in specified format
   */
  async export(
    workflow: Workflow,
    canvasElement: HTMLElement | null,
    options: ExportOptions
  ): Promise<CanvasExportResult> {
    const { format } = options;

    try {
      switch (format) {
        case "png":
          return await this.exportPNG(workflow, canvasElement, options);
        case "svg":
          return await this.exportSVG(workflow, canvasElement, options);
        case "pdf":
          return await this.exportPDF(workflow, canvasElement, options);
        case "json":
          return this.exportJSON(workflow, options);
        case "markdown":
          return this.exportMarkdown(workflow, options);
        default:
          return {
            success: false,
            error: `Unsupported export format: ${format}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // PNG Export
  // ==========================================================================

  /**
   * Export canvas as PNG image
   */
  private async exportPNG(
    workflow: Workflow,
    canvasElement: HTMLElement | null,
    options: ExportOptions
  ): Promise<CanvasExportResult> {
    if (!canvasElement) {
      return { success: false, error: "Canvas element not found" };
    }

    try {
      // Use html2canvas or similar library in real implementation
      // For now, we'll create a placeholder implementation
      const canvas = await this.renderToCanvas(canvasElement, options);

      const quality = options.quality || 0.95;
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/png", quality);
      });

      if (!blob) {
        return { success: false, error: "Failed to create PNG blob" };
      }

      const filename = options.filename || `${workflow.name}.png`;
      this.downloadBlob(blob, filename);

      return {
        success: true,
        data: blob,
        filename,
      };
    } catch (error) {
      return {
        success: false,
        error: `PNG export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // SVG Export
  // ==========================================================================

  /**
   * Export canvas as SVG image
   */
  private async exportSVG(
    workflow: Workflow,
    canvasElement: HTMLElement | null,
    options: ExportOptions
  ): Promise<CanvasExportResult> {
    if (!canvasElement) {
      return { success: false, error: "Canvas element not found" };
    }

    try {
      const svg = this.createSVG(workflow, options);
      const blob = new Blob([svg], { type: "image/svg+xml" });
      const filename = options.filename || `${workflow.name}.svg`;

      this.downloadBlob(blob, filename);

      return {
        success: true,
        data: svg,
        filename,
      };
    } catch (error) {
      return {
        success: false,
        error: `SVG export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Create SVG representation of workflow
   */
  private createSVG(workflow: Workflow, options: ExportOptions): string {
    const actions =
      options.selectionOnly && options.selectedActionIds
        ? workflow.actions.filter((a) =>
            options.selectedActionIds!.includes(a.id)
          )
        : workflow.actions;

    // Calculate bounds
    const bounds = this.calculateBounds(actions);
    const width = options.width || bounds.width + 100;
    const height = options.height || bounds.height + 100;
    const offsetX = bounds.minX - 50;
    const offsetY = bounds.minY - 50;

    // Create SVG header
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

    // Add background
    if (options.background && options.background !== "transparent") {
      const bgColor =
        options.background === "white"
          ? "#ffffff"
          : options.backgroundColor || "#f5f5f5";
      svg += `<rect width="${width}" height="${height}" fill="${bgColor}"/>`;
    }

    // Add grid if requested
    if (options.background === "grid") {
      svg += this.createGridPattern(width, height);
    }

    // Add connections
    Object.entries(workflow.connections || {}).forEach(
      ([sourceId, outputs]) => {
        if (!sourceId || !outputs) return;

        const sourceAction = workflow.actions.find((a) => a?.id === sourceId);
        if (!sourceAction) return;

        ["main", "error", "success", "parallel"].forEach((type) => {
          const connections = outputs[type as keyof typeof outputs];
          if (connections && Array.isArray(connections)) {
            connections.forEach((outputConnections) => {
              if (!Array.isArray(outputConnections)) return;

              outputConnections.forEach((conn) => {
                if (!conn || !conn.action) return;

                const targetAction = workflow.actions.find(
                  (a) => a?.id === conn.action
                );
                if (targetAction) {
                  svg += this.createConnectionSVG(
                    sourceAction,
                    targetAction,
                    type,
                    offsetX,
                    offsetY
                  );
                }
              });
            });
          }
        });
      }
    );

    // Add actions
    actions.forEach((action) => {
      svg += this.createActionSVG(action, offsetX, offsetY);
    });

    svg += "</svg>";
    return svg;
  }

  /**
   * Create SVG for a single action
   */
  private createActionSVG(
    action: Action,
    offsetX: number,
    offsetY: number
  ): string {
    const [x, y] = action.position;
    const adjustedX = x - offsetX;
    const adjustedY = y - offsetY;
    const width = 200;
    const height = 80;

    return `
      <g transform="translate(${adjustedX}, ${adjustedY})">
        <rect width="${width}" height="${height}" rx="8" fill="#ffffff" stroke="#e5e7eb" stroke-width="2"/>
        <text x="${width / 2}" y="30" text-anchor="middle" font-family="Arial" font-size="14" font-weight="bold">${action.type}</text>
        <text x="${width / 2}" y="55" text-anchor="middle" font-family="Arial" font-size="12" fill="#6b7280">${action.name || action.id}</text>
      </g>
    `;
  }

  /**
   * Create SVG for a connection
   */
  private createConnectionSVG(
    source: Action,
    target: Action,
    type: string,
    offsetX: number,
    offsetY: number
  ): string {
    const [x1, y1] = source.position;
    const [x2, y2] = target.position;

    const startX = x1 - offsetX + 100;
    const startY = y1 - offsetY + 80;
    const endX = x2 - offsetX + 100;
    const endY = y2 - offsetY;

    const color =
      type === "error" ? "#ef4444" : type === "success" ? "#10b981" : "#3b82f6";

    return `
      <path d="M ${startX} ${startY} Q ${startX} ${(startY + endY) / 2} ${endX} ${endY}"
            fill="none" stroke="${color}" stroke-width="2" marker-end="url(#arrow-${type})"/>
    `;
  }

  /**
   * Create grid pattern for SVG
   */
  private createGridPattern(width: number, height: number): string {
    return `
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e5e7eb" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#grid)"/>
    `;
  }

  // ==========================================================================
  // PDF Export
  // ==========================================================================

  /**
   * Export canvas as PDF
   */
  private async exportPDF(
    workflow: Workflow,
    canvasElement: HTMLElement | null,
    options: ExportOptions
  ): Promise<CanvasExportResult> {
    // PDF export would require a library like jsPDF
    // This is a placeholder implementation
    return {
      success: false,
      error: "PDF export requires jsPDF library (not yet implemented)",
    };
  }

  // ==========================================================================
  // JSON Export
  // ==========================================================================

  /**
   * Export workflow as JSON
   */
  private exportJSON(
    workflow: Workflow,
    options: ExportOptions
  ): CanvasExportResult {
    try {
      console.log("[CanvasExport] Starting JSON export", {
        workflowName: workflow?.name,
        workflowId: workflow?.id,
        hasWorkflow: !!workflow,
        workflowKeys: workflow ? Object.keys(workflow) : [],
        actionsCount: workflow?.actions?.length,
        options,
      });

      if (!workflow) {
        throw new Error("Workflow is undefined or null");
      }

      if (!workflow.name) {
        console.warn("[CanvasExport] Workflow has no name, using default");
      }

      workflowFileManager.exportWorkflow(workflow, {
        filename: options.filename,
        includeMetadata: options.includeMetadata,
      });

      console.log("[CanvasExport] JSON export successful");

      return {
        success: true,
        filename: options.filename,
      };
    } catch (error) {
      console.error("[CanvasExport] JSON export error:", {
        error,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        errorStack: error instanceof Error ? error.stack : undefined,
        workflow: workflow
          ? {
              id: workflow.id,
              name: workflow.name,
              hasActions: !!workflow.actions,
              actionsLength: workflow.actions?.length,
            }
          : "undefined",
      });

      return {
        success: false,
        error: `JSON export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // Markdown Export
  // ==========================================================================

  /**
   * Export workflow as Markdown documentation
   */
  private exportMarkdown(
    workflow: Workflow,
    options: ExportOptions
  ): CanvasExportResult {
    try {
      const markdown = this.generateMarkdown(workflow);
      const blob = new Blob([markdown], { type: "text/markdown" });
      const filename = options.filename || `${workflow.name}.md`;

      this.downloadBlob(blob, filename);

      return {
        success: true,
        data: markdown,
        filename,
      };
    } catch (error) {
      return {
        success: false,
        error: `Markdown export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Generate Markdown documentation for workflow
   */
  private generateMarkdown(workflow: Workflow): string {
    let md = `# ${workflow.name}\n\n`;

    // Metadata
    if (workflow.metadata?.description) {
      md += `${workflow.metadata.description}\n\n`;
    }

    md += `**Version:** ${workflow.version}\n`;
    md += `**Format:** ${workflow.format}\n`;
    if (workflow.metadata?.created) {
      md += `**Created:** ${new Date(workflow.metadata.created).toLocaleString()}\n`;
    }
    if (workflow.metadata?.updated) {
      md += `**Updated:** ${new Date(workflow.metadata.updated).toLocaleString()}\n`;
    }
    md += "\n";

    // Tags
    if (workflow.tags && workflow.tags.length > 0) {
      md += `**Tags:** ${workflow.tags.join(", ")}\n\n`;
    }

    // Statistics
    md += `## Statistics\n\n`;
    md += `- **Actions:** ${workflow.actions.length}\n`;
    md += `- **Connections:** ${Object.keys(workflow.connections).length}\n`;
    md += "\n";

    // Actions
    md += `## Actions\n\n`;
    workflow.actions.forEach((action, index) => {
      md += `### ${index + 1}. ${action.name || action.id}\n\n`;
      md += `**Type:** \`${action.type}\`\n\n`;

      if (action.position) {
        md += `**Position:** [${action.position[0]}, ${action.position[1]}]\n\n`;
      }

      md += `**Configuration:**\n\`\`\`json\n${JSON.stringify(action.config, null, 2)}\n\`\`\`\n\n`;
    });

    // Connections
    if (workflow.connections && Object.keys(workflow.connections).length > 0) {
      md += `## Connections\n\n`;
      Object.entries(workflow.connections).forEach(([sourceId, outputs]) => {
        if (!sourceId || !outputs) return;

        const sourceAction = workflow.actions.find((a) => a?.id === sourceId);
        md += `### From: ${sourceAction?.name || sourceId}\n\n`;

        ["main", "error", "success", "parallel"].forEach((type) => {
          const connections = outputs[type as keyof typeof outputs];
          if (connections && Array.isArray(connections)) {
            md += `**${type} →**\n`;
            connections.forEach((outputConnections) => {
              if (!Array.isArray(outputConnections)) return;

              outputConnections.forEach((conn) => {
                if (!conn || !conn.action) return;

                const targetAction = workflow.actions.find(
                  (a) => a?.id === conn.action
                );
                md += `- ${targetAction?.name || conn.action}\n`;
              });
            });
            md += "\n";
          }
        });
      });
    }

    // Variables
    if (workflow.variables) {
      md += `## Variables\n\n`;
      md += `\`\`\`json\n${JSON.stringify(workflow.variables, null, 2)}\n\`\`\`\n\n`;
    }

    // Settings
    if (workflow.settings) {
      md += `## Settings\n\n`;
      md += `\`\`\`json\n${JSON.stringify(workflow.settings, null, 2)}\n\`\`\`\n\n`;
    }

    return md;
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Render element to canvas
   */
  private async renderToCanvas(
    element: HTMLElement,
    options: ExportOptions
  ): Promise<HTMLCanvasElement> {
    const canvas = document.createElement("canvas");
    const scale = options.scale || 1;

    canvas.width = (options.width || element.offsetWidth) * scale;
    canvas.height = (options.height || element.offsetHeight) * scale;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }

    // Apply scale
    ctx.scale(scale, scale);

    // Apply background
    if (options.background && options.background !== "transparent") {
      ctx.fillStyle =
        options.background === "white"
          ? "#ffffff"
          : options.backgroundColor || "#f5f5f5";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // In a real implementation, this would use html2canvas or similar
    // to render the actual DOM element to the canvas

    return canvas;
  }

  /**
   * Calculate bounds of actions
   */
  private calculateBounds(actions: Action[]): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  } {
    if (actions.length === 0) {
      return {
        minX: 0,
        minY: 0,
        maxX: 800,
        maxY: 600,
        width: 800,
        height: 600,
      };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    actions.forEach((action) => {
      if (
        !action ||
        !action.position ||
        !Array.isArray(action.position) ||
        action.position.length < 2
      ) {
        return;
      }

      const [x, y] = action.position;
      if (typeof x !== "number" || typeof y !== "number") {
        return;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + 200); // Assume 200px width
      maxY = Math.max(maxY, y + 80); // Assume 80px height
    });

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /**
   * Download blob as file
   */
  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 100);
  }
}

// ============================================================================
// Exports
// ============================================================================

export const canvasExport = CanvasExportService.getInstance();
