import { describe, expect, it, vi } from "vitest";

// Phase 15 (MCP OAuth, docs/adr/0005) - the two discovery documents, and
// the Auth.js REST mount.
//
// The QA capability scan flagged all three as having no test that named
// them. Each one is a route whose absence or misconfiguration fails
// *silently*: nothing throws, nothing goes red, and the damage shows up
// as "the integration just won't connect" or "the logout button does
// nothing", days later and far from the cause. Both of those have
// already happened once in this codebase; the route comments record them.

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const ORIGIN = "https://www.ankora.co.il";
const req = (url = `${ORIGIN}/.well-known/oauth-protected-resource`) => new Request(url);

describe("/api/mcp/oauth/metadata/protected-resource (RFC 9728)", () => {
  it("names the MCP endpoint itself as the resource, not just the origin", async () => {
    // Claude matches this against the server URL the user typed, path and
    // all. An origin-only value here makes every connection attempt fail
    // audience validation, with no server-side error to find.
    const { GET } = await import("@/app/api/mcp/oauth/metadata/protected-resource/route");
    const body = await (await GET(req())).json();

    expect(body.resource).toBe(`${ORIGIN}/api/mcp`);
  });

  it("points at the authorization server that can actually issue for it", async () => {
    const { GET } = await import("@/app/api/mcp/oauth/metadata/protected-resource/route");
    const body = await (await GET(req())).json();

    expect(body.authorization_servers).toContain(ORIGIN);
  });

  it("documents itself with the guide, never with the MCP endpoint", async () => {
    // A documentation URL that resolves to the thing it documents is a
    // self-reference: anyone who followed it got JSON-RPC instead of
    // instructions. That was the bug; this is the guard.
    const { GET } = await import("@/app/api/mcp/oauth/metadata/protected-resource/route");
    const body = await (await GET(req())).json();

    expect(body.resource_documentation).not.toContain("/api/mcp");
    expect(body.resource_documentation).toContain("/app/guide");
  });

  it("advertises the scopes the store actually supports", async () => {
    const { GET } = await import("@/app/api/mcp/oauth/metadata/protected-resource/route");
    const { SUPPORTED_SCOPES } = await import("@/lib/mcp/oauth/store");
    const body = await (await GET(req())).json();

    expect(body.scopes_supported).toEqual([...SUPPORTED_SCOPES]);
  });

  it("is readable cross-origin, which is the whole point of a discovery document", async () => {
    const { GET, OPTIONS } = await import("@/app/api/mcp/oauth/metadata/protected-resource/route");

    const get = await GET(req());
    expect(get.headers.get("access-control-allow-origin")).toBe("*");

    const preflight = await OPTIONS();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("derives the origin from the request rather than hardcoding a host", async () => {
    // Preview deployments and the apex/www split both depend on this.
    const { GET } = await import("@/app/api/mcp/oauth/metadata/protected-resource/route");
    const body = await (
      await GET(req("https://ankora-website-preview.vercel.app/.well-known/oauth-protected-resource"))
    ).json();

    expect(body.resource).toBe("https://ankora-website-preview.vercel.app/api/mcp");
  });
});

describe("/api/mcp/oauth/metadata/authorization-server (RFC 8414)", () => {
  it("advertises dynamic client registration", async () => {
    // Without registration_endpoint, Claude stops looking for a way in and
    // falls back to credentials that do not exist for this server. The
    // connection simply never establishes, with nothing in the logs.
    const { GET } = await import("@/app/api/mcp/oauth/metadata/authorization-server/route");
    const body = await (await GET(req(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();

    expect(body.registration_endpoint).toBe(`${ORIGIN}/api/mcp/oauth/register`);
  });

  it("advertises PKCE and public-client auth, which DCR depends on", async () => {
    const { GET } = await import("@/app/api/mcp/oauth/metadata/authorization-server/route");
    const body = await (await GET(req(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();

    expect(body.code_challenge_methods_supported).toContain("S256");
    expect(body.token_endpoint_auth_methods_supported).toContain("none");
  });

  it("keeps its endpoints on the same issuer it declares", async () => {
    const { GET } = await import("@/app/api/mcp/oauth/metadata/authorization-server/route");
    const body = await (await GET(req(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();

    for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
      expect(String(body[key]).startsWith(body.issuer), key).toBe(true);
    }
  });
});

describe("/api/auth/[...nextauth]", () => {
  it("mounts Auth.js's REST handlers for both GET and POST", async () => {
    // This file did not exist from Phase 0 until it was noticed. Every
    // part of the app that needs Auth.js server-side calls it as a
    // function, so nothing broke loudly - except the client-side
    // signOut(), which POSTs here after GETting /api/auth/csrf. Both
    // 404'd, the fetch resolved non-ok, and the visible logout button did
    // nothing at all, on every environment, for months.
    //
    // Both verbs matter: csrf is the GET, signout is the POST. Exporting
    // only one brings the silence straight back.
    vi.doMock("@/auth", () => ({
      handlers: { GET: async () => new Response("csrf"), POST: async () => new Response("signout") },
    }));

    const route = await import("@/app/api/auth/[...nextauth]/route");

    expect(typeof route.GET).toBe("function");
    expect(typeof route.POST).toBe("function");
  });
});
