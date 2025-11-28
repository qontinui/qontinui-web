import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";

export interface Subscription {
  tier: "free" | "hobby" | "pro";
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  stripe_status?: string;
}

export interface CheckoutSession {
  session_id: string;
  url: string;
}

export interface BillingPortal {
  url: string;
}

export interface TierLimits {
  tier: string;
  max_configs: number;
  max_images: number;
  max_storage_mb: number;
}

class BillingService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  /**
   * Get current user's subscription details
   */
  async getSubscription(): Promise<Subscription> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/billing/subscription`
    );
    if (!response.ok) {
      throw new Error("Failed to get subscription");
    }
    return response.json();
  }

  /**
   * Create a Stripe checkout session
   */
  async createCheckoutSession(tier: "hobby" | "pro"): Promise<CheckoutSession> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/billing/checkout`,
      {
        method: "POST",
        body: JSON.stringify({ tier }),
      }
    );
    if (!response.ok) {
      throw new Error("Failed to create checkout session");
    }
    return response.json();
  }

  /**
   * Create a billing portal session for subscription management
   */
  async createBillingPortal(): Promise<BillingPortal> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/billing/portal`,
      {
        method: "POST",
      }
    );
    if (!response.ok) {
      throw new Error("Failed to create billing portal session");
    }
    return response.json();
  }

  /**
   * Get tier limits for current user
   */
  async getTierLimits(): Promise<TierLimits> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/billing/limits`
    );
    if (!response.ok) {
      throw new Error("Failed to get tier limits");
    }
    return response.json();
  }

  /**
   * Redirect to checkout
   */
  async redirectToCheckout(tier: "hobby" | "pro"): Promise<void> {
    const session = await this.createCheckoutSession(tier);
    window.location.href = session.url;
  }

  /**
   * Redirect to billing portal
   */
  async redirectToBillingPortal(): Promise<void> {
    const portal = await this.createBillingPortal();
    window.location.href = portal.url;
  }
}

// Export as singleton - will be initialized in service-factory
export { BillingService };
