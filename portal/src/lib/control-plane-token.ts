/**
 * Mints Google-signed ID tokens for the CaseRelay control plane (Cloud Run).
 *
 * This module runs ONLY on the Next.js server. No credential ever reaches
 * the client bundle.
 *
 * Token strategy:
 *  - https:// URL + CONTROL_PLANE_SA set → impersonate that service account
 *    via IAM generateIdToken (uses ADC + iam.serviceAccountTokenCreator).
 *  - https:// URL, no SA → try ADC directly (works on GCE / Cloud Run / CI
 *    where ADC is a service account).
 *  - http:// URL → local dev against a local backend; skip auth entirely.
 */

import { GoogleAuth } from "google-auth-library";

const auth = new GoogleAuth();

function url(): string {
  const v = process.env.CONTROL_PLANE_URL;
  if (!v) throw new Error("CONTROL_PLANE_URL is not set");
  return v;
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

  const sa = process.env.CONTROL_PLANE_SA;
  if (sa) {
    const token = await mintViaImpersonation(sa, target);
    return { Authorization: `Bearer ${token}` };
  }

  const client = await auth.getIdTokenClient(target);
  const h = await client.getRequestHeaders();
  return Object.fromEntries(Object.entries(h));
}

export function controlPlaneUrl(): string {
  return url();
}
