"use client";
import { useTransition } from "react";
import { retryEmailDeliveryAction } from "./actions";

export function RetryDeliveryButton({ deliveryId }: { deliveryId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => retryEmailDeliveryAction(deliveryId))}
      className="text-[11px] font-medium text-gold underline decoration-gold/40 underline-offset-2 disabled:opacity-50"
    >
      {isPending ? "שולח..." : "ניסיון חוזר"}
    </button>
  );
}
