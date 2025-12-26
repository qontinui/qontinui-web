/**
 * Image Repository
 *
 * Handles persistence for ImageAsset entities.
 */

import { BaseRepository } from "./base-repository";
import type { ImageAsset } from "@/contexts/automation-context/types";

/**
 * ImageAsset with project context (ImageAsset already has optional projectName)
 */
export type ImageWithProject = ImageAsset & { projectName: string };

/**
 * Repository for image persistence
 */
class ImageRepositoryImpl extends BaseRepository<ImageWithProject> {
  protected readonly storeName = "images";

  /**
   * Update projectName for all images in a project (for rename operations)
   */
  async renameProject(
    oldProjectName: string,
    newProjectName: string
  ): Promise<void> {
    const images = await this.getByProject(oldProjectName);
    await Promise.all(
      images.map((image) =>
        this.update({ ...image, projectName: newProjectName })
      )
    );
  }

  /**
   * Get images by source type
   */
  async getBySource(
    projectName: string,
    source: ImageAsset["source"]
  ): Promise<ImageWithProject[]> {
    const images = await this.getByProject(projectName);
    return images.filter((image) => image.source === source);
  }

  /**
   * Update usage count for an image
   */
  async incrementUsageCount(id: string): Promise<void> {
    const image = await this.getById(id);
    if (image) {
      await this.update({ ...image, usageCount: (image.usageCount || 0) + 1 });
    }
  }

  /**
   * Decrement usage count for an image
   */
  async decrementUsageCount(id: string): Promise<void> {
    const image = await this.getById(id);
    if (image) {
      await this.update({
        ...image,
        usageCount: Math.max(0, (image.usageCount || 0) - 1),
      });
    }
  }
}

// Export singleton instance
export const imageRepository = new ImageRepositoryImpl();
