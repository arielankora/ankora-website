"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { CopyValue } from "@/components/app/CopyValue";
import {
  acceptUpdateAction,
  addFromLibraryAction,
  approveSharedAction,
  decideLessonAction,
  proposeSharedAction,
  rejectSharedAction,
  approveVersionAction,
  archiveAgentAction,
  setAgentPurposeAction,
  createAgentAction,
  deleteAdditionBlockAction,
  deleteBlockAction,
  discardAdditionAction,
  saveAdditionBlockAction,
  saveAdditionNoteAction,
  submitAdditionAction,
  deleteParamAction,
  discardDraftAction,
  installAction,
  markFaultyAction,
  rejectVersionAction,
  removeInstallationAction,
  revertToVersionAction,
  saveBlockAction,
  saveMetaAction,
  saveParamAction,
  setAgentProcessAction,
  setAgentCategoriesAction,
  createAgentCategoryAction,
  renameAgentCategoryAction,
  moveAgentCategoryAction,
  setAgentCategoryArchivedAction,
  setClientValueAction,
  submitDraftAction,
} from "./actions";
import { recordPromptCopiedAction } from "../prompt-copy-actions";
import { BLOCK_KINDS, PARAM_LEVELS, PARAM_TYPES, skillText, type AgentBlock, type AgentParam, type AgentRequirements } from "@/lib/agents/model";

// Agents, phase 1: the screens' forms. Drawers, like every write form in
// the app; the server pages around them only read.

const INPUT = "mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";
const LABEL = "block text-xs font-medium text-app-text-secondary";
// Option order of the surfaces, as the old labels.ts had it.
const SURFACES = ["PROJECT", "SCHEDULED", "PERSISTENT_SESSION", "SKILL"] as const;

const PRIMARY = "tap-area w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-app-text-tertiary">{hint}</span>}
    </label>
  );
}

function Err({ error }: { error?: string | null }) {
  return error ? <p className="text-sm text-app-error">{error}</p> : null;
}

/// A one-click action with a toast for its answer.
export function ActionButton({ run, label, done, tone = "quiet" }: { run: () => Promise<{ error?: string }>; label: string; done: string; tone?: "primary" | "quiet" }) {
  const t = useTranslations("agents.forms.common");
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  async function click() {
    setBusy(true);
    const r = await run();
    setBusy(false);
    if (r.error) showToast({ tone: "error", title: t("notDone"), description: r.error });
    else showToast({ tone: "info", title: done });
  }
  const cls =
    tone === "primary"
      ? "tap-area rounded-full bg-app-text-primary px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
      : "tap-area rounded-full border border-app-border bg-white px-4 py-2 text-[13px] text-app-text-primary disabled:opacity-50";
  return (
    <button type="button" onClick={click} disabled={busy} className={cls}>
      {label}
    </button>
  );
}

// --- New agent ---------------------------------------------------------------

function NewAgentForm() {
  const t = useTranslations("agents.forms");
  const tl = useTranslations("agents.labels");
  const router = useRouter();
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(createAgentAction, (r) => {
    close();
    if (r.slug) router.push(`/app/agents/${r.slug}/instructions`);
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <Field label={t("newAgent.name")}>
        <input name="name" required maxLength={80} dir="auto" className={INPUT} />
      </Field>
      <Field label={t("newAgent.purpose")}>
        <input name="purpose" required maxLength={300} dir="auto" className={INPUT} />
      </Field>
      <Field label={t("newAgent.whereRuns")}>
        <select name="kind" className={INPUT} defaultValue="SCHEDULED">
          <option value="CLIENT_PROJECT">{t("newAgent.kindProject")}</option>
          <option value="SCHEDULED">{tl("kind.SCHEDULED")}</option>
          <option value="SKILL">{tl("kind.SKILL")}</option>
        </select>
      </Field>
      <p className="text-[11px] text-app-text-tertiary">{t("newAgent.importHint")}</p>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t("common.saving") : t("newAgent.submit")}
      </button>
    </form>
  );
}

export function NewAgent() {
  const t = useTranslations("agents.forms");
  return (
    <Drawer triggerLabel={t("newAgent.trigger")} title={t("newAgent.trigger")}>
      <NewAgentForm />
    </Drawer>
  );
}

// --- Blocks --------------------------------------------------------------------

type ClientOption = { id: string; name: string };

