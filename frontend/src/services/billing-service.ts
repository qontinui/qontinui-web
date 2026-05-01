/**
 * OSS-side type contract for `BillingService`.
 *
 * No runtime class — OSS doesn't instantiate a billing service. The real
 * Stripe-backed implementation lives in
 * `@qontinui/cloud-control/services/billing-service` and is registered into
 * the `getService("billingService")` slot by cloud-control's `index.ts` via
 * `registerCloudExtensions`. The exported `billingService` symbol from
 * `services/service-factory.ts` is a Proxy that forwards method calls to
 * that slot at access time; in OSS-only builds the Proxy throws on use.
 *
 * Methods listed here are the union of what cloud-control's class exposes
 * and what consumers (in OSS or cloud-control) actually call. Loose
 * `Promise<any>` return types match the historical OSS stub so callers
 * compile without mass adoption changes.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface BillingService {
  getSubscription(): Promise<any>;
  createCheckoutSession(...args: any[]): Promise<any>;
  createPortalSession(): Promise<any>;
  createBillingPortal(): Promise<any>;
  getUsage(): Promise<any>;
  getReadOnlyMode(): Promise<any>;
  getTierLimits(): Promise<any>;
  redirectToCheckout(...args: any[]): Promise<any>;
  redirectToBillingPortal(): Promise<any>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
