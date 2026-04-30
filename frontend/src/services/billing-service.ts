/**
 * OSS-side stub for BillingService.
 *
 * The full Stripe-backed BillingService lives in
 * `@qontinui/cloud-control/services/billing-service`. OSS self-host
 * installs don't expose Stripe billing — there's nothing to bill for
 * because self-host = unlimited. The stub satisfies the
 * `ServiceFactory` constructor wiring; its methods throw on use, which
 * is fine because the OSS pricing/billing routes are also absent.
 *
 * M2.5 follow-up will replace the hardcoded `BillingService` import in
 * service-factory.ts with the slot pattern (`getService("billingService")`)
 * so OSS doesn't even instantiate the stub.
 */
import type { HttpClient } from "./http-client";

export class BillingService {
  constructor(_http: HttpClient) {}

  private notAvailable(): never {
    throw new Error(
      "BillingService is only available in the cloud-control deployment"
    );
  }

  async getSubscription(): Promise<never> {
    return this.notAvailable();
  }

  async createCheckoutSession(): Promise<never> {
    return this.notAvailable();
  }

  async createPortalSession(): Promise<never> {
    return this.notAvailable();
  }

  async getUsage(): Promise<never> {
    return this.notAvailable();
  }

  async getReadOnlyMode(): Promise<never> {
    return this.notAvailable();
  }
}
