"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ACTION_TAGS, MONEY_TAGS, type ActionTag } from "@/lib/process-rules";
import { CHANNELS, kindTakesParams, type Channel, type PolicyParams } from "@/lib/policy-params";
import type { PolicyKindLike } from "@/lib/client-policies";
import { Field, INPUT } from "./knowledge-ui";

// What the server checks in a client's rule (lib/policy-params.ts), on the
// rule's form. Optional: a rule without these is read by people and by
// Claude, and the form says so. The values travel as JSON in two hidden
// fields, "params" and "interimParams".

const CURRENCIES = ["ILS", "USD", "EUR"];

/// Which tags each kind is usually about, so the first click is right.
const DEFAULT_TAGS: Partial<Record<PolicyKindLike, ActionTag[]>> = {
  THRESHOLD: MONEY_TAGS,
  COMMUNICATION: ["CLIENT_MESSAGE"],
};

/// The kinds whose rule is about step tags, and what the tags field is
/// called for each (clients.policies.params.tagLabel).
const TAG_LABEL: Partial<Record<PolicyKindLike, "whichActions" | "needsApproval" | "forbidden" | "onlyWith">> = {
  THRESHOLD: "whichActions",
  APPROVAL_REQUIRED: "needsApproval",
  FORBIDDEN: "forbidden",
  REQUIRED_STEP: "onlyWith",
  TIMING: "whichActions",
  COMMUNICATION: "whichActions",
};

