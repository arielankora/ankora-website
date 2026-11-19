"use client";
import Link from "next/link";
import type { ComponentProps } from "react";
import { TASKS_MINE_COOKIE, type MineScope } from "./mine-scope";

// One of the four "mine" choices on the tasks screen. A client component
// only so that the choice is remembered when it is clicked, and only
// then: a link that arrives with `mine=` in it does not change what this
// person picked. See resolveMineScope in mine-scope.ts.

function remember(scope: MineScope) {
  document.cookie = `${TASKS_MINE_COOKIE}=${scope}; path=/; max-age=31536000; samesite=lax`;
}

export function MineScopeLink({ scope, ...props }: { scope: MineScope } & ComponentProps<typeof Link>) {
  return <Link {...props} onClick={() => remember(scope)} />;
}
