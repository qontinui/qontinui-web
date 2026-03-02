import { useState, useEffect } from "react";
import { Screenshot } from "../../../types/Screenshot";

interface ProjectScreenshot {
  id: string;
  name: string;
  url: string;
  uploadedAt: Date;
}

export function useScreenshotSync(projectScreenshots: ProjectScreenshot[]) {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);

  useEffect(() => {
    const loadScreenshots = async () => {
      const convertedScreenshots: Screenshot[] = await Promise.all(
        projectScreenshots.map(
          (ps) =>
            new Promise<Screenshot>((resolve) => {
              const img = new window.Image();
              img.onload = () => {
                resolve({
                  id: ps.id,
                  name: ps.name,
                  imageData: ps.url,
                  width: img.width,
                  height: img.height,
                  uploadedAt: ps.uploadedAt,
                  associatedStates: [],
                  regions: [],
                  locations: [],
                });
              };
              img.onerror = () => {
                resolve({
                  id: ps.id,
                  name: ps.name,
                  imageData: ps.url,
                  width: 0,
                  height: 0,
                  uploadedAt: ps.uploadedAt,
                  associatedStates: [],
                  regions: [],
                  locations: [],
                });
              };
              img.src = ps.url;
            })
        )
      );
      setScreenshots(convertedScreenshots);
    };

    loadScreenshots();
  }, [projectScreenshots]);

  return screenshots;
}
