import ClientDetailPage from "../../page";

// 13.11.2026 (processes redesign, stage 2): a process's own page. It reads
// what the client file reads for its processes, and shows one of them
// (ProcessPage). `?rhythm=open` lands with the rhythm editor open, as a new
// process does.
export default async function ProcessDetailPage(props: { params: Promise<{ clientId: string; processId: string }>; searchParams?: Promise<{ rhythm?: string }> }) {
  const { clientId, processId } = await props.params;
  const sp = await props.searchParams;
  return ClientDetailPage({ params: Promise.resolve({ clientId }), searchParams: Promise.resolve({ tab: "file", process: processId, rhythm: sp?.rhythm }) });
}
