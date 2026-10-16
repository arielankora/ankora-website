"use server";
import { headers } from "next/headers";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";
import {
  AgreementError,
  INVALID_UPLOAD_CODE_MESSAGE,
  uploadSignedPdfWithCode,
  viewUploadCode,
} from "@/lib/app-domain/agreements";

// /upload, where a signed agreement PDF comes back with a short code.
// Unauthenticated: the code is the only credential, so every check of it,
// at either step, spends from one strict budget per IP: 10 per 15 minutes.
// A real person uses two. A wrong code always gets the same sentence,
// whether it never existed, expired or was used.
const CODE_LIMIT = 10;
const CODE_WINDOW_MS = 15 * 60 * 1000;
const TOO_MANY = "יותר מדי ניסיונות. אפשר לנסות שוב בעוד רבע שעה.";

async function allowed(): Promise<boolean> {
  const ip = clientIpFrom(await headers());
  return (await checkRateLimit(`agreement-upload-code:${ip}`, CODE_LIMIT, CODE_WINDOW_MS)).allowed;
}

export type UploadCodeState = {
  error?: string;
  /// After a valid code: what the page shows before the file input.
  ready?: { code: string; title: string; firstName: string };
  done?: boolean;
};

export async function checkUploadCodeAction(_prev: UploadCodeState | undefined, formData: FormData): Promise<UploadCodeState> {
  if (!(await allowed())) return { error: TOO_MANY };
  const code = String(formData.get("code") || "");
  const view = await viewUploadCode(code);
  if (!view) return { error: INVALID_UPLOAD_CODE_MESSAGE };
  return { ready: { code, title: view.title, firstName: view.firstName } };
}

export async function uploadWithCodeAction(prev: UploadCodeState | undefined, formData: FormData): Promise<UploadCodeState> {
  if (!(await allowed())) return { ...prev, error: TOO_MANY };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ...prev, error: "יש לבחור את קובץ ה-PDF החתום." };
  try {
    // The code is checked again here; the first step proved nothing.
    await uploadSignedPdfWithCode(String(formData.get("code") || ""), {
      content: Buffer.from(await file.arrayBuffer()),
      fileName: file.name || "signed.pdf",
    });
  } catch (err) {
    if (err instanceof AgreementError) {
      // A code that stopped being valid between the steps goes back to step 1.
      if (err.message === INVALID_UPLOAD_CODE_MESSAGE) return { error: err.message };
      return { ...prev, error: err.message };
    }
    throw err;
  }
  return { done: true };
}
