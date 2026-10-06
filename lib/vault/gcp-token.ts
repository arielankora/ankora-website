import "server-only";
import { getVercelOidcToken } from "@vercel/oidc";

// A Google access token for the vault's own service account, via the same
// Workload Identity Federation the nightly backup already uses
// (lib/google-drive.ts, docs/adr/0001 section 22.8). No key, no secret:
// Vercel signs a short-lived identity for this deployment, Google's STS
// trusts it for this project, and the result impersonates a service
// account for at most an hour.
//
// Why a SEPARATE service account from the backup's (decision 1,
// 6.10.2026): the backup account can be impersonated by every deployment
// of this project, preview included, because previews legitimately run
// the same code. The vault account must not be: Neon preview branches are
// copies of production, ciphertext included, so a preview that could
// reach the production key could decrypt real client passwords. Its IAM
// binding names the production subject only
// (owner:<team>:project:<project>:environment:production); see the setup
// steps in .env.example. A preview that tries gets a 403 from
// iamcredentials, which is the intended outcome.
//
// Deliberately a small copy of the two token hops in google-drive.ts
// rather than a refactor of that file: the backup path is proven in
// production and has its own tests, and the vault should not be the
// reason it changes.

const STS_URL = "https://sts.googleapis.com/v1/token";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const KMS_SCOPE = "https://www.googleapis.com/auth/cloudkms";

let cached: { token: string; expiresAtMs: number } | null = null;

export function __resetVaultTokenCacheForTests() {
  cached = null;
}

function federationConfig(): { audience: string; serviceAccountEmail: string } {
  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const serviceAccountEmail = process.env.GCP_VAULT_SERVICE_ACCOUNT_EMAIL;
  const missing = [
    !projectNumber && "GCP_PROJECT_NUMBER",
    !poolId && "GCP_WORKLOAD_IDENTITY_POOL_ID",
    !providerId && "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID",
    !serviceAccountEmail && "GCP_VAULT_SERVICE_ACCOUNT_EMAIL",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Vault KMS access not configured - missing: ${missing.join(", ")}`);
  }
  return {
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
    serviceAccountEmail: serviceAccountEmail!,
  };
}

export async function getVaultAccessToken(now = Date.now()): Promise<string> {
  // A minute of margin so a token never expires between this check and
  // the KMS call that uses it.
  if (cached && cached.expiresAtMs - 60_000 > now) return cached.token;

  const { audience, serviceAccountEmail } = federationConfig();
  const oidcToken = await getVercelOidcToken();

  const stsRes = await fetch(STS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audience,
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      scope: CLOUD_PLATFORM_SCOPE,
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      subjectToken: oidcToken,
    }),
  });
  if (!stsRes.ok) throw new Error(`Vault STS exchange failed ${stsRes.status}`);
  const sts = (await stsRes.json()) as { access_token?: string };
  if (!sts.access_token) throw new Error("Vault STS exchange returned no access_token");

  const impRes = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:generateAccessToken`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${sts.access_token}`, "Content-Type": "application/json" },
      // Fifteen minutes is plenty for a reveal and keeps a leaked token
      // short-lived. The scope is KMS only.
      body: JSON.stringify({ scope: [KMS_SCOPE], lifetime: "900s" }),
    },
  );
  if (!impRes.ok) throw new Error(`Vault service account impersonation failed ${impRes.status}`);
  const imp = (await impRes.json()) as { accessToken?: string; expireTime?: string };
  if (!imp.accessToken) throw new Error("Vault impersonation returned no accessToken");

  const expiresAtMs = imp.expireTime ? Date.parse(imp.expireTime) : now + 900_000;
  cached = { token: imp.accessToken, expiresAtMs };
  return imp.accessToken;
}
