---
name: qwen-review
description: Run Qwen Code review on local changes, pull requests, or specific files using the Qwen Code CLI.
---

# Qwen Code Review

Run Qwen Code reviews through the companion script bundled with this plugin.

## CRITICAL: Use ONLY the companion script

**Do NOT run `qwen` CLI commands directly.** Do not use `qwen review`, `qwen review fetch-pr`, or any other qwen subcommands. The companion script handles all qwen invocation, argument construction, system prompts, and output parsing automatically.

## Finding the companion script

The companion script is at `scripts/qwen-companion.mjs` relative to this plugin's install root. Find it with:

```bash
QWEN_COMPANION=$(find ~/.codex/plugins/cache -path '*/qwen/*/scripts/qwen-companion.mjs' 2>/dev/null | head -1)
```

If not found, tell the user to reinstall the plugin.

## Prerequisites

The `qwen` CLI must be installed. The companion script checks this automatically. If missing, it will tell you to run:

```bash
npm install -g @qwen-code/qwen-code
```

## Running a review

Reviews can take several minutes. **Always run in the background** to avoid blocking or context truncation.

### Step 1: Start the review

```bash
QWEN_COMPANION=$(find ~/.codex/plugins/cache -path '*/qwen/*/scripts/qwen-companion.mjs' 2>/dev/null | head -1)
QWEN_REVIEW_OUT=$(mktemp /tmp/qwen-review-XXXXXX.txt)
node "$QWEN_COMPANION" review "--wait $REVIEW_ARGS" > "$QWEN_REVIEW_OUT" 2>&1 &
QWEN_PID=$!
echo "Qwen review started (PID $QWEN_PID), output: $QWEN_REVIEW_OUT"
```

Replace `$REVIEW_ARGS` with the user's review target:

- **Local changes:** (empty — just `--wait`)
- **PR number:** `--wait 6138`
- **PR with inline comments:** `--wait 6138 --comment`
- **Specific file:** `--wait src/auth.ts`
- **With model selection:** `--wait --model qwen3-coder-plus 6138`

### Step 2: Wait and report

Tell the user the review is running and may take a few minutes.

```bash
wait $QWEN_PID 2>/dev/null
echo "exit: $?"
```

### Step 3: Read and present results

```bash
cat "$QWEN_REVIEW_OUT"
```

Present the review findings to the user. Do not attempt to fix any issues unless the user explicitly asks.

## Checking setup

```bash
node "$QWEN_COMPANION" setup
```

## Constraints

- **Review only.** Never fix, patch, stage, commit, or push based on review findings.
- **Never run qwen directly.** Always use the companion script.
