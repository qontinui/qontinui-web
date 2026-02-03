/**
 * Training Data Export Tests
 *
 * Test coverage:
 * - COCO format export
 * - YOLO format export
 * - CSV format export
 * - Ground truth filtering
 * - Edge cases
 */

import { describe, it, expect } from "vitest";
import {
  exportTrainingData,
  getFormatInfo,
  type ExportFormat,
  type ExportOptions,
} from "./training-data-export";
import type { AnnotatedElement } from "@/stores/extraction-annotation-store";

// Helper to create mock elements
function createMockElement(
  overrides: Partial<AnnotatedElement> = {}
): AnnotatedElement {
  return {
    id: `elem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    bbox: { x: 100, y: 200, width: 50, height: 30 },
    label: "Test Element",
    elementType: "button",
    confidence: 0.95,
    isGroundTruth: true,
    isAutoDetected: false,
    ...overrides,
  };
}

// Default export options
const defaultOptions: ExportOptions = {
  format: "coco",
  includeAllElements: true,
  screenshotWidth: 1920,
  screenshotHeight: 1080,
};

describe("Training Data Export", () => {
  describe("exportTrainingData - COCO format", () => {
    it("should export elements to COCO format", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({
          id: "elem1",
          label: "Button 1",
          elementType: "button",
        }),
        createMockElement({
          id: "elem2",
          label: "Input 1",
          elementType: "input",
          bbox: { x: 300, y: 400, width: 200, height: 40 },
        }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "coco",
      });

      expect(result.filename).toBe("annotations.json");
      expect(result.mimeType).toBe("application/json");

      const data = result.data as {
        info: {
          description: string;
          version: string;
          year: number;
          contributor: string;
          date_created: string;
        };
        images: Array<{
          id: number;
          width: number;
          height: number;
          file_name: string;
        }>;
        annotations: Array<{
          id: number;
          image_id: number;
          category_id: number;
          bbox: number[];
          area: number;
          iscrowd: number;
          attributes: Record<string, unknown>;
        }>;
        categories: Array<{ id: number; name: string; supercategory: string }>;
      };

      expect(data.info).toBeDefined();
      expect(data.info.version).toBe("1.0");
      expect(data.images).toHaveLength(1);
      expect(data.images[0].width).toBe(1920);
      expect(data.images[0].height).toBe(1080);
      expect(data.annotations).toHaveLength(2);
      expect(data.categories).toHaveLength(2);
    });

    it("should create unique categories from element types", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ elementType: "button" }),
        createMockElement({ elementType: "button" }),
        createMockElement({ elementType: "input" }),
        createMockElement({ elementType: "link" }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "coco",
      });
      const data = result.data as {
        categories: Array<{ id: number; name: string; supercategory: string }>;
      };

      expect(data.categories).toHaveLength(3);
      expect(data.categories.map((c: { name: string }) => c.name)).toEqual([
        "button",
        "input",
        "link",
      ]);
    });

    it("should calculate correct bbox and area in COCO format", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ bbox: { x: 100, y: 200, width: 50, height: 30 } }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "coco",
      });
      const data = result.data as {
        annotations: Array<{ bbox: number[]; area: number }>;
      };

      expect(data.annotations[0].bbox).toEqual([100, 200, 50, 30]);
      expect(data.annotations[0].area).toBe(1500); // 50 * 30
    });

    it("should include attributes in COCO annotations", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({
          label: "Submit",
          description: "Submit button",
          reasoning: "Primary action",
          isClickable: true,
          confidence: 0.98,
          isGroundTruth: true,
          detectionTechnique: "manual",
        }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "coco",
      });
      const data = result.data as {
        annotations: Array<{ attributes: Record<string, unknown> }>;
      };

      expect(data.annotations[0].attributes.label).toBe("Submit");
      expect(data.annotations[0].attributes.description).toBe("Submit button");
      expect(data.annotations[0].attributes.reasoning).toBe("Primary action");
      expect(data.annotations[0].attributes.isClickable).toBe(true);
      expect(data.annotations[0].attributes.confidence).toBe(0.98);
      expect(data.annotations[0].attributes.isGroundTruth).toBe(true);
      expect(data.annotations[0].attributes.detectionTechnique).toBe("manual");
    });

    it("should include project name in info if provided", () => {
      const elements: AnnotatedElement[] = [createMockElement()];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "coco",
        projectName: "My Project",
      });
      const data = result.data as { info: { description: string } };

      expect(data.info.description).toContain("My Project");
    });
  });

  describe("exportTrainingData - YOLO format", () => {
    it("should export elements to YOLO format", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({
          elementType: "button",
          bbox: { x: 100, y: 200, width: 50, height: 30 },
        }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "yolo",
        screenshotWidth: 1000,
        screenshotHeight: 1000,
      });

      expect(result.filename).toBe("annotations.txt");
      expect(result.mimeType).toBe("text/plain");
      expect(typeof result.data).toBe("string");
      expect(result.extra).toBeDefined();
      expect(result.extra?.filename).toBe("classes.txt");
    });

    it("should calculate normalized YOLO coordinates", () => {
      // bbox: x=100, y=200, width=200, height=100 on 1000x1000 image
      // x_center = (100 + 200/2) / 1000 = 0.2
      // y_center = (200 + 100/2) / 1000 = 0.25
      // width = 200/1000 = 0.2
      // height = 100/1000 = 0.1
      const elements: AnnotatedElement[] = [
        createMockElement({
          elementType: "button",
          bbox: { x: 100, y: 200, width: 200, height: 100 },
        }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "yolo",
        screenshotWidth: 1000,
        screenshotHeight: 1000,
      });

      const lines = (result.data as string).split("\n");
      const parts = lines[0].split(" ");

      expect(parts[0]).toBe("0"); // class_id
      expect(parseFloat(parts[1])).toBeCloseTo(0.2, 5); // x_center
      expect(parseFloat(parts[2])).toBeCloseTo(0.25, 5); // y_center
      expect(parseFloat(parts[3])).toBeCloseTo(0.2, 5); // width
      expect(parseFloat(parts[4])).toBeCloseTo(0.1, 5); // height
    });

    it("should assign correct class IDs based on element types", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ elementType: "button" }),
        createMockElement({ elementType: "input" }),
        createMockElement({ elementType: "button" }),
        createMockElement({ elementType: "link" }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "yolo",
      });
      const lines = (result.data as string).split("\n");

      expect(lines[0].startsWith("0 ")).toBe(true); // button -> 0
      expect(lines[1].startsWith("1 ")).toBe(true); // input -> 1
      expect(lines[2].startsWith("0 ")).toBe(true); // button -> 0
      expect(lines[3].startsWith("2 ")).toBe(true); // link -> 2
    });

    it("should generate correct classes.txt content", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ elementType: "button" }),
        createMockElement({ elementType: "input" }),
        createMockElement({ elementType: "link" }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "yolo",
      });

      expect(result.extra?.data).toBe("button\ninput\nlink");
    });
  });

  describe("exportTrainingData - CSV format", () => {
    it("should export elements to CSV format", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({
          id: "elem1",
          label: "Submit Button",
          elementType: "button",
          bbox: { x: 100, y: 200, width: 80, height: 30 },
        }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "csv",
      });

      expect(result.filename).toBe("annotations.csv");
      expect(result.mimeType).toBe("text/csv");
      expect(typeof result.data).toBe("string");
    });

    it("should include all expected columns in CSV", () => {
      const elements: AnnotatedElement[] = [createMockElement()];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "csv",
      });
      const lines = (result.data as string).split("\n");
      const headers = lines[0].split(",");

      expect(headers).toContain("id");
      expect(headers).toContain("label");
      expect(headers).toContain("element_type");
      expect(headers).toContain("x");
      expect(headers).toContain("y");
      expect(headers).toContain("width");
      expect(headers).toContain("height");
      expect(headers).toContain("text");
      expect(headers).toContain("description");
      expect(headers).toContain("reasoning");
      expect(headers).toContain("confidence");
      expect(headers).toContain("is_ground_truth");
      expect(headers).toContain("is_clickable");
      expect(headers).toContain("detection_technique");
    });

    it("should escape quotes in CSV values", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ label: 'Say "Hello"' }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "csv",
      });
      const csvContent = result.data as string;

      // The label should be quoted and internal quotes should be doubled
      expect(csvContent).toContain('"Say ""Hello"""');
    });

    it("should handle text with commas in CSV", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ description: "First, second, third" }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "csv",
      });
      const csvContent = result.data as string;

      expect(csvContent).toContain('"First, second, third"');
    });

    it("should handle empty optional fields in CSV", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({
          text: undefined,
          description: undefined,
          reasoning: undefined,
          detectionTechnique: undefined,
        }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "csv",
      });
      const lines = (result.data as string).split("\n");

      // Should have valid CSV with empty values
      expect(lines.length).toBe(2); // header + 1 data row
    });

    it("should output correct boolean values in CSV", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ isGroundTruth: true, isClickable: false }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "csv",
      });
      const csvContent = result.data as string;

      expect(csvContent).toContain(",true,");
      expect(csvContent).toContain(",false,");
    });
  });

  describe("exportTrainingData - Ground Truth Filtering", () => {
    it("should filter to only ground truth elements when includeAllElements is false", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ label: "GT 1", isGroundTruth: true }),
        createMockElement({ label: "Non-GT", isGroundTruth: false }),
        createMockElement({ label: "GT 2", isGroundTruth: true }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "coco",
        includeAllElements: false,
      });
      const data = result.data as {
        annotations: Array<{ attributes: { label: string } }>;
      };

      expect(data.annotations).toHaveLength(2);
      expect(data.annotations.map((a) => a.attributes.label)).toEqual([
        "GT 1",
        "GT 2",
      ]);
    });

    it("should include all elements when includeAllElements is true", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ isGroundTruth: true }),
        createMockElement({ isGroundTruth: false }),
        createMockElement({ isGroundTruth: true }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "coco",
        includeAllElements: true,
      });
      const data = result.data as { annotations: unknown[] };

      expect(data.annotations).toHaveLength(3);
    });

    it("should throw error when filtering results in zero elements", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ isGroundTruth: false }),
        createMockElement({ isGroundTruth: false }),
      ];

      expect(() =>
        exportTrainingData(elements, {
          ...defaultOptions,
          format: "coco",
          includeAllElements: false,
        })
      ).toThrow("No elements to export");
    });
  });

  describe("exportTrainingData - Error Handling", () => {
    it("should throw error for empty elements array", () => {
      expect(() => exportTrainingData([], defaultOptions)).toThrow(
        "No elements to export"
      );
    });

    it("should throw error for unsupported format", () => {
      const elements: AnnotatedElement[] = [createMockElement()];

      expect(() =>
        exportTrainingData(elements, {
          ...defaultOptions,
          format: "unknown" as ExportFormat,
        })
      ).toThrow("Unsupported export format: unknown");
    });
  });

  describe("getFormatInfo", () => {
    it("should return correct info for COCO format", () => {
      const info = getFormatInfo("coco");

      expect(info.name).toBe("COCO JSON");
      expect(info.description).toContain("COCO");
      expect(info.description).toContain("object detection");
    });

    it("should return correct info for YOLO format", () => {
      const info = getFormatInfo("yolo");

      expect(info.name).toBe("YOLO");
      expect(info.description).toContain("YOLO");
      expect(info.description).toContain("normalized");
    });

    it("should return correct info for CSV format", () => {
      const info = getFormatInfo("csv");

      expect(info.name).toBe("CSV");
      expect(info.description).toContain("spreadsheet");
    });
  });

  describe("Edge Cases", () => {
    it("should handle elements with zero dimensions", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ bbox: { x: 100, y: 200, width: 0, height: 0 } }),
      ];

      // Should not throw for any format
      expect(() =>
        exportTrainingData(elements, { ...defaultOptions, format: "coco" })
      ).not.toThrow();
      expect(() =>
        exportTrainingData(elements, { ...defaultOptions, format: "yolo" })
      ).not.toThrow();
      expect(() =>
        exportTrainingData(elements, { ...defaultOptions, format: "csv" })
      ).not.toThrow();
    });

    it("should handle very large bounding box values", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({
          bbox: { x: 0, y: 0, width: 100000, height: 100000 },
        }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "coco",
      });
      const data = result.data as { annotations: Array<{ bbox: number[] }> };

      expect(data.annotations[0].bbox).toEqual([0, 0, 100000, 100000]);
    });

    it("should handle special characters in labels and descriptions", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({
          label: "<script>alert('xss')</script>",
          description: "Line1\nLine2\tTab",
        }),
      ];

      // Should not throw
      expect(() =>
        exportTrainingData(elements, { ...defaultOptions, format: "csv" })
      ).not.toThrow();
      expect(() =>
        exportTrainingData(elements, { ...defaultOptions, format: "coco" })
      ).not.toThrow();
    });

    it("should handle many elements efficiently", () => {
      const elements: AnnotatedElement[] = Array.from(
        { length: 1000 },
        (_, i) =>
          createMockElement({
            id: `elem${i}`,
            label: `Element ${i}`,
            elementType: i % 2 === 0 ? "button" : "input",
          })
      );

      const startTime = Date.now();
      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "coco",
      });
      const duration = Date.now() - startTime;

      expect(
        (result.data as { annotations: unknown[] }).annotations
      ).toHaveLength(1000);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });

    it("should assign sequential IDs to COCO annotations", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ id: "custom-id-1" }),
        createMockElement({ id: "custom-id-2" }),
        createMockElement({ id: "custom-id-3" }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "coco",
      });
      const data = result.data as { annotations: Array<{ id: number }> };

      expect(data.annotations.map((a) => a.id)).toEqual([1, 2, 3]);
    });

    it("should set iscrowd to 0 for all COCO annotations", () => {
      const elements: AnnotatedElement[] = [
        createMockElement(),
        createMockElement(),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "coco",
      });
      const data = result.data as { annotations: Array<{ iscrowd: number }> };

      expect(data.annotations.every((a) => a.iscrowd === 0)).toBe(true);
    });

    it("should set image_id to 1 for all COCO annotations", () => {
      const elements: AnnotatedElement[] = [
        createMockElement(),
        createMockElement(),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "coco",
      });
      const data = result.data as { annotations: Array<{ image_id: number }> };

      expect(data.annotations.every((a) => a.image_id === 1)).toBe(true);
    });

    it("should handle undefined isClickable in CSV export", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ isClickable: undefined }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "csv",
      });
      const csvContent = result.data as string;

      // Should default to true when undefined
      expect(csvContent).toContain(",true,");
    });

    it("should format YOLO coordinates with 6 decimal places", () => {
      const elements: AnnotatedElement[] = [
        createMockElement({ bbox: { x: 100, y: 200, width: 50, height: 30 } }),
      ];

      const result = exportTrainingData(elements, {
        ...defaultOptions,
        format: "yolo",
        screenshotWidth: 1920,
        screenshotHeight: 1080,
      });

      const line = (result.data as string).split("\n")[0];
      const parts = line.split(" ");

      // Each numeric value should have 6 decimal places
      parts.slice(1).forEach((part) => {
        const decimalPart = part.split(".")[1];
        expect(decimalPart?.length).toBe(6);
      });
    });
  });
});
