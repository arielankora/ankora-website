"use client";
import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { sendPocMessageAction, type SendState } from "./actions";
import { MAX_MESSAGE_LENGTH } from "@/lib/whatsapp-poc/access";

export function SendForm({ chatId, channelId, group = false }: { chatId: string; channelId: string; group?: boolean }) {
  const t = useTranslations("comms.send");
  const [state, action, pending] = useActionState<SendState | undefined, FormData>(sendPocMessageAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.sent) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-2 border-t border-app-border p-4">
      <input type="hidden" name="chatId" value={chatId} />
      <input type="hidden" name="channelId" value={channelId} />
      <label htmlFor="poc-text" className="block text-xs font-medium text-app-text-secondary">
        {group ? t("labelGroup") : t("label")}
      </label>
      <textarea
        id="poc-text"
        name="text"
        required
        rows={3}
        maxLength={MAX_MESSAGE_LENGTH}
        dir="auto"
        className="w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? t("sending") : t("send")}
        </button>
        {state?.error ? (
          <p role="alert" className="text-sm text-app-error">
            {state.error}
          </p>
        ) : null}
        {state?.sent ? <p className="text-sm text-app-text-secondary">{t("sent")}</p> : null}
      </div>
    </form>
  );
}
