import { notFound } from "next/navigation";
import { PageBack } from "@/components/app/BackSlot";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { flowForEditor, type FlowEditorData } from "@/lib/app-domain/processes";
import { FlowEditor } from "./FlowEditor";

// The procedure flow editor (task cmvtivumj000pjs08q9qj4t67, prototype on
// branch ops/procedure-flow-editor): build a procedure with conditions and
// branches, and put it live with "שמור והפעל".

export const metadata = { robots: { index: false, follow: false } };

export default async function ProcessFlowPage(props: { params: Promise<{ clientId: string; processId: string }> }) {
  const { clientId, processId } = await props.params;
  const user = await requireUser();
  let data: FlowEditorData;
  try {
    data = await flowForEditor(user, processId);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    if (err instanceof Error && /לא נמצא/.test(err.message)) notFound();
    throw err;
  }
  if (data.clientId !== clientId) notFound();
  return (
    <div className="mx-auto w-full max-w-appContent px-4 py-6">
      <PageBack href={`/app/clients/${clientId}`} label="חזרה לתיק הלקוח" />
      <FlowEditor
        clientId={clientId}
        processId={processId}
        code={data.code}
        title={data.title}
        triggerText={data.triggerText}
        latestVersion={data.latestVersion}
        latestStatus={data.latestStatus}
        initial={data.flow}
        fromList={data.fromList}
        highlights={data.highlights}
        outputs={data.outputs}
        contacts={data.contacts}
      />
    </div>
  );
}