const minorToText = (m: number | undefined) => (m === undefined ? "" : String(m / 100));
const textToMinor = (t: string): number | undefined => {
  const n = Number(t.replace(/,/g, "").trim());
  return t.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

function TagBoxes({ kind, value, onChange }: { kind: PolicyKindLike; value: ActionTag[]; onChange: (v: ActionTag[]) => void }) {
  const t = useTranslations("clients.policies.params");
  const label = TAG_LABEL[kind];
  return (
    <Field label={label ? t(`tagLabel.${label}`) : t("tagLabel.actions")}>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {ACTION_TAGS.map((tag) => (
          <label key={tag} className="flex items-center gap-1 text-xs text-app-text-secondary">
            <input
              type="checkbox"
              checked={value.includes(tag)}
              onChange={(e) => onChange(e.target.checked ? [...value, tag] : value.filter((x) => x !== tag))}
              className="h-3.5 w-3.5 accent-gold"
            />
            {t(`actionTags.${tag}`)}
          </label>
        ))}
      </div>
    </Field>
  );
}

export function PolicyParamsFields({
  kind,
  initial,
  initialInterim,
  entities,
}: {
  kind: PolicyKindLike;
  initial?: PolicyParams;
  initialInterim?: PolicyParams;
  entities: { id: string; name: string }[];
}) {
  const t = useTranslations("clients.policies.params");
  const [on, setOn] = useState<boolean>(!!initial && Object.keys(initial).length > 0);
  const [p, setP] = useState<PolicyParams>(initial ?? {});
  const [interimAmount, setInterimAmount] = useState<string>(minorToText(initialInterim?.amountMinor));
  const set = (patch: Partial<PolicyParams>) => setP((all) => ({ ...all, ...patch }));

  if (!kindTakesParams(kind)) {
    return (
      <>
        <input type="hidden" name="params" value="{}" />
        <input type="hidden" name="interimParams" value="{}" />
      </>
    );
  }

  const tags = p.appliesToTags ?? DEFAULT_TAGS[kind] ?? [];
  const value: PolicyParams = on ? { ...p, ...(TAG_LABEL[kind] ? { appliesToTags: tags } : {}) } : {};
  const interim: PolicyParams =
    on && kind === "THRESHOLD" && textToMinor(interimAmount) !== undefined ? { ...value, amountMinor: textToMinor(interimAmount) } : {};

  return (
    <div className="rounded-lg border border-app-border px-3 py-2.5">
      <input type="hidden" name="params" value={JSON.stringify(value)} />
      <input type="hidden" name="interimParams" value={JSON.stringify(interim)} />
      <label className="flex items-center gap-1.5 text-xs font-medium text-app-text-primary">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="h-4 w-4 accent-gold" />
        {t("check")}
      </label>
      {!on ? (
        <p className="mt-1 text-[11px] text-app-text-tertiary">{t("textOnlyHint")}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {kind === "THRESHOLD" && (
            <>
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                <Field label={t("amountAbove")}>
                  <input
                    inputMode="decimal"
                    value={minorToText(p.amountMinor)}
                    onChange={(e) => set({ amountMinor: textToMinor(e.target.value) })}
                    placeholder="3000"
                    className={INPUT}
                  />
                </Field>
                <Field label={t("currency")}>
                  <select value={p.currency ?? ""} onChange={(e) => set({ currency: e.target.value || undefined })} className={INPUT}>
                    <option value="">{t("choose")}</option>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label={t("interimThreshold")}>
                <input inputMode="decimal" value={interimAmount} onChange={(e) => setInterimAmount(e.target.value)} placeholder={t("interimThresholdPlaceholder")} className={INPUT} />
              </Field>
            </>
          )}
          {kind === "REQUIRED_STEP" && (
            <Field label={t("mustInclude")}>
              <input value={p.mustInclude ?? ""} onChange={(e) => set({ mustInclude: e.target.value || undefined })} placeholder={t("mustIncludePlaceholder")} className={INPUT} />
            </Field>
          )}
          {kind === "TIMING" && (
            <Field label={t("leadDays")}>
              <input
                inputMode="numeric"
                value={p.leadBusinessDays ?? ""}
                onChange={(e) => set({ leadBusinessDays: /^\d+$/.test(e.target.value) ? Number(e.target.value) : undefined })}
                placeholder="2"
                className={INPUT}
              />
            </Field>
          )}
          {kind === "COMMUNICATION" && (
            <>
              <Field label={t("channels")}>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {CHANNELS.map((c) => (
                    <label key={c} className="flex items-center gap-1 text-xs text-app-text-secondary">
                      <input
                        type="checkbox"
                        checked={(p.channels ?? []).includes(c)}
                        onChange={(e) => {
                          const now = p.channels ?? [];
                          const next: Channel[] = e.target.checked ? [...now, c] : now.filter((x) => x !== c);
                          set({ channels: next.length ? next : undefined });
                        }}
                        className="h-3.5 w-3.5 accent-gold"
                      />
                      {t(`channelLabels.${c}`)}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label={t("invoiceTo")}>
                <input
                  defaultValue={(p.invoiceTo ?? []).join(", ")}
                  onChange={(e) => {
                    const list = e.target.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
                    set({ invoiceTo: list.length ? list : undefined });
                  }}
                  placeholder="billing-us@nux.ai, billing-il@nux.ai"
                  className={INPUT}
                />
              </Field>
            </>
          )}
          {kind === "SEPARATION" ? (
            <Field label={t("separatedEntities")}>
              {entities.length < 2 ? (
                <p className="mt-1 text-[11px] text-app-text-tertiary">{t("needTwoEntities")}</p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {entities.map((e) => (
                    <label key={e.id} className="flex items-center gap-1 text-xs text-app-text-secondary">
                      <input
                        type="checkbox"
                        checked={(p.entityIds ?? []).includes(e.id)}
                        onChange={(ev) => {
                          const now = p.entityIds ?? [];
                          const next = ev.target.checked ? [...now, e.id] : now.filter((x) => x !== e.id);
                          set({ entityIds: next.length ? next : undefined });
                        }}
                        className="h-3.5 w-3.5 accent-gold"
                      />
                      {e.name}
                    </label>
                  ))}
                </div>
              )}
            </Field>
          ) : (
            <>
              <TagBoxes kind={kind} value={tags} onChange={(v) => set({ appliesToTags: v })} />
              {entities.length > 0 && (
                <Field label={t("entityOnly")}>
                  <select value={p.entityId ?? ""} onChange={(e) => set({ entityId: e.target.value || undefined })} className={INPUT}>
                    <option value="">{t("allEntities")}</option>
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