function BlockForm({ agentId, block, params }: { agentId: string; block?: AgentBlock; params: AgentParam[] }) {
  const t = useTranslations("agents.forms");
  const tl = useTranslations("agents.labels");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(saveBlockAction, close);
  const [body, setBody] = useState(block?.body ?? "");
  const [safety, setSafety] = useState(!!block?.safety);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="originalKey" value={block?.key ?? ""} />
      <input type="hidden" name="key" value={block?.key ?? ""} />
      <Field label={t("common.blockKind")}>
        <select name="kind" defaultValue={block?.kind ?? "steps"} className={INPUT}>
          {BLOCK_KINDS.map((k) => (
            <option key={k} value={k}>{tl(`blockKind.${k}`)}</option>
          ))}
        </select>
      </Field>
      <Field label={t("common.title")}>
        <input name="title" required maxLength={120} dir="auto" defaultValue={block?.title ?? ""} className={INPUT} />
      </Field>
      <Field label={t("common.text")} hint={t("block.bodyHint", { example: `{{${t("block.exampleKey")}}}` })}>
        <textarea name="body" rows={10} dir="auto" value={body} onChange={(e) => setBody(e.target.value)} className={INPUT} />
      </Field>
      {params.length > 0 && (
        <div className="-mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-app-text-secondary">{t("block.addParam")}</span>
          {params.map((p) => (
            <button key={p.key} type="button" onClick={() => setBody((b) => `${b}{{${p.key}}}`)} className="rounded-md border border-dashed border-app-accent px-2 py-1 text-app-text-accent">
              {p.label}
            </button>
          ))}
        </div>
      )}
      <Field label={t("block.why")}>
        <input name="why" maxLength={2000} dir="auto" defaultValue={block?.why ?? ""} className={INPUT} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-app-text-primary">
        <input type="checkbox" name="safety" checked={safety} onChange={(e) => setSafety(e.target.checked)} />
        {t("block.safety")}
      </label>
      {!safety && (
        <label className="flex items-center gap-2 text-sm text-app-text-primary">
          <input type="checkbox" name="overridable" defaultChecked={!!block?.overridable} />
          {t("block.overridable")}
        </label>
      )}
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t("common.saving") : t("common.saveDraft")}
      </button>
    </form>
  );
}

export function EditBlock(props: { agentId: string; block?: AgentBlock; params: AgentParam[] }) {
  const t = useTranslations("agents.forms");
  return (
    <Drawer triggerLabel={props.block ? t("common.edit") : t("block.addTrigger")} title={props.block ? t("block.editTitle", { title: props.block.title }) : t("common.newBlock")} variant={props.block ? "link" : "primary"}>
      <BlockForm {...props} />
    </Drawer>
  );
}

export function DeleteBlock({ agentId, blockKey }: { agentId: string; blockKey: string }) {
  const t = useTranslations("agents.forms");
  return <ActionButton run={() => deleteBlockAction(agentId, blockKey)} label={t("common.remove")} done={t("block.removed")} />;
}

// --- Client additions (24.11.2026) ------------------------------------------

type ReplaceTarget = { key: string; title: string };

function AdditionBlockForm({ agentId, clientId, clients, block, targets }: { agentId: string; clientId?: string; clients: ClientOption[]; block?: AgentBlock; targets: ReplaceTarget[] }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(saveAdditionBlockAction, close);
  const t = useTranslations("agents.forms");
  const tl = useTranslations("agents.labels");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="originalKey" value={block?.key ?? ""} />
      {clientId ? (
        <input type="hidden" name="clientId" value={clientId} />
      ) : (
        <Field label={t("addition.client")}>
          <select name="clientId" required className={INPUT}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t("common.blockKind")}>
        <select name="kind" defaultValue={block?.kind ?? "rules"} className={INPUT}>
          {BLOCK_KINDS.map((k) => (
            <option key={k} value={k}>{tl(`blockKind.${k}`)}</option>
          ))}
        </select>
      </Field>
      <Field label={t("common.title")}>
        <input name="title" required maxLength={120} dir="auto" defaultValue={block?.title ?? ""} className={INPUT} />
      </Field>
      <Field label={t("common.text")} hint={t("addition.bodyHint", { example: `{{${t("block.exampleKey")}}}` })}>
        <textarea name="body" rows={8} dir="auto" defaultValue={block?.body ?? ""} className={INPUT} />
      </Field>
      <Field label={t("block.why")}>
        <input name="why" maxLength={2000} dir="auto" defaultValue={block?.why ?? ""} className={INPUT} />
      </Field>
      <Field label={t("addition.replaces")} hint={t("addition.replacesHint")}>
        <select name="replaces" defaultValue={block?.replaces ?? ""} className={INPUT}>
          <option value="">{t("addition.notReplacing")}</option>
          {targets.map((target) => (
            <option key={target.key} value={target.key}>{target.title}</option>
          ))}
        </select>
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t("common.saving") : t("addition.save")}
      </button>
    </form>
  );
}

