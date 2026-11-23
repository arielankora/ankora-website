"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
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
  createAgentAction,
  deleteBlockAction,
  deleteParamAction,
  discardDraftAction,
  installAction,
  markFaultyAction,
  rejectVersionAction,
  removeInstallationAction,
  saveBlockAction,
  saveMetaAction,
  saveParamAction,
  setClientValueAction,
  submitDraftAction,
} from "./actions";
import { BLOCK_KIND_LABEL, PARAM_LEVEL_LABEL, PARAM_TYPE_LABEL, SURFACE_LABEL } from "./labels";
import type { AgentBlock, AgentParam, AgentRequirements } from "@/lib/agents/model";

// Agents, phase 1: the screens' forms. Drawers, like every write form in
// the app; the server pages around them only read.

const INPUT = "mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";
const LABEL = "block text-xs font-medium text-app-text-secondary";
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
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  async function click() {
    setBusy(true);
    const r = await run();
    setBusy(false);
    if (r.error) showToast({ tone: "error", title: "לא בוצע", description: r.error });
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
  const router = useRouter();
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(createAgentAction, (r) => {
    close();
    if (r.slug) router.push(`/app/agents/${r.slug}/instructions`);
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <Field label="שם הסוכן">
        <input name="name" required maxLength={80} dir="auto" className={INPUT} />
      </Field>
      <Field label="מה הוא עושה, בשורה">
        <input name="purpose" required maxLength={300} dir="auto" className={INPUT} />
      </Field>
      <Field label="איפה הוא רץ">
        <select name="kind" className={INPUT} defaultValue="SCHEDULED">
          <option value="CLIENT_PROJECT">פרויקט Claude (שיחה)</option>
          <option value="SCHEDULED">משימה מתוזמנת</option>
          <option value="SKILL">סקיל</option>
        </select>
      </Field>
      <p className="text-[11px] text-app-text-tertiary">אפשר גם לייבא פרומפט קיים: לבקש מ-Claude לשמור אותו כטיוטה עם הכלי save_agent_draft.</p>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? "שומר..." : "ליצור סוכן"}
      </button>
    </form>
  );
}

export function NewAgent() {
  return (
    <Drawer triggerLabel="סוכן חדש" title="סוכן חדש">
      <NewAgentForm />
    </Drawer>
  );
}

// --- Blocks --------------------------------------------------------------------

type ClientOption = { id: string; name: string };

function BlockForm({ agentId, block, clients, params }: { agentId: string; block?: AgentBlock; clients: ClientOption[]; params: AgentParam[] }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(saveBlockAction, close);
  const [body, setBody] = useState(block?.body ?? "");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="originalKey" value={block?.key ?? ""} />
      <input type="hidden" name="key" value={block?.key ?? ""} />
      <Field label="סוג הקטע">
        <select name="kind" defaultValue={block?.kind ?? "steps"} className={INPUT}>
          {Object.entries(BLOCK_KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </Field>
      <Field label="כותרת">
        <input name="title" required maxLength={120} dir="auto" defaultValue={block?.title ?? ""} className={INPUT} />
      </Field>
      <Field label="הטקסט" hint="פרמטר נכתב בסוגריים כפולים, למשל {{חתימה}}.">
        <textarea name="body" rows={10} dir="auto" value={body} onChange={(e) => setBody(e.target.value)} className={INPUT} />
      </Field>
      {params.length > 0 && (
        <div className="-mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-app-text-secondary">להוסיף פרמטר:</span>
          {params.map((p) => (
            <button key={p.key} type="button" onClick={() => setBody((b) => `${b}{{${p.key}}}`)} className="rounded-md border border-dashed border-app-accent px-2 py-1 text-app-text-accent">
              {p.label}
            </button>
          ))}
        </div>
      )}
      <Field label="למה הכלל קיים (לא חובה)">
        <input name="why" maxLength={2000} dir="auto" defaultValue={block?.why ?? ""} className={INPUT} />
      </Field>
      <Field label="רק ללקוח (תוספת ללקוח)">
        <select name="clientId" defaultValue={block?.clientId ?? ""} className={INPUT}>
          <option value="">לכל הלקוחות</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-app-text-primary">
        <input type="checkbox" name="safety" defaultChecked={!!block?.safety} />
        גבול בטיחות (מוצג ב&quot;לעולם לא&quot;)
      </label>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? "שומר..." : "לשמור בטיוטה"}
      </button>
    </form>
  );
}

