import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { stepsForEditor, type StepsEditorData } from "@/lib/app-domain/processes";
import { StepsEditor } from "./StepsEditor";

// The steps editor (14.11.2026, processes redesign, stage 3), built to the
// "מסך 4: עורך השלבים" board (ops-runbooks/processes-redesign-design/
// Steps.dc.html in claude-backup): a list by default, a flow once a
// condition is added, one side panel for a step in both.

export const metadata = { robots: { index: false, follow: false } };

export default async function ProcessStepsPage(props: { params: Promise<{ clientId: string; processId: string }> }) {
  const { clientId, processId } = await props.params;
  const user = await requireUser();
  let data: StepsEditorData;
  try {
    data = await stepsForEditor(user, processId);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    if (err instanceof Error && /לא נמצא/.test(err.message)) notFound();
    throw err;
  }
  if (data.clientId !== clientId) notFound();
  return <StepsEditor data={data} />;
}
