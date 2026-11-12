"use client";
import { useTranslations } from "next-intl";
import { useFormState, useFormStatus } from "react-dom";
import { updateCategoryAction } from "../actions";
import type { Category } from "@prisma/client";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("categories.edit");
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? t("saving") : t("save")}
    </button>
  );
}

export function EditCategoryForm({ category }: { category: Category }) {
  const t = useTranslations("categories.edit");
  const [state, formAction] = useFormState(updateCategoryAction, {});

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="categoryId" value={category.id} />
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("name")}</label>
        <input
          name="name"
          defaultValue={category.name}
          required
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("description")}</label>
        <input
          name="description"
          defaultValue={category.description ?? ""}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("sortOrder")}</label>
        <input
          name="sortOrder"
          type="number"
          defaultValue={category.sortOrder}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div className="flex items-center gap-2 self-end pb-2">
        <input
          id="active"
          name="active"
          type="checkbox"
          defaultChecked={category.active}
          className="h-4 w-4 rounded border-app-border"
        />
        <label htmlFor="active" className="text-sm text-app-text-secondary">
          {t("active")}
        </label>
      </div>

      <div className="flex items-center gap-4 sm:col-span-2">
        {state?.error && <p className="text-sm text-app-error">{state.error}</p>}
        {state?.ok && <p className="text-sm text-app-success">{t("saved")}</p>}
        <div className="ms-auto">
          <SubmitButton />
        </div>
      </div>
    </form>
  );
}
