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
  created_at: string;
  updated_at: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  remember_me?: boolean;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  full_name?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number; // Seconds until access token expires
  refresh_expires_in: number; // Seconds until refresh token expires
}
