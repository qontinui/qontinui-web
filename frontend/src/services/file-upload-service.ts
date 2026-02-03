import { TokenManager } from "./auth/token-manager";
import { ApiConfig } from "./api-config";

export class FileUploadService {
  private tokenManager: TokenManager;
  private apiUrl: string;
  private csrfToken: string | null = null;

  constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
    this.apiUrl = ApiConfig.API_BASE_URL;
    this.initializeCSRF();
  }

  private initializeCSRF(): void {
    if (typeof window === "undefined") return;

    try {
      const metaTag = document.querySelector('meta[name="csrf-token"]');
      if (metaTag) {
        this.csrfToken = metaTag.getAttribute("content") ?? null;
      } else {
        const match = document.cookie.match(/csrf_token=([^;]+)/);
        if (match) {
          this.csrfToken = match[1] ?? null;
        }
      }
    } catch (_error) {
      console.warn("CSRF token not found");
    }
  }

  async uploadFile(
    url: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", file);

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = (e.loaded / e.total) * 100;
          onProgress(progress);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data);
          } catch {
            resolve(xhr.responseText);
          }
        } else {
          reject(new Error("Upload failed"));
        }
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Network error during upload"));
      });

      xhr.addEventListener("timeout", () => {
        reject(new Error("Upload timeout"));
      });

      xhr.open("POST", `${this.apiUrl}${url}`);

      const accessToken = this.tokenManager.getAccessToken();
      if (accessToken) {
        xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      }

      if (this.csrfToken) {
        xhr.setRequestHeader("X-CSRF-Token", this.csrfToken);
      }

      xhr.timeout = 60000; // 60 seconds for file uploads
      xhr.send(formData);
    });
  }
}