export function EditBlock(props: { agentId: string; block?: AgentBlock; clients: ClientOption[]; params: AgentParam[] }) {
  return (
    <Drawer triggerLabel={props.block ? "לערוך" : "להוסיף קטע"} title={props.block ? `עריכה: ${props.block.title}` : "קטע חדש"} variant={props.block ? "link" : "primary"}>
      <BlockForm {...props} />
    </Drawer>
  );
}

export function DeleteBlock({ agentId, blockKey }: { agentId: string; blockKey: string }) {
  return <ActionButton run={() => deleteBlockAction(agentId, blockKey)} label="להסיר" done="הקטע הוסר מהטיוטה" />;
}

// --- Parameters --------------------------------------------------------------

function ParamForm({ agentId, param }: { agentId: string; param?: AgentParam }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(saveParamAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="originalKey" value={param?.key ?? ""} />
      <Field label="שם בהוראות" hint="מה שנכתב בין הסוגריים, למשל חתימה. אותיות, ספרות וקו תחתון.">
        <input name="key" required maxLength={40} dir="auto" defaultValue={param?.key ?? ""} className={INPUT} />
      </Field>
      <Field label="תיאור">
        <input name="label" required maxLength={80} dir="auto" defaultValue={param?.label ?? ""} className={INPUT} />
      </Field>
      <Field label="נקבע ברמה">
        <select name="level" defaultValue={param?.level ?? "CLIENT"} className={INPUT}>
          {Object.entries(PARAM_LEVEL_LABEL).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </Field>
      <Field label="סוג">
        <select name="type" defaultValue={param?.type ?? "TEXT"} className={INPUT}>
          {Object.entries(PARAM_TYPE_LABEL).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </Field>
      <Field label="ערך ברירת מחדל">
        <input name="default" maxLength={2000} dir="auto" defaultValue={param?.default ?? ""} className={INPUT} />
      </Field>
      <Field label="מתיק הלקוח" hint="רק לפרמטר ברמת לקוח. הערך מתעדכן לבד מהתיק.">
        <select name="clientField" defaultValue={param?.clientField ?? ""} className={INPUT}>
          <option value="">לא, מקלידים ערך</option>
          <option value="name">שם הלקוח</option>
          <option value="domains">הדומיינים של הלקוח</option>
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-app-text-primary">
        <input type="checkbox" name="required" defaultChecked={!!param?.required} />
        חובה. בלי ערך, הסוכן לא עובד על הלקוח או על ההתקנה
      </label>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? "שומר..." : "לשמור בטיוטה"}
      </button>
    </form>
  );
}

export function EditParam({ agentId, param }: { agentId: string; param?: AgentParam }) {
  return (
    <Drawer triggerLabel={param ? "לערוך" : "פרמטר חדש"} title={param ? `פרמטר: ${param.label}` : "פרמטר חדש"} variant={param ? "link" : "primary"}>
      <ParamForm agentId={agentId} param={param} />
    </Drawer>
  );
}

export function DeleteParam({ agentId, paramKey }: { agentId: string; paramKey: string }) {
  return <ActionButton run={() => deleteParamAction(agentId, paramKey)} label="להסיר" done="הפרמטר הוסר מהטיוטה" />;
}

function ClientValueForm({ agentId, clientId, paramKey, value }: { agentId: string; clientId: string; paramKey: string; value: string }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(setClientValueAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="key" value={paramKey} />
      <Field label="ערך" hint="ריק: חוזרים לברירת המחדל. הערך חל מהריצה הבאה, בלי גרסה חדשה.">
        <textarea name="value" rows={3} dir="auto" defaultValue={value} className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? "שומר..." : "לשמור"}
      </button>
    </form>
  );
}