export function EditAdditionBlock(props: { agentId: string; clientId?: string; clientName?: string; clients: ClientOption[]; block?: AgentBlock; targets: ReplaceTarget[] }) {
  const t = useTranslations("agents.forms");
  const title = props.block ? t("block.editTitle", { title: props.block.title }) : props.clientName ? t("addition.newForClient", { client: props.clientName }) : t("addition.title");
  return (
    <Drawer triggerLabel={props.block ? t("common.edit") : props.clientId ? t("block.addTrigger") : t("addition.newTrigger")} title={title} variant={props.block || props.clientId ? "link" : "primary"}>
      <AdditionBlockForm {...props} />
    </Drawer>
  );
}

export function DeleteAdditionBlock({ agentId, clientId, blockKey }: { agentId: string; clientId: string; blockKey: string }) {
  const t = useTranslations("agents.forms");
  return <ActionButton run={() => deleteAdditionBlockAction(agentId, clientId, blockKey)} label={t("common.remove")} done={t("addition.removed")} />;
}

function AdditionNoteForm({ agentId, clientId, changeNote }: { agentId: string; clientId: string; changeNote: string }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(saveAdditionNoteAction, close);
  const t = useTranslations("agents.forms.addition");
  const tc = useTranslations("agents.forms.common");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="clientId" value={clientId} />
      <Field label={t("changeNote")}>
        <textarea name="changeNote" rows={3} dir="auto" defaultValue={changeNote} className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? tc("saving") : t("save2")}
      </button>
    </form>
  );
}

export function EditAdditionNote(props: { agentId: string; clientId: string; changeNote: string }) {
  const t = useTranslations("agents.forms.addition");
  return (
    <Drawer triggerLabel={t("noteTrigger")} title={t("noteTitle")} variant="link">
      <AdditionNoteForm {...props} />
    </Drawer>
  );
}

export function AdditionDraftButtons({ id, canDiscard }: { id: string; canDiscard: boolean }) {
  const t = useTranslations("agents.forms.addition");
  return (
    <div className="flex flex-wrap gap-2">
      {canDiscard && <ActionButton run={() => discardAdditionAction(id)} label={t("discard")} done={t("discarded")} />}
      <ActionButton run={() => submitAdditionAction(id)} label={t("submit")} done={t("submitted")} tone="primary" />
    </div>
  );
}

// --- Parameters --------------------------------------------------------------

function ParamForm({ agentId, param }: { agentId: string; param?: AgentParam }) {
  const t = useTranslations("agents.forms");
  const tl = useTranslations("agents.labels");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(saveParamAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="originalKey" value={param?.key ?? ""} />
      <Field label={t("param.key")} hint={t("param.keyHint")}>
        <input name="key" required maxLength={40} dir="auto" defaultValue={param?.key ?? ""} className={INPUT} />
      </Field>
      <Field label={t("param.label")}>
        <input name="label" required maxLength={80} dir="auto" defaultValue={param?.label ?? ""} className={INPUT} />
      </Field>
      <Field label={t("param.level")}>
        <select name="level" defaultValue={param?.level ?? "CLIENT"} className={INPUT}>
          {PARAM_LEVELS.map((k) => (
            <option key={k} value={k}>{tl(`paramLevel.${k}`)}</option>
          ))}
        </select>
      </Field>
      <Field label={t("param.type")}>
        <select name="type" defaultValue={param?.type ?? "TEXT"} className={INPUT}>
          {PARAM_TYPES.map((k) => (
            <option key={k} value={k}>{tl(`paramType.${k}`)}</option>
          ))}
        </select>
      </Field>
      <Field label={t("param.default")}>
        <input name="default" maxLength={2000} dir="auto" defaultValue={param?.default ?? ""} className={INPUT} />
      </Field>
      <Field label={t("param.clientField")} hint={t("param.clientFieldHint")}>
        <select name="clientField" defaultValue={param?.clientField ?? ""} className={INPUT}>
          <option value="">{t("param.clientFieldNone")}</option>
          <option value="name">{t("param.clientFieldName")}</option>
          <option value="domains">{t("param.clientFieldDomains")}</option>
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-app-text-primary">
        <input type="checkbox" name="required" defaultChecked={!!param?.required} />
        {t("param.required")}
      </label>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t("common.saving") : t("common.saveDraft")}
      </button>
    </form>
  );
}

