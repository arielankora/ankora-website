import { redirect } from "next/navigation";

// 14.11.2026 (processes redesign, stage 3): the flow editor is the flow view
// of the one steps editor, at /steps. Links saved before then land there.

export const metadata = { robots: { index: false, follow: false } };

export default async function ProcessFlowPage(props: { params: Promise<{ clientId: string; processId: string }> }) {
  const { clientId, processId } = await props.params;
  redirect(`/app/clients/${encodeURIComponent(clientId)}/processes/${encodeURIComponent(processId)}/steps`);
}
