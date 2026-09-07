// Missing since Phase 0/1: this file is what actually wires Auth.js's
// generated request handlers up to a real Next.js route at /api/auth/*.
// It was never created, and nothing surfaced that until now because
// every part of this app that needs Auth.js server-side calls signIn()/
// auth()/signOut() directly as a function (see app/(product)/app/login/
// actions.ts, lib/app-auth/session.ts, middleware.ts) rather than going
// through the REST API - Auth.js v5 supports both, and this codebase
// happened to only ever use the former.
//
// The one place that DOES need the REST API is the client-side signOut()
// from "next-auth/react" (components/app/LogoutButton.tsx,
// components/app/BottomNav.tsx's mobile nav) - it works by POSTing to
// /api/auth/signout (after first GETting /api/auth/csrf for a token),
// which has no server component to call directly. Without this file,
// both requests 404, the fetch silently resolves as a non-ok response,
// and signOut() never redirects or clears the session cookie - so the
// visible "התנתקות" button in the header/mobile nav has done nothing at
// all since Phase 0, on every environment, until this fix. (The other
// logout path, "ניתוק כל ההתחברויות" on the Users admin screen, was
// unaffected - it works via a DB tokenVersion bump, not this REST API.)
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
