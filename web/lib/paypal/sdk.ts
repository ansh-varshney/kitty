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
    timeout: 30_000,
    clientCredentialsAuthCredentials: {
      oAuthClientId: PAYPAL_CLIENT_ID,
      oAuthClientSecret: PAYPAL_CLIENT_SECRET,
    },
    httpClientOptions: { retryConfig: { maxNumberOfRetries: 2 } },
  });
  return client;
}

export const orders = () => new OrdersController(paypalClient());
export const payments = () => new PaymentsController(paypalClient());
export const subscriptions = () => new SubscriptionsController(paypalClient());
