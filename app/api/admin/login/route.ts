import { NextResponse } from "next/server";
import { checkPassword, createSessionToken, isAdminConfigured, ADMIN_COOKIE } from "@/lib/adminAuth";

export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "Admin isn't configured on this environment yet (missing ADMIN_PASSWORD / ADMIN_SESSION_SECRET)." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";

  if (!password || !checkPassword(password)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token = createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
