import { useState, useEffect } from "react";

export function useScreenshotThumbnails(screenshots: File[]) {
  const [thumbnails, setThumbnails] = useState<{ [key: string]: string }>({});

  // Generate thumbnails for uploaded files
  useEffect(() => {
    const generateThumbnails = async () => {
      const newThumbnails: { [key: string]: string } = {};

      for (const file of screenshots) {
        if (file.type.startsWith("image/")) {
          try {
            // Create a unique key for this file
            const key = `${file.name}_${file.size}_${file.lastModified}`;

            // Check if we already have this thumbnail
            if (thumbnails[key]) {
              newThumbnails[key] = thumbnails[key];
              continue;
            }

            // Create object URL for the image
            const url = URL.createObjectURL(file);
            newThumbnails[key] = url;
          } catch (error) {
            console.error("Failed to generate thumbnail:", error);
          }
        }
      }

      // Clean up old URLs that are no longer needed
      Object.entries(thumbnails).forEach(([key, url]) => {
        if (!newThumbnails[key]) {
          URL.revokeObjectURL(url);
        }
      });

      setThumbnails(newThumbnails);
    };

    generateThumbnails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshots]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      // Revoke all object URLs when component unmounts
      Object.values(thumbnails).forEach((url) => {
        URL.revokeObjectURL(url);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getThumbnailUrl = (file: File): string | undefined => {
    const key = `${file.name}_${file.size}_${file.lastModified}`;
    return thumbnails[key];
  };

  return { thumbnails, getThumbnailUrl };
}
