#!/usr/bin/env bash
# Publishes the files of a folder as <subfolder>/ on the ci-logs-ios branch, so they can be read with a plain
# `git fetch` (no GitHub sign-in). Several jobs publish to the same branch, each to its own subfolder, so a job
# keeps everything the others put there:
#   - fetch the branch, copy its tree, replace only <subfolder>, make ONE new root commit;
#   - push it with --force-with-lease against the commit the tree came from; when another job pushed in the
#     meantime the push is refused and the whole thing is repeated on top of the new state.
# Usage: publish-logs.sh <subfolder> <folder>        (needs GH_TOKEN and GITHUB_REPOSITORY)
set -u
SUB="$1"
SRC="$2"
BRANCH="ci-logs-ios"
URL="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

for attempt in 1 2 3 4 5 6 7 8; do
  work="$(mktemp -d)"
  mkdir "$work/new"
  old_sha=""
  if git ls-remote --exit-code --heads "$URL" "$BRANCH" >/dev/null 2>&1; then
    git clone -q --depth 1 --branch "$BRANCH" "$URL" "$work/old" || { sleep 5; continue; }
    old_sha="$(git -C "$work/old" rev-parse HEAD)"
    (cd "$work/old" && tar --exclude=.git -cf - .) | (cd "$work/new" && tar xf -)
  fi
  rm -rf "$work/new/$SUB"
  mkdir -p "$work/new/$SUB"
  cp -R "$SRC"/. "$work/new/$SUB"/
  cd "$work/new" || exit 1
  git init -q
  git add -A
  git -c user.name="ci" -c user.email="ci@users.noreply.github.com" commit -qm "iOS CI logs: $SUB, commit $GITHUB_SHA"
  if [ -n "$old_sha" ]; then
    git push -q --force-with-lease="refs/heads/$BRANCH:$old_sha" "$URL" "HEAD:refs/heads/$BRANCH" && exit 0
  else
    git push -q "$URL" "HEAD:refs/heads/$BRANCH" && exit 0
  fi
  echo "publish attempt $attempt did not go through, trying again"
  sleep $((attempt * 3))
done
echo "could not publish the logs"
exit 1
