/**
 * Training Data Export Utility
 *
 * Exports annotated elements in various formats for ML training:
 * - COCO format (JSON with annotations)
 * - YOLO format (txt files with normalized bbox)
 * - CSV format (simple spreadsheet format)
 */

import type { AnnotatedElement } from "@/stores/extraction-annotation-store";

export type ExportFormat = "coco" | "yolo" | "csv";

export interface ExportOptions {
  format: ExportFormat;
  includeAllElements: boolean; // If false, only export ground truth
  screenshotWidth: number;
  screenshotHeight: number;
  projectName?: string;
}

interface COCOAnnotation {
  id: number;
  image_id: number;
  category_id: number;
  bbox: [number, number, number, number]; // [x, y, width, height]
  area: number;
  iscrowd: 0;
  attributes: {
    label: string;
    description?: string;
    reasoning?: string;
    isClickable?: boolean;
    confidence: number;
    isGroundTruth: boolean;
    detectionTechnique?: string;
  };
}

interface COCOCategory {
  id: number;
  name: string;
  supercategory: string;
}

interface COCOImage {
  id: number;
  width: number;
  height: number;
  file_name: string;
}

interface COCOExport {
  info: {
    description: string;
    version: string;
    year: number;
    contributor: string;
    date_created: string;
  };
  licenses: never[];
  images: COCOImage[];
  annotations: COCOAnnotation[];
  categories: COCOCategory[];
}

/**
 * Export elements to COCO format
 */
function exportToCOCO(
  elements: AnnotatedElement[],
  options: ExportOptions
): COCOExport {
  // Build unique categories from element types
  const categoryMap = new Map<string, number>();
  let categoryId = 1;

  for (const el of elements) {
    if (!categoryMap.has(el.elementType)) {
      categoryMap.set(el.elementType, categoryId++);
    }
  }

  const categories: COCOCategory[] = Array.from(categoryMap.entries()).map(
    ([name, id]) => ({
      id,
      name,
      supercategory: "ui_element",
    })
  );

  const annotations: COCOAnnotation[] = elements.map((el, idx) => ({
    id: idx + 1,
    image_id: 1,
    category_id: categoryMap.get(el.elementType) || 1,
    bbox: [el.bbox.x, el.bbox.y, el.bbox.width, el.bbox.height],
    area: el.bbox.width * el.bbox.height,
    iscrowd: 0,
    attributes: {
      label: el.label,
      description: el.description,
      reasoning: el.reasoning,
      isClickable: el.isClickable,
      confidence: el.confidence,
      isGroundTruth: el.isGroundTruth,
      detectionTechnique: el.detectionTechnique,
    },
  }));

  return {
    info: {
      description: options.projectName
        ? `${options.projectName} - UI Element Annotations`
        : "UI Element Annotations",
      version: "1.0",
      year: new Date().getFullYear(),
      contributor: "Qontinui",
      date_created: new Date().toISOString(),
    },
    licenses: [],
    images: [
      {
        id: 1,
        width: options.screenshotWidth,
        height: options.screenshotHeight,
        file_name: "screenshot.png",
      },
    ],
    annotations,
    categories,
  };
}

/**
 * Export elements to YOLO format
 * Returns array of lines in YOLO format: <class_id> <x_center> <y_center> <width> <height>
 * All values normalized to [0, 1]
 */
function exportToYOLO(
  elements: AnnotatedElement[],
  options: ExportOptions
): { annotations: string; classes: string } {
  // Build unique categories from element types
  const categoryMap = new Map<string, number>();
  let categoryId = 0;

  for (const el of elements) {
    if (!categoryMap.has(el.elementType)) {
      categoryMap.set(el.elementType, categoryId++);
    }
  }

  const lines: string[] = elements.map((el) => {
    const classId = categoryMap.get(el.elementType) || 0;

    // YOLO uses center coordinates and normalized values
    const xCenter = (el.bbox.x + el.bbox.width / 2) / options.screenshotWidth;
    const yCenter = (el.bbox.y + el.bbox.height / 2) / options.screenshotHeight;
    const width = el.bbox.width / options.screenshotWidth;
    const height = el.bbox.height / options.screenshotHeight;

    return `${classId} ${xCenter.toFixed(6)} ${yCenter.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}`;
  });

  const classes = Array.from(categoryMap.keys()).join("\n");

  return {
    annotations: lines.join("\n"),
    classes,
  };
}

/**
 * Export elements to CSV format
 */
function exportToCSV(
  elements: AnnotatedElement[],
  _options: ExportOptions
): string {
  const headers = [
    "id",
    "label",
    "element_type",
    "x",
    "y",
    "width",
    "height",
    "text",
    "description",
    "reasoning",
    "confidence",
    "is_ground_truth",
    "is_clickable",
    "detection_technique",
  ];

  const rows = elements.map((el) => [
    el.id,
    `"${(el.label || "").replace(/"/g, '""')}"`,
    el.elementType,
    el.bbox.x,
    el.bbox.y,
    el.bbox.width,
    el.bbox.height,
    `"${(el.text || "").replace(/"/g, '""')}"`,
    `"${(el.description || "").replace(/"/g, '""')}"`,
    `"${(el.reasoning || "").replace(/"/g, '""')}"`,
    el.confidence,
    el.isGroundTruth,
    el.isClickable ?? true,
    el.detectionTechnique || "",
  ]);

  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

/**
 * Main export function
 */
export function exportTrainingData(
  elements: AnnotatedElement[],
  options: ExportOptions
): { data: string | object; filename: string; mimeType: string; extra?: { filename: string; data: string } } {
  // Filter elements if needed
  const filteredElements = options.includeAllElements
    ? elements
    : elements.filter((el) => el.isGroundTruth);

  if (filteredElements.length === 0) {
    throw new Error("No elements to export. Mark some elements as ground truth or enable 'Include all elements'.");
  }

  switch (options.format) {
    case "coco": {
      const cocoData = exportToCOCO(filteredElements, options);
      return {
        data: cocoData,
        filename: "annotations.json",
        mimeType: "application/json",
      };
    }

    case "yolo": {
      const yoloData = exportToYOLO(filteredElements, options);
      return {
        data: yoloData.annotations,
        filename: "annotations.txt",
        mimeType: "text/plain",
        extra: {
          filename: "classes.txt",
          data: yoloData.classes,
        },
      };
    }

    case "csv": {
      const csvData = exportToCSV(filteredElements, options);
      return {
        data: csvData,
        filename: "annotations.csv",
        mimeType: "text/csv",
      };
    }

    default:
      throw new Error(`Unsupported export format: ${options.format}`);
  }
}

/**
 * Trigger file download in browser
 */
export function downloadExport(
  data: string | object,
  filename: string,
  mimeType: string
): void {
  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Get format display info
 */
export function getFormatInfo(format: ExportFormat): { name: string; description: string } {
  switch (format) {
    case "coco":
      return {
        name: "COCO JSON",
        description: "Standard COCO format for object detection. Compatible with most ML frameworks.",
      };
    case "yolo":
      return {
        name: "YOLO",
        description: "YOLO format with normalized coordinates. Creates annotations.txt and classes.txt.",
      };
    case "csv":
      return {
        name: "CSV",
        description: "Simple spreadsheet format. Easy to view and edit in Excel or Google Sheets.",
      };
  }
}
