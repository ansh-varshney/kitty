import {
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  SubscriptionsController,
} from "@paypal/paypal-server-sdk";
import { env } from "../env";

/**
 * PayPal Server SDK (APIMatic-generated, sponsor) for Orders, Payments and Subscriptions.
 * Controllers are constructed by us, not accessed off the client (see the SDK's typescript skills).
 */
let client: Client | undefined;

export function paypalClient(): Client {
  if (client) return client;
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = env();
  client = new Client({
    environment: Environment.Sandbox,
    timeout: 15_000, // per attempt
    clientCredentialsAuthCredentials: {
      oAuthClientId: PAYPAL_CLIENT_ID,
      oAuthClientSecret: PAYPAL_CLIENT_SECRET,
    },
    // The generated defaults retry nothing (maximumRetryWaitTime 0) and never retry POST. Every money call here
    // sends its own PayPal-Request-Id, which the SDK reuses on retry, so retrying POST can't double-charge.
    // Phase 1 finding: one 30 s sandbox stall killed a whole run.
    httpClientOptions: {
      timeout: 15_000,
      retryConfig: {
        maxNumberOfRetries: 2,
        retryInterval: 1,
        backoffFactor: 2,
        maximumRetryWaitTime: 20,
        retryOnTimeout: true,
        httpMethodsToRetry: ["GET", "PUT", "POST"],
      },
    },
  });
  return client;
}

export const orders = () => new OrdersController(paypalClient());
export const payments = () => new PaymentsController(paypalClient());
export const subscriptions = () => new SubscriptionsController(paypalClient());
