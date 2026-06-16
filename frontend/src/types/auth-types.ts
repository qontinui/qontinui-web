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
  /**
   * True iff the user can mutate the coordination layer (coord tenant admin).
   * Backend-derived on `GET /auth/users/me`. Distinct from `is_superuser`
   * (platform-wide admin): a tenant member may VIEW the AI-Dev coord pages
   * without holding this flag, but mutation controls are gated on it.
   */
  coord_is_admin?: boolean | null;
  /**
   * Derived account-tier label. "administrator" iff `coord_is_admin`, else
   * "developer" (when a tenant resolved), else null. ("viewer" is reserved.)
   */
  account_type?: "administrator" | "developer" | "viewer" | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number; // Seconds until access token expires
  refresh_expires_in: number; // Seconds until refresh token expires
}
