// @vitest-environment jsdom
//
// Declared per file rather than in vitest.config.ts: this is the only
// suite in the repo that needs a DOM, and the whole node suite should not
// pay for one. (Vitest 5 removed `environmentMatchGlobs`; the docblock is
// what replaced it.)
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useActionForm } from "@/components/app/useActionForm";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";

// Whether a screen refreshes itself after a write has now been the subject
// of four investigations and roughly thirty CI rounds, and every one of
// them had to sample a twelve-minute browser suite to ask the question.
// This file asks it directly, in twenty milliseconds.
//
// The property under test is one sentence: **an accepted write asks the
// router to refresh exactly once, and something still mounted is the thing
// that asks.**
//
// Every clause there was bought with a failure.
//
// "Exactly once" - because two components asking is two requests for the
// same screen racing each other, and the loser of that race is what a CI
// trace caught being aborted at 41ms on a write that had already committed.
//
// "Something still mounted" - because five forms in this product close the
// drawer they live in when the server accepts the write, and closing the
// drawer unmounts the form. A refresh asked for by that form is a refresh
// that never happens.
//
// So the real Drawer is used here rather than a stand-in. The thing being
// tested is which of the two components owns the refresh, and a hand-rolled
// drawer would let that ownership be wrong in the product and right here.

const refresh = vi.fn();
const replace = vi.fn();
// ONE router object for every call, because that is what Next returns.
// A mock that builds a fresh object per render changes the identity of a
// dependency on every render, which would make an effect keyed on the
// router look like it fires too often - a defect in the double, reported
// as a defect in the product.
const router = { refresh, replace };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

/// What "the screen was asked to re-read itself" means, counted across
/// both mechanisms.
///
/// The two are not interchangeable and the difference is the point: a
/// form that stays on the screen asks for a refresh, and a drawer
/// navigates, because three CI runs aborted the refresh it used to ask
/// for. This helper exists so the shared cases below (an error, a throw,
/// two writes in a row) read the same for both and do not have to care.
function asks() {
  return refresh.mock.calls.length + replace.mock.calls.length;
}

beforeEach(() => {
  refresh.mockClear();
  replace.mockClear();
});
afterEach(() => cleanup());

function Form({
  action,
  closesDrawer = false,
}: {
  action: () => Promise<{ ok?: boolean; error?: string }>;
  closesDrawer?: boolean;
}) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(
    async () => action(),
    closesDrawer ? close : undefined
  );
  return (
    <form onSubmit={onSubmit}>
      <button type="submit">{pending ? "saving" : "save"}</button>
      {error ? <p>{error}</p> : null}
    </form>
  );
}

const ok = async () => ({ ok: true });

function openDrawer() {
  act(() => {
    screen.getByRole("button", { name: "add" }).click();
  });
}

async function submit() {
  await act(async () => {
    screen.getByRole("button", { name: /save|saving/ }).click();
    // Let the action's promise and the transition settle.
    await Promise.resolve();
  });
  // Nothing should need this any more: the refresh is asked for from an
  // effect, and effects flush inside act. The turn of the task queue stays
  // so that a regression to a timer would still be counted rather than
  // silently missed, and reported as "asked twice".
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("a successful write asks for a refresh", () => {
  it("does so for a form that stays on the screen", async () => {
    render(<Form action={ok} />);
    await submit();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does so when success closes the drawer the form lives in", async () => {
    // The regression this file exists for. `useDrawerClose()` here is what
    // Tasks, Clients, Categories, Hour banks and Important dates all pass
    // as their success callback: the write is accepted, the drawer closes,
    // the form is gone, and the list behind it has to be told to re-read
    // itself by something that is still alive.
    render(
      <Drawer triggerLabel="add" title="drawer">
        <Form action={ok} closesDrawer />
      </Drawer>
    );
    openDrawer();
    await submit();

    expect(screen.queryByRole("dialog")).toBeNull();

    // A navigation, not a refresh, and the assertion says so rather than
    // counting "something happened". The refresh is the call CI aborted
    // three runs running on writes that had already committed; swapping
    // it back would pass any test that only asked whether the screen was
    // told anything at all.
    expect(refresh).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);

    // Same path, and a parameter that makes it a different URL. Both
    // halves matter: the same URL is not a navigation, and a different
    // path would take the person off the screen they just wrote on.
    const [url, opts] = replace.mock.calls[0];
    expect(url).toMatch(/^\/[^?]*\?/);
    expect(new URL(url, "http://x").searchParams.get("w")).toBeTruthy();
    expect(opts).toEqual({ scroll: false });
  });

  it("asks once and not twice, with both the form and the drawer in play", async () => {
    // Stated separately from the count above because it is a different
    // failure: the hook asking as well as the drawer would pass a
    // "did it refresh" test and still put two requests for the same screen
    // on the wire, which is the shape of the race that started all this.
    render(
      <Drawer triggerLabel="add" title="drawer">
        <Form action={ok} closesDrawer />
      </Drawer>
    );
    openDrawer();
    await submit();
    expect(asks()).toBe(1);
  });

  it("asks once per successful write, not once ever", async () => {
    render(<Form action={ok} />);
    await submit();
    await submit();
    expect(asks()).toBe(2);
  });

  it("does not ask for one when the action reports an error", async () => {
    render(<Form action={async () => ({ error: "nope" })} />);
    await submit();
    expect(asks()).toBe(0);
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
    expect(asks()).toBe(0);
  });
});

describe("dismissing a drawer is not a write", () => {
  it("does not refresh when the drawer is closed without saving", async () => {
    // The X and the backdrop go through a different close than the forms
    // do, and this is the line that keeps them apart. Opening a form,
    // changing nothing and closing it again should cost the screen behind
    // it nothing.
    render(
      <Drawer triggerLabel="add" title="drawer">
        <Form action={ok} closesDrawer />
      </Drawer>
    );
    openDrawer();
    act(() => {
      screen.getAllByRole("button", { name: "סגירה" })[0].click();
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(asks()).toBe(0);
  });
});
