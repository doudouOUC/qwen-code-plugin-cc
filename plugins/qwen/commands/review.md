---
description: Run a Qwen Code review against local git state
argument-hint: '[review arguments]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(qwen:*)
disallowed-tools: Write, Edit, MultiEdit, NotebookEdit
---

Run a Qwen Code review through the Qwen Code `/review` skill.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraints:
- This command is review-only.
- Do not fix issues, apply patches, stage files, commit, push, or suggest that you are about to make changes.
- Your only job is to run the review and return Qwen Code's output verbatim to the user.

Argument handling:
- Preserve the user's arguments exactly.
- Do not add extra review instructions or rewrite the user's intent.
- Examples:
  - `/qwen:review`
  - `/qwen:review 123`
  - `/qwen:review src/auth.ts`
  - `/qwen:review 123 --comment`

Execution:
- Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/qwen-companion.mjs" review "$ARGUMENTS"
```
- Return stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary before or after it.
- Do not fix any issues mentioned in the review output.
