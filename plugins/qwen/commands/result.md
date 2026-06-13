---
description: Show the stored final output for a Qwen Code review job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Show a Qwen Code review job result.

Raw slash-command arguments:
`$ARGUMENTS`

Execution:
- Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/qwen-companion.mjs" result "$ARGUMENTS"
```
- Return stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary before or after it.
