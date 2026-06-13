---
description: Show active and recent Qwen Code review jobs for this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Show Qwen Code review job status.

Raw slash-command arguments:
`$ARGUMENTS`

Execution:
- Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/qwen-companion.mjs" status "$ARGUMENTS"
```
- Return stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary before or after it.
