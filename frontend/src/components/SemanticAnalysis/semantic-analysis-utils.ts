import type { SemanticObject, SemanticScene } from "@/types/semantic-analysis";

/** Object type colors used throughout the semantic analysis UI */
export const typeColors: Record<string, string> = {
  button: "#00D9FF",
  input: "#00FF88",
  label: "#FFD700",
  image: "#BD00FF",
  checkbox: "#FF6B6B",
  default: "#808080",
};

/** Get the color for an object type, falling back to the default */
export function getTypeColor(type: string): string {
  return typeColors[type] ?? typeColors.default ?? "#808080";
}

/** Parse a hex color string into RGB components */
export function parseHexColor(hex: string): {
  r: number;
  g: number;
  b: number;
} {
  const cleaned = hex.replace("#", "");
  return {
    r: parseInt(cleaned.substr(0, 2), 16),
    g: parseInt(cleaned.substr(2, 2), 16),
    b: parseInt(cleaned.substr(4, 2), 16),
  };
}

/** Count objects by type in a scene */
export function countObjectsByType(
  objects: SemanticObject[]
): Record<string, number> {
  return objects.reduce(
    (acc, obj) => {
      acc[obj.type] = (acc[obj.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
}

/** Strategy description text */
export function getStrategyDescription(
  strategy: "sam2" | "sam3" | "ocr" | "hybrid"
): string {
  switch (strategy) {
    case "sam2":
      return "Segmentation with masks";
    case "sam3":
      return "Text-prompted segmentation";
    case "ocr":
      return "Text extraction only";
    case "hybrid":
      return "Combined detection";
  }
}

/** Description model description text */
export function getDescriptionModelText(model: "clip" | "basic"): string {
  return model === "clip"
    ? "AI semantic descriptions"
    : "Rule-based CV detection";
}

/** SAM3 text prompt presets */
export const SAM3_PRESETS = [
  "Everything",
  "Button",
  "Icon",
  "Text Field",
  "Checkbox",
  "Link",
  "Menu Item",
] as const;

/** Draw bounding boxes, corner markers, masks, and labels on a canvas */
export function drawSceneOnCanvas(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  scene: SemanticScene,
  options: {
    hoveredObject: string | null;
    selectedObject: SemanticObject | null;
    showBoundingBoxes: boolean;
    showMasks: boolean;
    showLabels: boolean;
  }
): void {
  const canvas = ctx.canvas;
  canvas.width = img.width;
  canvas.height = img.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  scene.objects.forEach((obj) => {
    const isHovered = options.hoveredObject === obj.id;
    const isSelected = options.selectedObject?.id === obj.id;
    const color = getTypeColor(obj.type);

    // Draw bounding box
    if (options.showBoundingBoxes) {
      drawBoundingBox(ctx, obj, color, isHovered, isSelected);
    }

    // Draw pixel mask if available
    if (options.showMasks && obj.pixel_mask) {
      drawPixelMask(ctx, obj, color);
    }

    // Draw labels
    if (options.showLabels && (isHovered || isSelected)) {
      drawLabel(ctx, obj);
    }
  });
}

function drawBoundingBox(
  ctx: CanvasRenderingContext2D,
  obj: SemanticObject,
  color: string,
  isHovered: boolean,
  isSelected: boolean
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 3 : isHovered ? 2 : 1;

  if (isSelected && obj.pixel_mask) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  ctx.strokeRect(
    obj.bounding_box.x,
    obj.bounding_box.y,
    obj.bounding_box.width,
    obj.bounding_box.height
  );

  ctx.shadowBlur = 0;

  if (isSelected) {
    const corners = [
      { x: obj.bounding_box.x, y: obj.bounding_box.y },
      {
        x: obj.bounding_box.x + obj.bounding_box.width,
        y: obj.bounding_box.y,
      },
      {
        x: obj.bounding_box.x,
        y: obj.bounding_box.y + obj.bounding_box.height,
      },
      {
        x: obj.bounding_box.x + obj.bounding_box.width,
        y: obj.bounding_box.y + obj.bounding_box.height,
      },
    ];
    corners.forEach((corner) => {
      ctx.fillStyle = color;
      ctx.fillRect(corner.x - 3, corner.y - 3, 6, 6);
    });

    if (obj.pixel_mask) {
      ctx.fillStyle = color;
      ctx.font = "bold 10px sans-serif";
      ctx.fillText("M", obj.bounding_box.x + 2, obj.bounding_box.y - 5);
    }
  }
}

function drawPixelMask(
  ctx: CanvasRenderingContext2D,
  obj: SemanticObject,
  color: string
): void {
  if (!obj.pixel_mask) return;

  try {
    const maskImg = new Image();
    maskImg.onload = () => {
      const prevComposite = ctx.globalCompositeOperation;
      const prevAlpha = ctx.globalAlpha;

      ctx.globalAlpha = 0.3;

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = obj.bounding_box.width;
      tempCanvas.height = obj.bounding_box.height;
      const tempCtx = tempCanvas.getContext("2d");

      if (tempCtx) {
        tempCtx.drawImage(maskImg, 0, 0);

        const imageData = tempCtx.getImageData(
          0,
          0,
          tempCanvas.width,
          tempCanvas.height
        );
        const data = imageData.data;

        const { r, g, b } = parseHexColor(color);

        for (let i = 0; i < data.length; i += 4) {
          const val0 = data[i];
          const val1 = data[i + 1];
          const val2 = data[i + 2];
          if (val0 !== undefined && val1 !== undefined && val2 !== undefined) {
            if (val0 > 0 || val1 > 0 || val2 > 0) {
              data[i] = r;
              data[i + 1] = g;
              data[i + 2] = b;
              data[i + 3] = 200;
            }
          }
        }

        tempCtx.putImageData(imageData, 0, 0);

        ctx.drawImage(tempCanvas, obj.bounding_box.x, obj.bounding_box.y);
      }

      ctx.globalCompositeOperation = prevComposite;
      ctx.globalAlpha = prevAlpha;
    };

    if (!obj.pixel_mask.startsWith("data:")) {
      maskImg.src = `data:image/png;base64,${obj.pixel_mask}`;
    } else {
      maskImg.src = obj.pixel_mask;
    }
  } catch (e) {
    console.error("Error drawing mask:", e);
    ctx.fillStyle = color + "33";
    ctx.fillRect(
      obj.bounding_box.x,
      obj.bounding_box.y,
      obj.bounding_box.width,
      obj.bounding_box.height
    );
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, obj: SemanticObject): void {
  const label = obj.ocr_text || obj.type;
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillRect(
    obj.bounding_box.x,
    obj.bounding_box.y - 20,
    ctx.measureText(label).width + 8,
    20
  );
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "12px sans-serif";
  ctx.fillText(label, obj.bounding_box.x + 4, obj.bounding_box.y - 6);
}
