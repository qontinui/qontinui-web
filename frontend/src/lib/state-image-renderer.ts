/**
 * StateImage Renderer
 * Modular class for rendering StateImages with different display modes
 */

export type RenderMode =
  | "normal"
  | "with-mask"
  | "mask-only"
  | "no-transparency";

export interface StateImageData {
  image: string; // Base64 data URL
  mask?: string; // Base64 data URL
}

export interface RenderOptions {
  mode: RenderMode;
  width?: number;
  height?: number;
}

export class StateImageRenderer {
  private imageElement: HTMLImageElement | null = null;
  private maskElement: HTMLImageElement | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context");
    }
    this.ctx = ctx;
  }

  /**
   * Load image and mask data
   */
  async load(data: StateImageData): Promise<void> {
    // Load main image
    this.imageElement = await this.loadImage(data.image);

    // Load mask if provided
    if (data.mask) {
      try {
        this.maskElement = await this.loadImage(data.mask);
        console.log("[StateImageRenderer] Loaded image and mask:", {
          imageSize: `${this.imageElement.width}x${this.imageElement.height}`,
          maskSize: `${this.maskElement.width}x${this.maskElement.height}`,
        });
      } catch (error) {
        console.warn("[StateImageRenderer] Failed to load mask:", error);
        this.maskElement = null;
      }
    }
  }

  /**
   * Render to canvas with specified mode
   */
  render(mode: RenderMode = "normal"): HTMLCanvasElement {
    if (!this.imageElement) {
      throw new Error("No image loaded. Call load() first.");
    }

    const width = this.imageElement.width;
    const height = this.imageElement.height;

    this.canvas.width = width;
    this.canvas.height = height;

    // Clear canvas
    this.ctx.clearRect(0, 0, width, height);

    switch (mode) {
      case "normal":
        this.renderNormal();
        break;
      case "with-mask":
        this.renderWithMask();
        break;
      case "mask-only":
        this.renderMaskOnly();
        break;
      case "no-transparency":
        this.renderNoTransparency();
        break;
    }

    return this.canvas;
  }

  /**
   * Get canvas as data URL
   */
  toDataURL(type: string = "image/png"): string {
    return this.canvas.toDataURL(type);
  }

  /**
   * Get image dimensions
   */
  getDimensions(): { width: number; height: number } | null {
    if (!this.imageElement) return null;
    return {
      width: this.imageElement.width,
      height: this.imageElement.height,
    };
  }

  /**
   * Check if mask is available
   */
  hasMask(): boolean {
    return this.maskElement !== null;
  }

  /**
   * Render image normally (preserving any built-in transparency)
   */
  private renderNormal(): void {
    if (!this.imageElement) return;
    this.ctx.drawImage(this.imageElement, 0, 0);
  }

  /**
   * Render image with mask applied to alpha channel
   */
  private renderWithMask(): void {
    if (!this.imageElement) return;

    // If no mask, just render normally
    if (!this.maskElement) {
      this.renderNormal();
      return;
    }

    const width = this.imageElement.width;
    const height = this.imageElement.height;

    // Draw main image
    this.ctx.drawImage(this.imageElement, 0, 0);

    // Get image data
    const imageData = this.ctx.getImageData(0, 0, width, height);

    // Draw mask to temporary canvas to get its pixel data
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = this.maskElement.width;
    maskCanvas.height = this.maskElement.height;
    const maskCtx = maskCanvas.getContext("2d");

    if (!maskCtx) {
      console.warn("[StateImageRenderer] Could not get mask context");
      return;
    }

    maskCtx.drawImage(this.maskElement, 0, 0);
    const maskData = maskCtx.getImageData(
      0,
      0,
      maskCanvas.width,
      maskCanvas.height
    );

    // Apply mask to alpha channel
    // White pixels in mask (255) = keep visible
    // Black pixels in mask (0) = make transparent
    const imagePixels = imageData.data.length / 4;
    const maskPixels = maskData.data.length / 4;

    console.log("[StateImageRenderer] Applying mask:", {
      imagePixels,
      maskPixels,
    });

    // Sample first few mask values for debugging
    const sampleMaskValues = [];
    for (let i = 0; i < Math.min(10, maskPixels); i++) {
      sampleMaskValues.push(maskData.data[i * 4]);
    }
    console.log(
      "[StateImageRenderer] Sample mask values (should be 0 or 255):",
      sampleMaskValues
    );

    for (let i = 0; i < imageData.data.length; i += 4) {
      // Use red channel of mask as alpha multiplier (grayscale mask)
      const maskValue = maskData.data[i] / 255; // Normalize to 0-1
      const currentAlpha = imageData.data[i + 3];

      // Multiply current alpha by mask value
      imageData.data[i + 3] = currentAlpha * maskValue;
    }

    // Put processed image data back
    this.ctx.putImageData(imageData, 0, 0);
    console.log("[StateImageRenderer] Mask applied successfully");
  }

  /**
   * Render only the mask
   */
  private renderMaskOnly(): void {
    if (!this.maskElement) {
      // No mask, show empty canvas
      const width = this.imageElement?.width || 100;
      const height = this.imageElement?.height || 100;
      this.ctx.fillStyle = "#000000";
      this.ctx.fillRect(0, 0, width, height);
      return;
    }

    this.ctx.drawImage(this.maskElement, 0, 0);
  }

  /**
   * Render image with all transparency removed (alpha = 255)
   */
  private renderNoTransparency(): void {
    if (!this.imageElement) return;

    const width = this.imageElement.width;
    const height = this.imageElement.height;

    // Draw image
    this.ctx.drawImage(this.imageElement, 0, 0);

    // Get image data and force all alpha to 255
    const imageData = this.ctx.getImageData(0, 0, width, height);

    for (let i = 0; i < imageData.data.length; i += 4) {
      imageData.data[i + 3] = 255; // Set alpha to fully opaque
    }

    this.ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Load an image from data URL
   */
  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error(`Failed to load image: ${e}`));
      img.src = src;
    });
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.imageElement = null;
    this.maskElement = null;
  }
}
