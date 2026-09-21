#!/usr/bin/env bash
#
# Vercel "Ignored Build Step".
#
# Wired up in Project Settings -> Build & Development -> Ignored Build Step:
#
#   bash scripts/vercel-ignore-build.sh
#
# Exit codes are Vercel's, and they read backwards on purpose:
#
#   exit 0  -> SKIP this build   (nothing here changes what is served)
#   exit 1  -> RUN this build
#
# Why this exists
#
# On 21.9.2026 Vercel warned that the free team had used 75% of its 10 GB
# Function Storage allowance. The cause was not accumulated junk: every
# retained deployment carries its function bundles, this project's bundles
# come to roughly 28 MB each, and the project had produced 316 deployments
# in six weeks - 76 of them in one day, against a Hobby ceiling of 100 per
# day. Storage was the symptom; deployment volume was the disease.
#
# A large share of those builds could not change anything a visitor or a
# reviewer would see. Merging a green test-only pull request into main
# still triggered a full production build, and every push to a qa/* branch
# still built a preview nobody opened - the browser suite runs against
# localhost (qa/playwright.config.ts), never against a preview URL.
#
# So: skip the build when every file the commit touched lives outside the
# deployed application. Anything else builds.
#
# The pattern list below is deliberately an exclusion list, not an
# inclusion list. A path nobody thought about is not on it, so it builds.
# The failure mode of a wrong guess here is a wasted build, never a
# missing deploy.

set -uo pipefail
shopt -s extglob

log() { echo "[ignore-build] $*"; }

# No ref means something unusual about this build. Build it.
if [ -z "${VERCEL_GIT_COMMIT_REF:-}" ]; then
  log "no VERCEL_GIT_COMMIT_REF; building to be safe"
  exit 1
fi

# Vercel clones shallowly. Without a parent commit there is nothing to
# compare against, so there is no basis for skipping.
if ! git rev-parse --verify --quiet "HEAD^" >/dev/null 2>&1; then
  log "no parent commit available; building"
  exit 1
fi

# For a merge commit HEAD^ is the first parent, so this is exactly the set
# of files the merged branch changed.
if ! CHANGED=$(git diff --name-only "HEAD^" HEAD 2>/dev/null); then
  log "could not diff against HEAD^; building"
  exit 1
fi

if [ -z "$CHANGED" ]; then
  log "empty diff; building"
  exit 1
fi

# Patterns are written out literally rather than held in a variable: in a
# `case` statement `|` only separates alternatives when it appears in the
# source. Expanded from a variable it is matched as an ordinary character,
# which silently turns the whole list into one pattern that matches
# nothing. That mistake fails safe (everything builds) and is therefore
# easy to ship without noticing, so it is worth naming here.
#
# In `case`, `*` also matches `/`, so `tests/*` covers `tests/unit/x.ts`.
while IFS= read -r file; do
  [ -z "$file" ] && continue
  case "$file" in
    tests/* | qa/* | docs/* | .github/* | *.md | patch_*.py | .gitignore | .eslintrc.json | vitest.config.ts)
      ;;
    *)
      log "$file affects the deployed app; building"
      exit 1
      ;;
  esac
done <<< "$CHANGED"

log "every changed path is outside the deployed app; skipping this build"
log "changed: $(echo "$CHANGED" | tr '\n' ' ')"
exit 0
