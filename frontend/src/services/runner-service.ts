import { HttpClient } from './http-client';
import { ApiConfig } from './api-config';
import type {
  RunnerToken,
  RunnerTokenWithSecret,
  RunnerConnection,
  ConnectionHistoryParams,
  ConnectionHistoryResponse,
  CreateTokenRequest,
  ConnectionInfo,
  TestConnectionResponse
} from '@/types/runner';

/**
 * RunnerService - Handles desktop runner token management and connection tracking
 */
export class RunnerService {
  private httpClient: HttpClient;
  private baseUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    // Always use relative URLs for browser requests - they go through Next.js proxy
    // which handles CORS and forwards to the backend
    this.baseUrl = '/api/v1';
  }

  /**
   * Token Management
   */

  async createToken(name: string, expiresInDays?: number | null): Promise<RunnerTokenWithSecret> {
    const body: CreateTokenRequest = {
      name,
      expires_in_days: expiresInDays
    };

    const response = await this.httpClient.fetch(
      `${this.baseUrl}/runners/tokens`,
      {
        method: 'POST',
        body: JSON.stringify(body)
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to create token' }));
      throw new Error(error.detail || 'Failed to create token');
    }

    return response.json();
  }

  async listTokens(): Promise<RunnerToken[]> {
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/runners/tokens`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch runner tokens');
    }

    return response.json();
  }

  async revokeToken(tokenId: string): Promise<void> {
    // Soft delete - marks token as revoked but keeps it in database
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/runners/tokens/${tokenId}`,
      {
        method: 'DELETE'
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to revoke token' }));
      throw new Error(error.detail || 'Failed to revoke token');
    }
  }

  async deleteToken(tokenId: string): Promise<void> {
    // Hard delete - permanently removes token and its connection history
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/runners/tokens/${tokenId}/permanent`,
      {
        method: 'DELETE'
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to delete token' }));
      throw new Error(error.detail || 'Failed to delete token');
    }
  }

  /**
   * Connection Management
   */

  async getActiveConnections(): Promise<RunnerConnection[]> {
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/runners/connections/active`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch active connections');
    }

    return response.json();
  }

  async getConnectionHistory(params: ConnectionHistoryParams = {}): Promise<ConnectionHistoryResponse> {
    const queryParams = new URLSearchParams();

    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.offset) queryParams.append('offset', params.offset.toString());
    if (params.search) queryParams.append('search', params.search);
    if (params.start_date) queryParams.append('start_date', params.start_date);
    if (params.end_date) queryParams.append('end_date', params.end_date);

    const url = `${this.baseUrl}/runners/connections?${queryParams.toString()}`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error('Failed to fetch connection history');
    }

    return response.json();
  }

  async disconnectRunner(connectionId: number): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/runners/connections/${connectionId}/disconnect`,
      {
        method: 'POST'
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to disconnect runner' }));
      throw new Error(error.detail || 'Failed to disconnect runner');
    }
  }

  /**
   * Connection Info
   * Enhanced to support creating dedicated runner tokens
   */

  async getConnectionInfo(
    createToken?: boolean,
    tokenName?: string,
    expiresInDays?: number | null
  ): Promise<ConnectionInfo> {
    const queryParams = new URLSearchParams();

    if (createToken) {
      queryParams.append('create_token', 'true');
      if (tokenName) queryParams.append('token_name', tokenName);
      if (expiresInDays) queryParams.append('expires_in_days', expiresInDays.toString());
    }

    const url = `${this.baseUrl}/users/me/connection-info${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error('Failed to fetch connection info');
    }

    return response.json();
  }

  /**
   * Get token by ID
   */
  async getToken(tokenId: string): Promise<RunnerToken> {
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/runners/tokens/${tokenId}`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch token');
    }

    return response.json();
  }

  /**
   * Get connections for a specific token
   */
  async getTokenConnections(tokenId: string, params: ConnectionHistoryParams = {}): Promise<ConnectionHistoryResponse> {
    const queryParams = new URLSearchParams();

    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.offset) queryParams.append('offset', params.offset.toString());

    const url = `${this.baseUrl}/runners/tokens/${tokenId}/connections?${queryParams.toString()}`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error('Failed to fetch token connections');
    }

    return response.json();
  }

  /**
   * Test a runner connection
   * Called by the desktop runner when Quick Connect saves settings
   */
  async testConnection(token: string): Promise<TestConnectionResponse> {
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/runners/test-connection?token=${encodeURIComponent(token)}`,
      {
        method: 'POST'
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Connection test failed' }));
      throw new Error(error.detail || 'Connection test failed');
    }

    return response.json();
  }
}
