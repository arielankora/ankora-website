"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { isProductionBuild } from "@/lib/env";
import { appBaseUrl } from "@/lib/email-templates";
import { afterResponse } from "@/lib/after-response";
import { prisma } from "@/lib/prisma";
import { transcribeRecording } from "@/lib/comms/call-store";
import { BlockError, backfillChannel, startStoring } from "@/lib/comms/whatsapp-store";
import { CONNECT_COOKIE, CONNECT_MINUTES, createConnectLink, ownChannel } from "@/lib/comms/self-connect";

const PAGE = "/app/whatsapp-poc/connect";

/// Step 1: off to Unipile's Hosted Auth, with a signed cookie that the way
/// back must bring (lib/comms/self-connect.ts).
export async function startConnectAction(): Promise<void> {
  const user = await requireUser();
  if (user.role === "CLIENT_USER") redirect("/app");
  let link: string;
  try {
    const made = await createConnectLink(user, `${appBaseUrl()}${PAGE}/callback`);
    const jar = await cookies();
    jar.set(CONNECT_COOKIE, made.cookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProductionBuild(),
      path: PAGE,
      maxAge: CONNECT_MINUTES * 60,
    });
    link = made.link;
  } catch (err) {
    console.error("self-connect: could not create the link", err);
    redirect(`${PAGE}?result=link-failed`);
  }
  redirect(link);
}

/// Step 2: one button. The first history load starts now, as on the setup
/// screen; the nightly run does the rest.
export async function activateStoringAction(): Promise<void> {
  const user = await requireUser();
  const channel = await ownChannel(user.id);
  if (!channel) redirect(PAGE);
  try {
    await startStoring(user, channel.id);
  } catch (err) {
    if (err instanceof BlockError) redirect(`${PAGE}?result=failed`);
    throw err;
  }
  await afterResponse("comms: first history load", async () => {
    const fresh = await prisma.commsChannel.findUnique({ where: { id: channel.id } });
    if (fresh) await backfillChannel(fresh, { budgetMs: 50_000, transcribe: transcribeRecording });
  });
  revalidatePath(PAGE);
  revalidatePath("/app/whatsapp-poc/setup");
  redirect(`${PAGE}?result=active`);
}
