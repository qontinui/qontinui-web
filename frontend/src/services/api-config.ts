export class ApiConfig {
  static readonly API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
  static readonly QONTINUI_API_URL = process.env.NEXT_PUBLIC_QONTINUI_API_URL || 'http://localhost:8000';
}
