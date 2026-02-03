/**
 * Training Data Import Utility
 *
 * Imports annotations from various formats:
 * - COCO format (JSON with annotations)
 * - YOLO format (txt files with normalized bbox)
 * - CSV format (simple spreadsheet format)
 */

import type { AnnotatedElement, BoundingBox } from "@/stores/extraction-annotation-store";

export type ImportFormat = "coco" | "yolo" | "csv" | "auto";

export interface ImportOptions {
  format: ImportFormat;
  screenshotWidth: number;
  screenshotHeight: number;
  classesContent?: string; // For YOLO format - contents of classes.txt
}

interface COCOAnnotation {
  id: number;
  image_id: number;
  category_id: number;
  bbox: [number, number, number, number]; // [x, y, width, height]
  area?: number;
  iscrowd?: number;
  attributes?: {
    label?: string;
    description?: string;
    reasoning?: string;
    isClickable?: boolean;
    confidence?: number;
    isGroundTruth?: boolean;
    detectionTechnique?: string;
  };
}

interface COCOCategory {
  id: number;
  name: string;
  supercategory?: string;
}

interface COCOData {
  info?: Record<string, unknown>;
  images?: Array<{ id: number; width?: number; height?: number; file_name?: string }>;
  annotations: COCOAnnotation[];
  categories: COCOCategory[];
}