export function EditClientValue(props: { agentId: string; clientId: string; clientName: string; paramKey: string; paramLabel: string; value: string }) {
  return (
    <Drawer triggerLabel={props.value ? "לשנות" : "לקבוע"} title={`${props.paramLabel}: ${props.clientName}`} variant="link">
      <ClientValueForm {...props} />
    </Drawer>
  );
}

// --- Version meta, draft and decision ---------------------------------------

function MetaForm({ agentId, actionLevel, changeNote, requirements }: { agentId: string; actionLevel: string; changeNote: string; requirements: AgentRequirements }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(saveMetaAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <Field label="מה השתנה ולמה" hint="זה מה שמי שמריץ את הסוכן יראה כשיציעו לו לעדכן.">
        <textarea name="changeNote" rows={3} dir="auto" defaultValue={changeNote} className={INPUT} />
      </Field>
      <Field label="רמת פעולה">
        <select name="actionLevel" defaultValue={actionLevel} className={INPUT}>
          <option value="READ">קורא בלבד</option>
          <option value="DRAFT">כותב טיוטות ותוויות</option>
          <option value="SEND">שולח בשם אדם</option>
        </select>
      </Field>
      <Field label="חיבורים נדרשים" hint="מופרדים בפסיק.">
        <input name="connectors" dir="ltr" defaultValue={requirements.connectors.join(", ")} className={INPUT} />
      </Field>
      <Field label="סקילים נדרשים">
        <input name="skills" dir="ltr" defaultValue={requirements.skills.join(", ")} className={INPUT} />
      </Field>
      <Field label="ריפואים">
        <input name="repos" dir="ltr" defaultValue={requirements.repos.join(", ")} className={INPUT} />
      </Field>
      <Field label="MCP מקומי במחשב">
        <input name="localMcp" dir="ltr" defaultValue={requirements.localMcp.join(", ")} className={INPUT} />
      </Field>
      <Field label="רכיבים חיצוניים (Apps Script וכדומה)">
        <input name="externalRunners" dir="auto" defaultValue={requirements.externalRunners.join(", ")} className={INPUT} />
      </Field>
      <Field label="מודל">
        <input name="model" dir="ltr" defaultValue={requirements.model ?? ""} className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? "שומר..." : "לשמור בטיוטה"}
      </button>
    </form>
  );
}

export function EditMeta(props: { agentId: string; actionLevel: string; changeNote: string; requirements: AgentRequirements }) {
  return (
    <Drawer triggerLabel="הערת שינוי ודרישות" title="הערת שינוי, רמת פעולה ודרישות" variant="link">
      <MetaForm {...props} />
    </Drawer>
  );
}

export function DraftButtons({ versionId, canDiscard }: { versionId: string; canDiscard: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {canDiscard && <ActionButton run={() => discardDraftAction(versionId)} label="לבטל טיוטה" done="הטיוטה בוטלה" />}
      <ActionButton run={() => submitDraftAction(versionId)} label="לשלוח לאישור" done="נשלח לאישור מנהל" tone="primary" />
    </div>
  );
}

function ArchiveForm({ agentId }: { agentId: string }) {
  const router = useRouter();
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(archiveAgentAction, () => {
    close();
    router.push("/app/agents");
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <p className="text-[13px] text-app-text-secondary">הסוכן יוצא מהרשימה, מתור האישורים ומהמחבר. הגרסאות שלו נשמרות. סוכן עם התקנות פעילות לא עובר לארכיון.</p>
      <Field label="למה (חובה)">
        <input name="reason" required dir="auto" className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "להעביר לארכיון"}
      </button>
    </form>
  );
}

export function ArchiveAgent({ agentId, name }: { agentId: string; name: string }) {
  return (
    <Drawer triggerLabel="להעביר לארכיון" title={`העברת "${name}" לארכיון`} variant="link">
      <ArchiveForm agentId={agentId} />
    </Drawer>
  );
}

function RejectForm({ id }: { id: string }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(rejectVersionAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={id} />
      <Field label="הערה למי שכתב (חובה)">
        <input name="reason" required dir="auto" className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "לדחות"}
      </button>
    </form>
  );
}

