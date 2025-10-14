export class ApiConfig {
  // Main API (authentication, users, projects)
  static readonly API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // Qontinui automation API (pattern matching, state discovery, etc.)
  static readonly QONTINUI_API_URL = process.env.NEXT_PUBLIC_QONTINUI_API_URL || 'http://localhost:8001';

  // Auth endpoints
  static readonly AUTH_LOGIN = `${ApiConfig.API_BASE_URL}/api/v1/auth/login`;
  static readonly AUTH_REGISTER = `${ApiConfig.API_BASE_URL}/api/v1/auth/register`;
  static readonly AUTH_LOGOUT = `${ApiConfig.API_BASE_URL}/api/v1/auth/logout`;
  static readonly AUTH_REFRESH = `${ApiConfig.API_BASE_URL}/api/v1/auth/refresh`;
  static readonly USERS_ME = `${ApiConfig.API_BASE_URL}/api/v1/users/me`;
}