export function EditParam({ agentId, param }: { agentId: string; param?: AgentParam }) {
  const t = useTranslations("agents.forms");
  return (
    <Drawer triggerLabel={param ? t("common.edit") : t("param.newTrigger")} title={param ? t("param.editTitle", { label: param.label }) : t("param.newTrigger")} variant={param ? "link" : "primary"}>
      <ParamForm agentId={agentId} param={param} />
    </Drawer>
  );
}

export function DeleteParam({ agentId, paramKey }: { agentId: string; paramKey: string }) {
  const t = useTranslations("agents.forms");
  return <ActionButton run={() => deleteParamAction(agentId, paramKey)} label={t("common.remove")} done={t("param.removed")} />;
}

function ClientValueForm({ agentId, clientId, paramKey, value }: { agentId: string; clientId: string; paramKey: string; value: string }) {
  const t = useTranslations("agents.forms");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(setClientValueAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="key" value={paramKey} />
      <Field label={t("clientValue.value")} hint={t("clientValue.hint")}>
        <textarea name="value" rows={3} dir="auto" defaultValue={value} className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t("common.saving") : t("common.save")}
      </button>
    </form>
  );
}

export function EditClientValue(props: { agentId: string; clientId: string; clientName: string; paramKey: string; paramLabel: string; value: string }) {
  const t = useTranslations("agents.forms");
  return (
    <Drawer triggerLabel={props.value ? t("common.change") : t("clientValue.set")} title={`${props.paramLabel}: ${props.clientName}`} variant="link">
      <ClientValueForm {...props} />
    </Drawer>
  );
}

// --- Version meta, draft and decision ---------------------------------------

/// "Draft with Claude": copies a prompt built from the draft's differences.
function ChangeNoteWithClaude({ prompt }: { prompt: string }) {
  const t = useTranslations("agents.forms");
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(prompt);
      setState("copied");
      void recordPromptCopiedAction({ kind: "agent_change_note", chars: prompt.length });
    } catch {
      setState("manual");
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={copy} className="tap-area rounded-full border border-app-border bg-white px-3 py-1 text-[12.5px] font-medium text-app-text-primary hover:border-gold">
          {state === "copied" ? t("meta.copied") : t("meta.compose")}
        </button>
        {state === "copied" && (
          <span className="text-[12px] text-app-text-secondary" role="status">
            {t("meta.pasteHint")}{" "}
            <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer" className="font-medium text-app-text-accent">{t("meta.openClaude")}</a>
          </span>
        )}
      </div>
      {state === "manual" && <textarea readOnly value={prompt} rows={5} dir="auto" className="w-full rounded-lg border border-app-border p-2 text-xs" aria-label={t("meta.promptAria")} onFocus={(e) => e.currentTarget.select()} />}
    </div>
  );
}

function MetaForm({ agentId, actionLevel, changeNote, requirements, notePrompt }: { agentId: string; actionLevel: string; changeNote: string; requirements: AgentRequirements; notePrompt?: string }) {
  const t = useTranslations("agents.forms");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(saveMetaAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <Field label={t("common.changeNote")} hint={t("meta.changeNoteHint")}>
        <textarea name="changeNote" rows={3} dir="auto" defaultValue={changeNote} className={INPUT} />
      </Field>
      {notePrompt && <ChangeNoteWithClaude prompt={notePrompt} />}
      <Field label={t("meta.actionLevel")}>
        <select name="actionLevel" defaultValue={actionLevel} className={INPUT}>
          <option value="READ">{t("meta.levelRead")}</option>
          <option value="DRAFT">{t("meta.levelDraft")}</option>
          <option value="SEND">{t("meta.levelSend")}</option>
        </select>
      </Field>
      <Field label={t("meta.connectors")} hint={t("meta.commaHint")}>
        <input name="connectors" dir="ltr" defaultValue={requirements.connectors.join(", ")} className={INPUT} />
      </Field>
      <Field label={t("meta.skills")} hint={t("meta.skillsHint")}>
        <input name="skills" dir="ltr" defaultValue={requirements.skills.map(skillText).join(", ")} className={INPUT} />
      </Field>
      <Field label={t("meta.repos")}>
        <input name="repos" dir="ltr" defaultValue={requirements.repos.join(", ")} className={INPUT} />
      </Field>
      <Field label={t("meta.localMcp")}>
        <input name="localMcp" dir="ltr" defaultValue={requirements.localMcp.join(", ")} className={INPUT} />
      </Field>
      <Field label={t("meta.external")}>
        <input name="externalRunners" dir="auto" defaultValue={requirements.externalRunners.join(", ")} className={INPUT} />
      </Field>
      <Field label={t("meta.model")}>
        <input name="model" dir="ltr" defaultValue={requirements.model ?? ""} className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t("common.saving") : t("common.saveDraft")}
      </button>
    </form>
  );
}

