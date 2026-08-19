import crypto from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "ankora_admin_session";
const SESSION_DAYS = 7;

function secret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("ADMIN_SESSION_SECRET is not set");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

export function checkPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createSessionToken(): string {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${expires}`;
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function isValidSessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return false;
  }
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  return Number(payload) > Date.now();
}

export function isAdminConfigured(): boolean {
  return !!(process.env.ADMIN_PASSWORD && process.env.ADMIN_SESSION_SECRET);
}

export function isRequestAuthorized(): boolean {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  return isValidSessionToken(token);
}
