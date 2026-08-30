/**
 * Mints Google-signed ID tokens for the CaseRelay control plane (Cloud Run).
 *
 * This module runs ONLY on the Next.js server. No credential ever reaches
 * the client bundle.
 *
 * Token strategy (checked in order):
 *  1. GCP_WORKLOAD_IDENTITY_POOL_ID present → Vercel OIDC → GCP STS → SA
 *     impersonation → generateIdToken.  No long-lived secret required.
 *  2. https:// URL + CONTROL_PLANE_SA → impersonate that service account via
 *     IAM generateIdToken (uses ADC + iam.serviceAccountTokenCreator).
 *  3. https:// URL, no SA → ADC directly (GCE / Cloud Run / CI where ADC is
 *     already a service account).
 *  4. http:// URL → local dev against a local backend; skip auth entirely.
 */

import { ExternalAccountClient, GoogleAuth } from "google-auth-library";

const auth = new GoogleAuth();

function url(): string {
  const v = process.env.CONTROL_PLANE_URL;
  if (!v) throw new Error("CONTROL_PLANE_URL is not set");
  return v;
}

/**
 * Mint an ID token via Workload Identity Federation using the Vercel OIDC
 * token as the subject credential.  The flow is:
 *
 *   Vercel OIDC JWT → GCP STS (federated token) → SA impersonation
 *   (access token) → iamcredentials generateIdToken (Cloud Run ID token)
 *
 * Required env vars (set in Vercel dashboard):
 *   GCP_PROJECT_NUMBER, GCP_WORKLOAD_IDENTITY_POOL_ID,
 *   GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID, GCP_SERVICE_ACCOUNT_EMAIL
 */
async function mintViaWorkloadIdentity(audience: string): Promise<string> {
  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const saEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;

  if (!projectNumber || !poolId || !providerId || !saEmail) {
    throw new Error(
      "WIF requires GCP_PROJECT_NUMBER, GCP_WORKLOAD_IDENTITY_POOL_ID, " +
        "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID, and GCP_SERVICE_ACCOUNT_EMAIL",
    );
  }

  const { getVercelOidcToken } = await import("@vercel/oidc");

  const client = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${saEmail}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: async () => getVercelOidcToken(),
    },
  });

  if (!client) throw new Error("Failed to create WIF ExternalAccountClient");

  const accessToken = (await client.getAccessToken()).token;
  if (!accessToken) throw new Error("WIF: STS exchange returned no access token");

  const iamUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${saEmail}:generateIdToken`;
  const res = await fetch(iamUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ audience, includeEmail: true }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WIF generateIdToken failed (${res.status}): ${body}`);
  }

  return ((await res.json()) as { token: string }).token;
}

async function mintViaImpersonation(
  sa: string,
  audience: string,
): Promise<string> {
  const source = await auth.getClient();
  const accessToken = (await source.getAccessToken()).token;
  if (!accessToken) throw new Error("ADC returned no access token");

  const iamUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${sa}:generateIdToken`;

  const res = await fetch(iamUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ audience, includeEmail: true }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`IAM generateIdToken failed (${res.status}): ${body}`);
  }

  const { token } = (await res.json()) as { token: string };
  return token;
}

export async function controlPlaneAuthHeaders(): Promise<
  Record<string, string>
> {
  const target = url();
  if (!target.startsWith("https://")) return {};

  if (process.env.GCP_WORKLOAD_IDENTITY_POOL_ID) {
    const token = await mintViaWorkloadIdentity(target);
    return { Authorization: `Bearer ${token}` };
  }

  const sa = process.env.CONTROL_PLANE_SA;
  if (sa) {
    const token = await mintViaImpersonation(sa, target);
    return { Authorization: `Bearer ${token}` };
  }

  const client = await auth.getIdTokenClient(target);
  // google-auth-library returns a Headers instance here, whose values live
  // behind the Web API rather than on the object — so Object.entries() finds
  // nothing on it and returns {}. That failure is silent and total: the proxy
  // sends no Authorization at all and Cloud Run answers 403 with an HTML page
  // that says nothing about tokens. Going through Headers copes with either
  // shape, should the library ever hand back a plain object again.
  const headers = await client.getRequestHeaders();
  return Object.fromEntries(new Headers(headers as HeadersInit).entries());
}

export function controlPlaneUrl(): string {
  return url();
}