export function EditMeta(props: { agentId: string; actionLevel: string; changeNote: string; requirements: AgentRequirements; notePrompt?: string }) {
  const t = useTranslations("agents.forms");
  return (
    <Drawer triggerLabel={t("meta.trigger")} title={t("meta.title")} variant="link">
      <MetaForm {...props} />
    </Drawer>
  );
}

function ProcessForm({ agentId, current, options }: { agentId: string; current: string | null; options: { id: string; label: string }[] }) {
  const t = useTranslations("agents.forms");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(setAgentProcessAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <Field label={t("process.field")} hint={t("process.hint")}>
        <select name="processId" defaultValue={current ?? ""} className={INPUT}>
          <option value="">{t("process.none")}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t("common.saving") : t("common.save")}
      </button>
    </form>
  );
}

export function LinkProcess({ agentId, current, options }: { agentId: string; current: string | null; options: { id: string; label: string }[] }) {
  const t = useTranslations("agents.forms");
  return (
    <Drawer triggerLabel={current ? t("common.change") : t("process.link")} title={t("process.field")} variant="link">
      <ProcessForm agentId={agentId} current={current} options={options} />
    </Drawer>
  );
}

export function DraftButtons({ versionId, canDiscard }: { versionId: string; canDiscard: boolean }) {
  const t = useTranslations("agents.forms");
  return (
    <div className="flex flex-wrap gap-2">
      {canDiscard && <ActionButton run={() => discardDraftAction(versionId)} label={t("draft.discard")} done={t("draft.discarded")} />}
      <ActionButton run={() => submitDraftAction(versionId)} label={t("draft.submit")} done={t("draft.submitted")} tone="primary" />
    </div>
  );
}

function ArchiveForm({ agentId }: { agentId: string }) {
  const t = useTranslations("agents.forms");
  const router = useRouter();
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(archiveAgentAction, () => {
    close();
    router.push("/app/agents");
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <p className="text-[13px] text-app-text-secondary">{t("archive.text")}</p>
      <Field label={t("archive.reason")}>
        <input name="reason" required dir="auto" className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("common.saving") : t("archive.submit")}
      </button>
    </form>
  );
}

export function ArchiveAgent({ agentId, name }: { agentId: string; name: string }) {
  const t = useTranslations("agents.forms");
  return (
    <Drawer triggerLabel={t("archive.submit")} title={t("archive.title", { name })} variant="link">
      <ArchiveForm agentId={agentId} />
    </Drawer>
  );
}

function PurposeForm({ agentId, purpose }: { agentId: string; purpose: string }) {
  const t = useTranslations("agents.forms");
  const router = useRouter();
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(setAgentPurposeAction, () => {
    close();
    router.refresh();
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <p className="text-[13px] text-app-text-secondary">{t("purpose.text")}</p>
      <Field label={t("common.purpose")}>
        <input name="purpose" required maxLength={300} defaultValue={purpose} dir="auto" className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t("common.saving") : t("common.save")}
      </button>
    </form>
  );
}

export function EditPurpose({ agentId, purpose }: { agentId: string; purpose: string }) {
  const t = useTranslations("agents.forms");
  return (
    <Drawer triggerLabel={t("purpose.trigger")} title={t("purpose.title")} variant="link">
      <PurposeForm agentId={agentId} purpose={purpose} />
    </Drawer>
  );
}

function RejectForm({ id }: { id: string }) {
  const t = useTranslations("agents.forms");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(rejectVersionAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={id} />
      <Field label={t("common.rejectNote")}>
        <input name="reason" required dir="auto" className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("common.saving") : t("common.reject")}
      </button>
    </form>
  );
}

export function DecideVersion({ id, version }: { id: string; version: number }) {
  const t = useTranslations("agents.forms");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ActionButton run={() => approveVersionAction(id)} label={t("version.approve", { version })} done={t("version.approved", { version })} tone="primary" />
      <Drawer triggerLabel={t("common.reject")} title={t("version.rejectTitle", { version })} variant="link">
        <RejectForm id={id} />
      </Drawer>
    </div>
  );
}

function FaultyForm({ id }: { id: string }) {
  const t = useTranslations("agents.forms");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(markFaultyAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-app-text-primary">{t("faulty.text")}</p>
      <Field label={t("faulty.reason")}>
        <input name="reason" required dir="auto" className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-error px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {pending ? t("common.saving") : t("faulty.submit")}
      </button>
    </form>
  );
}

