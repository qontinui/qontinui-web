export class ApiConfig {
  // Main API (authentication, users, projects)
  // Use empty string to make relative URLs that go through Next.js proxy
  static readonly API_BASE_URL = '';

  // Qontinui automation API (pattern matching, state discovery, etc.)
  static readonly QONTINUI_API_URL = process.env.NEXT_PUBLIC_QONTINUI_API_URL || 'http://localhost:8001';

  // Auth endpoints (fastapi-users JWT routes)
  static readonly AUTH_LOGIN = `${ApiConfig.API_BASE_URL}/api/v1/auth/jwt/login`;
  static readonly AUTH_REGISTER = `${ApiConfig.API_BASE_URL}/api/v1/auth/register`;
  static readonly AUTH_LOGOUT = `${ApiConfig.API_BASE_URL}/api/v1/auth/jwt/logout`;
  static readonly AUTH_REFRESH = `${ApiConfig.API_BASE_URL}/api/v1/auth/jwt/refresh`;
  static readonly USERS_ME = `${ApiConfig.API_BASE_URL}/api/v1/auth/users/me`;
}
