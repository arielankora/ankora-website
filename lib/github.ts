// Server-only helper around the GitHub Contents API. This is how the admin
// panel "publishes" a blog post: writing/updating/deleting a file in this
// repo, which triggers Vercel's normal git-based deploy. There is no
// database — content stays versioned in git, consistent with the rest of
// the site (content/he.ts, content/en.ts).
//
// Required env vars (set in Vercel, never hardcoded):
//   GITHUB_TOKEN   - a token with contents:write on this repo
//   GITHUB_OWNER   - repo owner, e.g. "arielankora"
//   GITHUB_REPO    - repo name, e.g. "ankora-website"
//   GITHUB_BRANCH  - branch to commit to. If unset, falls back to
//                     VERCEL_GIT_COMMIT_REF (the branch this deployment was
//                     built from, set automatically by Vercel) and then
//                     "main". This means every Preview deployment publishes
//                     to its OWN branch by default, so a post saved from a
//                     given preview URL always shows up on that same
//                     preview URL - no per-branch env var needed.

function config() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || "main";
  if (!token || !owner || !repo) {
    throw new Error(
      "Blog publishing isn't configured yet. GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO must be set."
    );
  }
  return { token, owner, repo, branch };
}

function apiUrl(path: string) {
  const { owner, repo } = config();
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
}

function authHeaders() {
  const { token } = config();
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

export async function getFileSha(path: string): Promise<string | null> {
  const { branch } = config();
  const res = await fetch(`${apiUrl(path)}?ref=${encodeURIComponent(branch)}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getFileSha failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return json.sha as string;
}

export async function putFile(path: string, content: string, message: string, isBase64 = false) {
  const { branch } = config();
  const sha = await getFileSha(path);
  const body: Record<string, unknown> = {
    message,
    branch,
    content: isBase64 ? content : Buffer.from(content, "utf8").toString("base64"),
  };
  if (sha) body.sha = sha;

  const res = await fetch(apiUrl(path), {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub putFile failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function deleteFile(path: string, message: string) {
  const { branch } = config();
  const sha = await getFileSha(path);
  if (!sha) return { skipped: true };

  const res = await fetch(apiUrl(path), {
    method: "DELETE",
    headers: authHeaders(),
    body: JSON.stringify({ message, branch, sha }),
  });
  if (!res.ok) throw new Error(`GitHub deleteFile failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export function isGithubConfigured(): boolean {
  return !!(process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER && process.env.GITHUB_REPO);
}
