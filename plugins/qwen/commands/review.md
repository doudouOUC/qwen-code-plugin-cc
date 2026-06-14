---
description: Run a Qwen Code review against local git state
argument-hint: '[--wait|--background] [review arguments]'
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
- Your only job is to run the review companion and return its stdout verbatim to the user.
- Reviews run in the background by default because they can take a long time.
- Background mode returns a job id and follow-up commands, not the final review body.
- Use `--wait` only when the user explicitly wants to block until the review finishes.
- Use `--background` to make the default background mode explicit.

Argument handling:
- Preserve the user's arguments exactly.
- Do not add extra review instructions or rewrite the user's intent.
- Examples:
  - `/qwen:review`
  - `/qwen:review --wait`
  - `/qwen:review --background 123`
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