export function DecideVersion({ id, version }: { id: string; version: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ActionButton run={() => approveVersionAction(id)} label={`לאשר גרסה ${version}`} done={`גרסה ${version} אושרה`} tone="primary" />
      <Drawer triggerLabel="לדחות" title={`דחיית גרסה ${version}`} variant="link">
        <RejectForm id={id} />
      </Drawer>
    </div>
  );
}

function FaultyForm({ id }: { id: string }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(markFaultyAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-app-text-primary">כל ההתקנות שרצות על הגרסה הזו יחזרו מיד לגרסה המאושרת הקודמת, בלי לשאול. אחר כך מתקנים בטיוטה חדשה.</p>
      <Field label="מה התקלה (חובה)">
        <input name="reason" required dir="auto" className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-error px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "שומר..." : "לסמן כתקולה ולחזור לגרסה הקודמת"}
      </button>
    </form>
  );
}

export function MarkFaulty({ id, version }: { id: string; version: number }) {
  return (
    <Drawer triggerLabel="לסמן כתקולה" title={`גרסה ${version} תקולה`} variant="link">
      <FaultyForm id={id} />
    </Drawer>
  );
}

// --- Installations -----------------------------------------------------------

function InstallForm({ agentId, clients, installParams, defaultSurface }: { agentId: string; clients: ClientOption[]; installParams: AgentParam[]; defaultSurface: string }) {
  const [bootstrap, setBootstrap] = useState<string | null>(null);
  const [scope, setScope] = useState("ONE");
  const [surface, setSurface] = useState(defaultSurface);
  const { onSubmit, pending, error } = useActionForm(installAction, (r) => setBootstrap(r.bootstrap ?? null));
  if (bootstrap) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-app-text-primary">ההתקנה נוצרה. זה הטקסט היחיד שנשאר ב-Claude: להדביק אותו בהוראות הפרויקט, בפרומפט של המשימה המתוזמנת או בתחילת השיחה הקבועה.</p>
        <pre dir="rtl" className="whitespace-pre-wrap rounded-lg bg-app-surface-sunken p-3 text-[13px] leading-relaxed text-app-text-primary">{bootstrap}</pre>
        <CopyValue value={bootstrap} label="טקסט ההפעלה" />
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <Field label="איפה זה ירוץ">
        <select name="surface" value={surface} onChange={(e) => setSurface(e.target.value)} className={INPUT}>
          {Object.entries(SURFACE_LABEL).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </Field>
      <Field label="על אילו לקוחות">
        <select name="clientScope" value={scope} onChange={(e) => setScope(e.target.value)} className={INPUT}>
          <option value="ONE">לקוח אחד</option>
          <option value="LIST">כמה לקוחות</option>
          <option value="ALL_MINE">כל הלקוחות שלי</option>
        </select>
      </Field>
      {scope !== "ALL_MINE" && (
        <Field label="לקוחות">
          <select name="clientIds" multiple={scope === "LIST"} required className={`${INPUT} ${scope === "LIST" ? "h-36" : ""}`}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
      )}
      {(surface === "SCHEDULED" || surface === "PERSISTENT_SESSION") && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="תזמון (cron)">
            <input name="cron" dir="ltr" placeholder="52 7,14 * * *" className={INPUT} />
          </Field>
          <Field label="אזור זמן">
            <input name="tz" dir="ltr" defaultValue="Asia/Jerusalem" className={INPUT} />
          </Field>
        </div>
      )}
      <Field label="בדיקת עדכון">
        <select name="checkEvery" defaultValue="DAILY" className={INPUT}>
          <option value="RUN">בכל ריצה</option>
          <option value="DAILY">פעם ביום</option>
          <option value="WEEKLY">פעם בשבוע</option>
        </select>
      </Field>
      <Field label="חשבון Claude (אם לא שלך)">
        <input name="claudeAccount" dir="ltr" placeholder="ops@ankora.co.il" className={INPUT} />
      </Field>
      {installParams.map((p) => (
        <Field key={p.key} label={`${p.label}${p.required ? " (חובה)" : ""}`}>
          <input name={`value:${p.key}`} dir="auto" defaultValue={p.default ?? ""} className={INPUT} />
        </Field>
      ))}
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? "יוצר..." : "ליצור התקנה"}
      </button>
    </form>
  );
}

