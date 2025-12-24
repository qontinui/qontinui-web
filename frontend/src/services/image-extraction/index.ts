/**
 * Image Extraction Services
 *
 * Clean, pure-function services for image extraction workflows.
 * All functions use base64 data URLs - no blob URLs or caching complexity.
 */

// Blob Service - File/Blob <-> Base64 conversion
export {
  fileToDataUrl,
  blobToDataUrl,
  dataUrlToBlob,
  dataUrlToFile,
  isValidDataUrl,
  isBlobUrl,
  getMimeTypeFromDataUrl,
  getBase64FromDataUrl,
  getImageDimensions,
  loadImage,
  estimateDataUrlSize,
  createThumbnail,
  compressImage,
} from "./blob-service";

// Composite Image Service - Multi-monitor compositing
export {
  calculateCompositeBounds,
  findMonitorAtPoint,
  createCompositeImage,
  extractRegionFromComposite,
  getPixelFromComposite,
  validateScreenshots,
  type CompositeScreenshotInput,
  type CompositeImageResult,
} from "./composite-image-service";

// Image Extraction Service - Region extraction with processing
export {
  extractFromScreenshot,
  applyMask,
  invertMask,
  isValidExtractionResult,
  getDefaultExtractionOptions,
  type ProcessingMode,
  type ExtractionOptions,
  type ExtractionResult,
} from "./image-extraction-service";