export function MarkFaulty({ id, version }: { id: string; version: number }) {
  const t = useTranslations("agents.forms");
  return (
    <Drawer triggerLabel={t("faulty.trigger")} title={t("faulty.title", { version })} variant="link">
      <FaultyForm id={id} />
    </Drawer>
  );
}

// --- Installations -----------------------------------------------------------

function InstallForm({ agentId, clients, installParams, defaultSurface }: { agentId: string; clients: ClientOption[]; installParams: AgentParam[]; defaultSurface: string }) {
  const t = useTranslations("agents.forms");
  const tl = useTranslations("agents.labels");
  const [bootstrap, setBootstrap] = useState<string | null>(null);
  const [scope, setScope] = useState("ONE");
  const [surface, setSurface] = useState(defaultSurface);
  const { onSubmit, pending, error } = useActionForm(installAction, (r) => setBootstrap(r.bootstrap ?? null));
  if (bootstrap) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-app-text-primary">{t("install.created")}</p>
        <pre dir="auto" className="whitespace-pre-wrap rounded-lg bg-app-surface-sunken p-3 text-[13px] leading-relaxed text-app-text-primary">{bootstrap}</pre>
        <CopyValue value={bootstrap} label={t("install.bootstrapLabel")} />
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <Field label={t("install.surface")}>
        <select name="surface" value={surface} onChange={(e) => setSurface(e.target.value)} className={INPUT}>
          {SURFACES.map((k) => (
            <option key={k} value={k}>{tl(`surface.${k}`)}</option>
          ))}
        </select>
      </Field>
      <Field label={t("install.scope")}>
        <select name="clientScope" value={scope} onChange={(e) => setScope(e.target.value)} className={INPUT}>
          <option value="ONE">{t("install.scopeOne")}</option>
          <option value="LIST">{t("install.scopeList")}</option>
          <option value="ALL_MINE">{t("install.scopeAll")}</option>
        </select>
      </Field>
      {scope !== "ALL_MINE" && (
        <Field label={t("install.clients")}>
          <select name="clientIds" multiple={scope === "LIST"} required className={`${INPUT} ${scope === "LIST" ? "h-36" : ""}`}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
      )}
      {(surface === "SCHEDULED" || surface === "PERSISTENT_SESSION") && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("install.cron")}>
            <input name="cron" dir="ltr" placeholder="52 7,14 * * *" className={INPUT} />
          </Field>
          <Field label={t("install.tz")}>
            <input name="tz" dir="ltr" defaultValue="Asia/Jerusalem" className={INPUT} />
          </Field>
        </div>
      )}
      <Field label={t("install.check")}>
        <select name="checkEvery" defaultValue="DAILY" className={INPUT}>
          <option value="RUN">{t("install.checkRun")}</option>
          <option value="DAILY">{t("install.checkDaily")}</option>
          <option value="WEEKLY">{t("install.checkWeekly")}</option>
        </select>
      </Field>
      <Field label={t("install.account")}>
        <input name="claudeAccount" dir="ltr" placeholder="ops@ankora.co.il" className={INPUT} />
      </Field>
      {installParams.map((p) => (
        <Field key={p.key} label={p.required ? t("install.paramRequired", { label: p.label }) : p.label}>
          <input name={`value:${p.key}`} dir="auto" defaultValue={p.default ?? ""} className={INPUT} />
        </Field>
      ))}
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t("common.creating") : t("install.submit")}
      </button>
    </form>
  );
}

export function NewInstallation(props: { agentId: string; clients: ClientOption[]; installParams: AgentParam[]; defaultSurface: string }) {
  const t = useTranslations("agents.forms");
  return (
    <Drawer triggerLabel={t("install.newTrigger")} title={t("install.newTrigger")}>
      <InstallForm {...props} />
    </Drawer>
  );
}

export function RemoveInstallation({ id }: { id: string }) {
  const t = useTranslations("agents.forms");
  return <ActionButton run={() => removeInstallationAction(id)} label={t("common.remove")} done={t("install.removed")} />;
}

export function AcceptUpdate({ id, version }: { id: string; version: number }) {
  const t = useTranslations("agents.forms");
  return <ActionButton run={() => acceptUpdateAction(id, version)} label={t("install.update")} done={t("install.updated", { version })} tone="primary" />;
}