export function NewInstallation(props: { agentId: string; clients: ClientOption[]; installParams: AgentParam[]; defaultSurface: string }) {
  return (
    <Drawer triggerLabel="התקנה חדשה" title="התקנה חדשה">
      <InstallForm {...props} />
    </Drawer>
  );
}

export function RemoveInstallation({ id }: { id: string }) {
  return <ActionButton run={() => removeInstallationAction(id)} label="להסיר" done="ההתקנה הוסרה" />;
}

export function AcceptUpdate({ id, version }: { id: string; version: number }) {
  return <ActionButton run={() => acceptUpdateAction(id, version)} label="לעדכן" done={`ההתקנה עודכנה לגרסה ${version}`} tone="primary" />;
}

// --- Phase 3: library and lessons -------------------------------------------

function SharedForm({ block }: { block?: { key: string; title: string; kind: string; body: string } }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(proposeSharedAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="key" value={block?.key ?? ""} />
      <Field label="כותרת">
        <input name="title" required maxLength={120} dir="auto" defaultValue={block?.title ?? ""} className={INPUT} />
      </Field>
      <Field label="סוג הקטע">
        <select name="kind" defaultValue={block?.kind ?? "language"} className={INPUT}>
          {Object.entries(BLOCK_KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </Field>
      <Field label="הטקסט">
        <textarea name="body" rows={10} required dir="auto" defaultValue={block?.body ?? ""} className={INPUT} />
      </Field>
      <Field label="מה השתנה ולמה" hint="מופיע בגרסה החדשה של כל סוכן שמשתמש בקטע.">
        <input name="changeNote" dir="auto" className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? "שומר..." : "לשלוח לאישור מנהל"}
      </button>
    </form>
  );
}

export function EditShared({ block }: { block?: { key: string; title: string; kind: string; body: string } }) {
  return (
    <Drawer triggerLabel={block ? "לערוך" : "קטע חדש"} title={block ? `ספרייה: ${block.title}` : "קטע חדש בספרייה"} variant={block ? "link" : "primary"}>
      <SharedForm block={block} />
    </Drawer>
  );
}

function RejectSharedForm({ id }: { id: string }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(rejectSharedAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={id} />
      <Field label="הערה למי שכתב (חובה)">
        <input name="reason" required dir="auto" className={INPUT} />
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "לדחות"}
      </button>
    </form>
  );
}

export function DecideShared({ id, version, reach }: { id: string; version: number; reach: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ActionButton run={() => approveSharedAction(id)} label={`לאשר גרסה ${version}${reach ? `, ותעדכן ${reach} סוכנים` : ""}`} done="אושר, והסוכנים עודכנו" tone="primary" />
      <Drawer triggerLabel="לדחות" title={`דחיית גרסה ${version}`} variant="link">
        <RejectSharedForm id={id} />
      </Drawer>
    </div>
  );
}

function FromLibraryForm({ agentId, options }: { agentId: string; options: { key: string; title: string }[] }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(addFromLibraryAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="agentId" value={agentId} />
      <Field label="קטע מהספרייה" hint="הקטע נכנס לטיוטה כמו שהוא, ומתעדכן לבד כשגרסה חדשה שלו מאושרת בספרייה.">
        <select name="key" required className={INPUT}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>{o.title}</option>
          ))}
        </select>
      </Field>
      <Err error={error} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? "שומר..." : "להוסיף לטיוטה"}
      </button>
    </form>
  );
}

export function AddFromLibrary({ agentId, options }: { agentId: string; options: { key: string; title: string }[] }) {
  if (options.length === 0) return null;
  return (
    <Drawer triggerLabel="להוסיף מהספרייה" title="קטע מהספרייה" variant="link">
      <FromLibraryForm agentId={agentId} options={options} />
    </Drawer>
  );
}

export function LessonButtons({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton run={() => decideLessonAction(id, "USED")} label="נכנס לטיוטה" done="סומן כטופל" />
      <ActionButton run={() => decideLessonAction(id, "DISMISSED")} label="לא רלוונטי" done="ההצעה נסגרה" />
    </div>
  );
}
