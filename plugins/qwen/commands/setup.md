---
description: Check whether Qwen Code is ready
argument-hint: ''
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(qwen:*), Bash(npm:*)
---

Check whether Qwen Code is installed and ready for this plugin.

Raw slash-command arguments:
`$ARGUMENTS`

Execution:
- Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/qwen-companion.mjs" setup "$ARGUMENTS"
```
- Return stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary before or after it.
