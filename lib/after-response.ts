import "server-only";

/// Run best-effort follow-up work after the response has been sent.
///
/// WHY THIS EXISTS
///
/// Several domain mutations end by triggering work whose result the
/// caller does not use and whose failure it deliberately swallows -
/// alert re-evaluation after a time entry changes being the main one.
/// Every such call was written as:
///
///   await somethingBestEffort().catch((err) => console.error(err))
///
/// which is latency the user pays for an outcome they never see. If it
/// succeeds, nothing in the response changes. If it fails, the error is
/// logged and discarded. The only thing the `await` reliably does is
/// make the person wait.
///
/// That matters here more than the word "best-effort" suggests. Alert
/// evaluation reads the client's current hour bank, which is five or six
/// queries and up to two writes of its own - inside a request whose
/// actual job was to save one time entry.
///
/// WHY NOT JUST DROP THE AWAIT
///
/// A floating promise is not deferred work, it is work with no owner.
/// The serverless runtime is entitled to freeze or tear down the
/// invocation once the response is sent, so a bare `void work()` is a
/// coin flip about whether the alert is ever evaluated. Next's `after`
/// exists for exactly this: it keeps the invocation alive until the work
/// finishes, without holding up the response.
///
/// OUTSIDE A REQUEST
///
/// These domain functions are also called from crons, scripts and tests,
/// where there is no request to come after and `after` throws. There the
/// honest behaviour is to do the work inline and wait for it - a cron
/// that returns before its own side effects have run has not done its
/// job. So this falls back to awaiting, which also means the integration
/// suite observes the same behaviour it always did.
export async function afterResponse(label: string, work: () => Promise<unknown>): Promise<void> {
  // try/catch around an await, not `work().catch(...)`.
  //
  // `() => { throw }` never produces a promise, so a bare `.catch` lets
  // a synchronous throw escape - and it escapes into a mutation that has
  // already committed, turning a successful write into an error the user
  // sees. Every call site here is best-effort by definition; this makes
  // that true for both kinds of failure.
  const run = async () => {
    try {
      await work();
    } catch (err) {
      console.error(`${label} failed (non-fatal)`, err);
    }
  };

  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    // No request scope. `after` throws rather than returning a signal,
    // so the catch is the detection - and running inline is the correct
    // behaviour here, not a degraded one.
    await run();
  }
}
