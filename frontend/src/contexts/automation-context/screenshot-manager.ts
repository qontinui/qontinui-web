import { Screenshot } from './types'

export class ScreenshotManager {
  static addScreenshot(screenshots: Screenshot[], screenshot: Screenshot): Screenshot[] {
    return [...screenshots, screenshot]
  }

  static updateScreenshot(screenshots: Screenshot[], screenshot: Screenshot): Screenshot[] {
    return screenshots.map(s => s.id === screenshot.id ? screenshot : s)
  }

  static deleteScreenshot(screenshots: Screenshot[], screenshotId: string): Screenshot[] {
    return screenshots.filter(s => s.id !== screenshotId)
  }
}
