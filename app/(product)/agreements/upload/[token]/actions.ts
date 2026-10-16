"use server";
import { headers } from "next/headers";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";
import { AgreementError, uploadSignedPdfWithLink } from "@/lib/app-domain/agreements";

// Unauthenticated: the token in the form is the only credential. Same
// budget as the sign page's form, under its own key.
const UPLOAD_LIMIT = 10;
const UPLOAD_WINDOW_MS = 15 * 60 * 1000;

export type UploadState = { error?: string; done?: boolean };

export async function uploadSignedPdfAction(_prev: UploadState | undefined, formData: FormData): Promise<UploadState> {
  const ip = clientIpFrom(await headers());
  if (!(await checkRateLimit(`agreement-pdf-upload:${ip}`, UPLOAD_LIMIT, UPLOAD_WINDOW_MS)).allowed) {
    return { error: "יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "יש לבחור את קובץ ה-PDF החתום." };

  try {
    await uploadSignedPdfWithLink(String(formData.get("token") || ""), {
      content: Buffer.from(await file.arrayBuffer()),
      fileName: file.name || "signed.pdf",
    });
  } catch (err) {
    if (err instanceof AgreementError) return { error: err.message };
    throw err;
  }
  return { done: true };
}