function generateImportId(): string {
  return `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Detect format from content
 */
export function detectFormat(content: string): ImportFormat {
  const trimmed = content.trim();

  // Try JSON first (COCO)
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.annotations && parsed.categories) {
        return "coco";
      }
    } catch {
      // Not valid JSON
    }
  }

  // Check for CSV (has headers with commas)
  const lines = trimmed.split("\n");
  if (lines.length > 0) {
    const firstLine = lines[0]!.toLowerCase();
    if (
      firstLine.includes(",") &&
      (firstLine.includes("id") ||
        firstLine.includes("label") ||
        firstLine.includes("x") ||
        firstLine.includes("bbox"))
    ) {
      return "csv";
    }
  }

  // Check for YOLO (lines with 5 space-separated numbers)
  if (lines.length > 0) {
    const firstDataLine = lines.find((l) => l.trim().length > 0);
    if (firstDataLine) {
      const parts = firstDataLine.trim().split(/\s+/);
      if (parts.length === 5 && parts.every((p) => !isNaN(parseFloat(p)))) {
        return "yolo";
      }
    }
  }

  return "auto"; // Couldn't detect
}

/**
 * Import from COCO format
 */
function importFromCOCO(content: string, _options: ImportOptions): AnnotatedElement[] {
  const data: COCOData = JSON.parse(content);
  const elements: AnnotatedElement[] = [];

  // Build category map
  const categoryMap = new Map<number, string>();
  for (const cat of data.categories) {
    categoryMap.set(cat.id, cat.name);
  }

  for (const ann of data.annotations) {
    const [x, y, width, height] = ann.bbox;
    const categoryName = categoryMap.get(ann.category_id) || "unknown";

    elements.push({
      id: generateImportId(),
      bbox: { x, y, width, height },
      label: ann.attributes?.label || categoryName,
      elementType: categoryName,
      description: ann.attributes?.description,
      reasoning: ann.attributes?.reasoning,
      confidence: ann.attributes?.confidence ?? 0.5,
      isGroundTruth: ann.attributes?.isGroundTruth ?? true,
      isAutoDetected: false,
      detectionTechnique: ann.attributes?.detectionTechnique || "imported-coco",
      isClickable: ann.attributes?.isClickable,
    });
  }

  return elements;
}

/**
 * Import from YOLO format
 */
function importFromYOLO(content: string, options: ImportOptions): AnnotatedElement[] {
  const elements: AnnotatedElement[] = [];
  const lines = content.trim().split("\n");

  // Parse classes if provided
  const classes: string[] = [];
  if (options.classesContent) {
    classes.push(...options.classesContent.trim().split("\n").map((l) => l.trim()));
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length !== 5) continue;

    const [classIdStr, xCenterStr, yCenterStr, widthStr, heightStr] = parts;
    const classId = parseInt(classIdStr!, 10);
    const xCenter = parseFloat(xCenterStr!);
    const yCenter = parseFloat(yCenterStr!);
    const width = parseFloat(widthStr!);
    const height = parseFloat(heightStr!);

    // Convert from normalized to absolute coordinates
    const absWidth = width * options.screenshotWidth;
    const absHeight = height * options.screenshotHeight;
    const absX = xCenter * options.screenshotWidth - absWidth / 2;
    const absY = yCenter * options.screenshotHeight - absHeight / 2;

    const className = classes[classId] || `class_${classId}`;

    elements.push({
      id: generateImportId(),
      bbox: {
        x: Math.round(absX),
        y: Math.round(absY),
        width: Math.round(absWidth),
        height: Math.round(absHeight),
      },
      label: className,
      elementType: className,
      confidence: 1.0,
      isGroundTruth: true,
      isAutoDetected: false,
      detectionTechnique: "imported-yolo",
    });
  }

  return elements;
}

/**
 * Parse CSV value, handling quotes
 */
function parseCSVValue(value: string): string {
  let v = value.trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    v = v.slice(1, -1).replace(/""/g, '"');
  }
  return v;
}

/**
 * Parse CSV line, handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);

  return result.map(parseCSVValue);
}

/**
 * Import from CSV format
 */
function importFromCSV(content: string, _options: ImportOptions): AnnotatedElement[] {
  const elements: AnnotatedElement[] = [];
  const lines = content.trim().split("\n");

  if (lines.length < 2) return elements;

  // Parse headers
  const headers = parseCSVLine(lines[0]!).map((h) => h.toLowerCase());

  // Find column indices
  const getIndex = (names: string[]) =>
    headers.findIndex((h) => names.some((n) => h.includes(n)));

  const idIdx = getIndex(["id"]);
  const labelIdx = getIndex(["label", "name"]);
  const typeIdx = getIndex(["element_type", "type", "class"]);
  const xIdx = getIndex(["x", "bbox_x", "left"]);
  const yIdx = getIndex(["y", "bbox_y", "top"]);
  const widthIdx = getIndex(["width", "w"]);
  const heightIdx = getIndex(["height", "h"]);
  const textIdx = getIndex(["text", "content"]);
  const descIdx = getIndex(["description", "desc"]);
  const reasoningIdx = getIndex(["reasoning"]);
  const confIdx = getIndex(["confidence", "conf", "score"]);
  const gtIdx = getIndex(["is_ground_truth", "ground_truth", "gt"]);
  const clickableIdx = getIndex(["is_clickable", "clickable"]);
  const techniqueIdx = getIndex(["detection_technique", "technique", "method"]);

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const values = parseCSVLine(line);

    const getValue = (idx: number) => (idx >= 0 ? values[idx] : undefined);
    const getNumber = (idx: number, defaultVal: number) => {
      const v = getValue(idx);
      return v ? parseFloat(v) : defaultVal;
    };
    const getBool = (idx: number, defaultVal: boolean) => {
      const v = getValue(idx)?.toLowerCase();
      if (v === "true" || v === "1" || v === "yes") return true;
      if (v === "false" || v === "0" || v === "no") return false;
      return defaultVal;
    };

    const bbox: BoundingBox = {
      x: getNumber(xIdx, 0),
      y: getNumber(yIdx, 0),
      width: getNumber(widthIdx, 100),
      height: getNumber(heightIdx, 100),
    };

    elements.push({
      id: getValue(idIdx) || generateImportId(),
      bbox,
      label: getValue(labelIdx) || "Imported",
      elementType: getValue(typeIdx) || "other",
      text: getValue(textIdx),
      description: getValue(descIdx),
      reasoning: getValue(reasoningIdx),
      confidence: getNumber(confIdx, 0.5),
      isGroundTruth: getBool(gtIdx, true),
      isAutoDetected: false,
      detectionTechnique: getValue(techniqueIdx) || "imported-csv",
      isClickable: getBool(clickableIdx, true),
    });
  }

  return elements;
}

/**
 * Main import function
 */
export function importTrainingData(
  content: string,
  options: ImportOptions
): { elements: AnnotatedElement[]; format: ImportFormat; error?: string } {
  try {
    let format = options.format;

    // Auto-detect format if needed
    if (format === "auto") {
      format = detectFormat(content);
      if (format === "auto") {
        return {
          elements: [],
          format: "auto",
          error: "Could not detect file format. Please specify the format manually.",
        };
      }
    }

    let elements: AnnotatedElement[] = [];

    switch (format) {
      case "coco":
        elements = importFromCOCO(content, options);
        break;
      case "yolo":
        elements = importFromYOLO(content, options);
        break;
      case "csv":
        elements = importFromCSV(content, options);
        break;
      default:
        return {
          elements: [],
          format,
          error: `Unsupported format: ${format}`,
        };
    }

    if (elements.length === 0) {
      return {
        elements: [],
        format,
        error: "No annotations found in the file.",
      };
    }

    return { elements, format };
  } catch (error) {
    return {
      elements: [],
      format: options.format,
      error: error instanceof Error ? error.message : "Failed to parse file",
    };
  }
}

/**
 * Get format display info
 */
export function getImportFormatInfo(format: ImportFormat): { name: string; description: string; extensions: string[] } {
  switch (format) {
    case "coco":
      return {
        name: "COCO JSON",
        description: "Standard COCO format with annotations and categories arrays.",
        extensions: [".json"],
      };
    case "yolo":
      return {
        name: "YOLO",
        description: "YOLO format with normalized coordinates (class x_center y_center width height).",
        extensions: [".txt"],
      };
    case "csv":
      return {
        name: "CSV",
        description: "CSV format with headers (id, label, x, y, width, height, ...).",
        extensions: [".csv"],
      };
    case "auto":
      return {
        name: "Auto-detect",
        description: "Automatically detect format from file content.",
        extensions: [".json", ".txt", ".csv"],
      };
  }
}
