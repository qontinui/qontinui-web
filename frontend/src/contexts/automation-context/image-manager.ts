import { ImageAsset, ImageUsage } from "./types";

export class ImageManager {
  static addImage(images: ImageAsset[], newImage: ImageAsset): ImageAsset[] {
    return [...images, newImage];
  }

  static deleteImage(images: ImageAsset[], imageId: string): ImageAsset[] {
    return images.filter((img) => img.id !== imageId);
  }

  static updateImageUsage(
    images: ImageAsset[],
    imageId: string,
    usage: ImageUsage
  ): ImageAsset[] {
    return images.map((img) => {
      if (img.id === imageId) {
        const existingUsage = img.usage?.find((u) => u.id === usage.id);
        const newUsage = existingUsage
          ? img.usage!.map((u) => (u.id === usage.id ? usage : u))
          : [...(img.usage || []), usage];

        return {
          ...img,
          usage: newUsage,
          usageCount: newUsage.length,
        };
      }
      return img;
    });
  }

  static removeImageUsage(
    images: ImageAsset[],
    imageId: string,
    usageId: string
  ): ImageAsset[] {
    return images.map((img) => {
      if (img.id === imageId) {
        const newUsage = (img.usage || []).filter((u) => u.id !== usageId);
        return {
          ...img,
          usage: newUsage,
          usageCount: newUsage.length,
        };
      }
      return img;
    });
  }
}