/// "Revert to version N": opens a draft that copies it, then shows that draft.
export function RevertToVersion({ agentId, slug, version }: { agentId: string; slug: string; version: number }) {
  const t = useTranslations("agents.forms");
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  async function click() {
    setBusy(true);
    const r = await revertToVersionAction(agentId, version);
    setBusy(false);
    if (r.error) return showToast({ tone: "error", title: t("common.notDone"), description: r.error });
    showToast({ tone: "info", title: t("revert.opened", { version }), description: t("revert.openedNote") });
    router.push(`/app/agents/${slug}/versions?v=${r.version}`);
  }
  return (
    <button type="button" onClick={click} disabled={busy} className="tap-area rounded-full border border-app-border bg-white px-4 py-2 text-[13px] text-app-text-primary disabled:opacity-50">
      {t("revert.button", { version })}
    </button>
  );
}

// --- Phase 3: library and lessons -------------------------------------------

function SharedForm({ block }: { block?: { key: string; title: string; kind: string; body: string } }) {
  const t = useTranslations("agents.forms");
  const tl = useTranslations("agents.labels");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(proposeSharedAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="key" value={block?.key ?? ""} />
      <Field label={t("common.title")}>
        <input name="title" required maxLength={120} dir="auto" defaultValue={block?.title ?? ""} className={INPUT} />
      </Field>
      <Field label={t("common.blockKind")}>
        <select name="kind" defaultValue={block?.kind ?? "language"} className={INPUT}>
          {BLOCK_KINDS.map((k) => (
            <option key={k} value={k}>{tl(`blockKind.${k}`)}</option>
          ))}
        </select>
      </Field>
      <Field label={t("common.text")}>
        <textarea name="body" rows={10} required dir="auto" defaultValue={block?.body ?? ""} className={INPUT} />
      </Field>
      <Field label={t("common.changeNote")} hint={t("shared.changeNoteHint")}>
        <input name="changeNote" dir="auto" className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t("common.saving") : t("shared.submit")}
      </button>
    </form>
  );
}

export function EditShared({ block }: { block?: { key: string; title: string; kind: string; body: string } }) {
  const t = useTranslations("agents.forms");
  return (
    <Drawer triggerLabel={block ? t("common.edit") : t("common.newBlock")} title={block ? t("shared.title", { title: block.title }) : t("shared.newTitle")} variant={block ? "link" : "primary"}>
      <SharedForm block={block} />
    </Drawer>
  );
}

function RejectSharedForm({ id }: { id: string }) {
  const t = useTranslations("agents.forms");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(rejectSharedAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={id} />
      <Field label={t("common.rejectNote")}>
        <input name="reason" required dir="auto" className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("common.saving") : t("common.reject")}
      </button>
    </form>
  );
}

export function DecideShared({ id, version, reach }: { id: string; version: number; reach: number }) {
  const t = useTranslations("agents.forms");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ActionButton run={() => approveSharedAction(id)} label={reach ? t("shared.approveReach", { version, reach }) : t("shared.approve", { version })} done={t("shared.approved")} tone="primary" />
      <Drawer triggerLabel={t("common.reject")} title={t("version.rejectTitle", { version })} variant="link">
        <RejectSharedForm id={id} />
      </Drawer>
    </div>
  );
}

function FromLibraryForm({ agentId, options }: { agentId: string; options: { key: string; title: string }[] }) {
  const t = useTranslations("agents.forms");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(addFromLibraryAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <Field label={t("fromLibrary.field")} hint={t("fromLibrary.hint")}>
        <select name="key" required className={INPUT}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>{o.title}</option>
          ))}
        </select>
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t("common.saving") : t("fromLibrary.submit")}
      </button>
    </form>
  );
}

export function AddFromLibrary({ agentId, options }: { agentId: string; options: { key: string; title: string }[] }) {
  const t = useTranslations("agents.forms");
  if (options.length === 0) return null;
  return (
    <Drawer triggerLabel={t("fromLibrary.trigger")} title={t("fromLibrary.field")} variant="link">
      <FromLibraryForm agentId={agentId} options={options} />
    </Drawer>
  );
}

export function LessonButtons({ id }: { id: string }) {
  const t = useTranslations("agents.forms");
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton run={() => decideLessonAction(id, "USED")} label={t("lessons.used")} done={t("lessons.usedDone")} />
      <ActionButton run={() => decideLessonAction(id, "DISMISSED")} label={t("lessons.dismissed")} done={t("lessons.dismissedDone")} />
    </div>
  );
}

// --- Categories (24.11.2026) -------------------------------------------------

type Category = { id: string; name: string };

