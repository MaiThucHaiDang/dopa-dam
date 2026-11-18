#!/usr/bin/env bash
# Last step of every job of linux-ci.yml: writes run-summary.txt and errors.txt next to the job's logs and publishes
# the folder on the ci-logs-linux branch. Never fails the job.
# Usage: finish-job.sh <subfolder> <job status> [extra summary line...]     (logs are in $RUNNER_TEMP/logs)
set +e
SUB="$1"
STATUS="$2"
shift 2
out="${RUNNER_TEMP}/logs"
mkdir -p "$out"
grep -hE "error(\[E[0-9]+\])?:|warning:|FAILED|panicked|^ *FAIL |  FAIL  |✗|AssertionError|Error:" "$out"/*.log 2>/dev/null | sort -u | head -300 > "$out/errors.txt"
{
  echo "commit: $GITHUB_SHA"
  echo "run: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
  echo "job: $SUB"
  echo "job status: $STATUS"
  for line in "$@"; do echo "$line"; done
} > "$out/run-summary.txt"
cat "$out/run-summary.txt"
bash "$(dirname "$0")/publish-logs.sh" "$SUB" "$out"
exit 0
