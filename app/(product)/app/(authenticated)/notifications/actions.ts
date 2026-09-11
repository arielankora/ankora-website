"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/app-domain/notifications";

export async function markNotificationReadAction(formData: FormData) {
  const user = await requireUser();
  const notificationId = String(formData.get("notificationId") || "");
  if (!notificationId) return;
  await markNotificationRead(user, notificationId);
  revalidatePath("/app/notifications");
}

export async function markAllNotificationsReadAction() {
  const user = await requireUser();
  await markAllNotificationsRead(user);
  revalidatePath("/app/notifications");
}
