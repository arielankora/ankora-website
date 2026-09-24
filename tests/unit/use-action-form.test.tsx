// @vitest-environment jsdom
//
// Declared per file rather than in vitest.config.ts: this is the only
// suite in the repo that needs a DOM, and the whole node suite should not
// pay for one. (Vitest 5 removed `environmentMatchGlobs`; the docblock is
// what replaced it.)
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useState, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useActionForm } from "@/components/app/useActionForm";

// Whether a screen refreshes itself after a write has now been the subject
// of three investigations and roughly twenty-five CI rounds, and every one
// of them had to sample a browser suite to ask the question. This file
// asks it directly.
//
// The property under test is one sentence: **a successful write asks the
// router to refresh, and it does so even when the form that performed the
// write is removed from the screen in the same breath.**
//
// That second half is the whole thing. Five forms in this product sit
// inside a drawer and close it on success, and closing the drawer unmounts
// the form. A refresh that is requested from that form's own effect is a
// refresh that never happens, because React does not run the effects of a
// component it is removing.

const refresh = vi.fn();
// ONE router object for every call, because that is what Next returns.
// A mock that builds a fresh object per render changes the identity of a
// dependency on every render, which would make an effect keyed on the
// router look like it fires too often - a defect in the double, reported
// as a defect in the product.
const router = { refresh };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

beforeEach(() => refresh.mockClear());
afterEach(() => cleanup());

/// A drawer, reduced to the one thing that matters here: it renders its
/// child only while open, and the child can close it.
function Drawer({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(true);
  return <div>{open ? children(() => setOpen(false)) : <p>closed</p>}</div>;
}

function Form({ action, onSuccess }: { action: () => Promise<{ ok?: boolean; error?: string }>; onSuccess?: () => void }) {
  const { onSubmit, pending, error } = useActionForm(async () => action(), onSuccess);
  return (
    <form onSubmit={onSubmit}>
      <button type="submit">{pending ? "saving" : "save"}</button>
      {error ? <p>{error}</p> : null}
    </form>
  );
}

async function submit() {
  await act(async () => {
    screen.getByRole("button", { name: /save|saving/ }).click();
    // Let the action's promise and the transition settle.
    await Promise.resolve();
  });
  // A refresh scheduled outside React's commit lands on a later task.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("a successful write asks for a refresh", () => {
  it("does so for a form that stays on the screen", async () => {
    render(<Form action={async () => ({ ok: true })} />);
    await submit();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does so even when success closes the drawer the form lives in", async () => {
    // The regression this file exists for. `onSuccess` here is the
    // drawer's close, exactly as five forms in this product use it: the
    // write succeeds, the drawer closes, the form is gone - and the list
    // behind it has to be told to re-read itself by something that is
    // still alive.
    render(
      <Drawer>
        {(close) => <Form action={async () => ({ ok: true })} onSuccess={close} />}
      </Drawer>
    );
    await submit();

    expect(screen.getByText("closed")).toBeDefined();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not ask for one when the action reports an error", async () => {
    render(<Form action={async () => ({ error: "nope" })} />);
    await submit();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("nope")).toBeDefined();
  });

  it("does not ask for one when the action throws", async () => {
    render(
      <Form
        action={async () => {
          throw new Error("boom");
        }}
      />
    );
    await submit();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks once per successful write, not once ever", async () => {
    // A counter rather than a boolean, for the same reason the hook uses
    // one: two saves in a row are two refreshes, and a flag that is
    // already set is a refresh that never happens.
    render(<Form action={async () => ({ ok: true })} />);
    await submit();
    await submit();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
