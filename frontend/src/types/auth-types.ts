export interface UserPreferences {
  product_mode?: "ai" | "visual";
  [key: string]: unknown;
}

export interface User {
  id: string; // UUID format
  email: string;
  username: string;
  full_name?: string;
  company?: string;
  phone?: string;
  is_active: boolean;
  is_superuser: boolean;
  is_beta?: boolean;
  preferences?: UserPreferences | null;
  created_at: string;
  updated_at: string;
  tenant_id?: string | null;
  tenant_slug?: string | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number; // Seconds until access token expires
  refresh_expires_in: number; // Seconds until refresh token expires
}