function CategoriesForm({ agentId, current, options }: { agentId: string; current: string[]; options: Category[] }) {
  const t = useTranslations("agents.forms");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(setAgentCategoriesAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <p className="text-[13px] text-app-text-secondary">{t("categories.hint")}</p>
      {options.length === 0 ? (
        <p className="text-[13px] text-app-text-tertiary">{t("categories.noneYet")}</p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className={LABEL}>{t("categories.field")}</legend>
          {options.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="categoryId" value={c.id} defaultChecked={current.includes(c.id)} />
              <span dir="auto">{c.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t("common.saving") : t("common.save")}
      </button>
    </form>
  );
}

export function PickCategories({ agentId, current, options, agentName }: { agentId: string; current: string[]; options: Category[]; agentName?: string }) {
  const t = useTranslations("agents.forms");
  return (
    <Drawer triggerLabel={current.length ? t("common.change") : t("categories.pick")} title={agentName ? t("categories.titleFor", { name: agentName }) : t("categories.field")} variant="link">
      <CategoriesForm agentId={agentId} current={current} options={options} />
    </Drawer>
  );
}

/// A small one-click write in the management list, with the screen re-read after it.
function CategoryButton({ run, label, disabled }: { run: () => Promise<{ error?: string }>; label: string; disabled?: boolean }) {
  const t = useTranslations("agents.forms.common");
  const { showToast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function click() {
    setBusy(true);
    const r = await run();
    setBusy(false);
    if (r.error) showToast({ tone: "error", title: t("notDone"), description: r.error });
    else router.refresh();
  }
  return (
    <button type="button" onClick={click} disabled={busy || disabled} className="tap-area rounded-full border border-app-border bg-white px-2.5 py-1 text-xs text-app-text-primary disabled:opacity-40">
      {label}
    </button>
  );
}

function RenameCategory({ category }: { category: Category }) {
  const t = useTranslations("agents.forms");
  const { onSubmit, pending, error } = useActionForm(renameAgentCategoryAction);
  return (
    <form onSubmit={onSubmit} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={category.id} />
      <input name="name" required maxLength={40} defaultValue={category.name} dir="auto" aria-label={t("categories.name")} className={`${INPUT} mt-0 min-w-0 flex-1`} />
      <button type="submit" disabled={pending} className="tap-area shrink-0 rounded-full border border-app-border bg-white px-2.5 py-1 text-xs disabled:opacity-50">
        {pending ? t("common.saving") : t("common.save")}
      </button>
      <Err error={error} />
    </form>
  );
}

function AddCategory() {
  const t = useTranslations("agents.forms");
  const [key, setKey] = useState(0);
  const { onSubmit, pending, error } = useActionForm(createAgentCategoryAction, () => setKey((k) => k + 1));
  return (
    <form key={key} onSubmit={onSubmit} className="flex flex-col gap-2">
      <Field label={t("categories.add")}>
        <input name="name" required maxLength={40} dir="auto" className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t("common.saving") : t("categories.addSubmit")}
      </button>
    </form>
  );
}

export function ManageCategories({ categories }: { categories: (Category & { archived: boolean; agents: number })[] }) {
  const t = useTranslations("agents.forms");
  const active = categories.filter((c) => !c.archived);
  const archived = categories.filter((c) => c.archived);
  return (
    <Drawer triggerLabel={t("categories.manage")} title={t("categories.manage")} variant="link">
      <div className="flex flex-col gap-5">
        <p className="text-[13px] text-app-text-secondary">{t("categories.manageHint")}</p>
        {active.length > 0 && (
          <ul className="flex flex-col gap-3">
            {active.map((c, i) => (
              <li key={c.id} className="flex flex-col gap-1.5 rounded-lg border border-app-border p-2.5">
                <RenameCategory category={c} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-app-text-tertiary">{t("categories.agents", { count: c.agents })}</span>
                  <CategoryButton run={() => moveAgentCategoryAction(c.id, "up")} label={t("categories.up")} disabled={i === 0} />
                  <CategoryButton run={() => moveAgentCategoryAction(c.id, "down")} label={t("categories.down")} disabled={i === active.length - 1} />
                  <CategoryButton run={() => setAgentCategoryArchivedAction(c.id, true)} label={t("categories.archive")} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <AddCategory />
        {archived.length > 0 && (
          <div>
            <h3 className={LABEL}>{t("categories.archived")}</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {archived.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span dir="auto" className="text-app-text-secondary">{c.name}</span>
                  <CategoryButton run={() => setAgentCategoryArchivedAction(c.id, false)} label={t("categories.restore")} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Drawer>
  );
}
