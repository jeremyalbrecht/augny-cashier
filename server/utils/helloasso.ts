import type { H3Event } from "h3";

// HelloAsso Checkout API client. Docs: https://dev.helloasso.com
//
// Auth is OAuth2 client_credentials against /oauth2/token. The access token
// is valid 30 min — rather than juggling the 1-month refresh token, we just
// re-request via client_credentials whenever the cached token expires.
//
// A checkout-intent's `redirectUrl` is only valid for 15 minutes, so it must
// never be embedded statically (e.g. in an email sent well before it's
// clicked). Callers should create the intent at click time — see
// server/routes/pay/[name].get.ts.

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

function baseUrl(sandbox: boolean): string {
  return sandbox ? "https://api.helloasso-sandbox.com" : "https://api.helloasso.com";
}

async function fetchAccessToken(event: H3Event): Promise<string> {
  const { helloasso } = useRuntimeConfig(event);
  const clientId = helloasso.clientId as string;
  const clientSecret = helloasso.clientSecret as string;
  const sandbox = helloasso.sandbox === "true" || helloasso.sandbox === true;

  const res = await fetch(`${baseUrl(sandbox)}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`HelloAsso token request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  // 60s safety margin so we don't hand out a token that expires mid-request.
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.token;
}

export async function getAccessToken(event: H3Event): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  return fetchAccessToken(event);
}

export interface CreateCheckoutIntentInput {
  amountCents: number;
  itemName: string;
  backUrl: string;
  errorUrl: string;
  returnUrl: string;
}

export interface CheckoutIntent {
  id: number;
  redirectUrl: string;
}

export async function createCheckoutIntent(
  event: H3Event,
  input: CreateCheckoutIntentInput,
): Promise<CheckoutIntent> {
  const { helloasso } = useRuntimeConfig(event);
  const sandbox = helloasso.sandbox === "true" || helloasso.sandbox === true;
  const organizationSlug = process.env.HELLOASSO_ORGANIZATION_SLUG || "";

  const token = await getAccessToken(event);
  const res = await fetch(`${baseUrl(sandbox)}/v5/organizations/${organizationSlug}/checkout-intents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      totalAmount: input.amountCents,
      initialAmount: input.amountCents,
      itemName: input.itemName,
      backUrl: input.backUrl,
      errorUrl: input.errorUrl,
      returnUrl: input.returnUrl,
      containsDonation: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`HelloAsso checkout-intent creation failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as CheckoutIntent;
}
