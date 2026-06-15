---
description: Run a Qwen Code review against local git state
argument-hint: '[--wait|--background] [--model model] [review arguments]'
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
- Your only job is to run the review companion and return Qwen Code's output verbatim to the user.
- Reviews run in a Claude Code background task by default because they can take a long time.
- Background mode should let Claude Code report completion and surface the final review output automatically.
- Use `--wait` only when the user explicitly wants to block the current turn until the review finishes.
- Use `--background` to make the default Claude Code background mode explicit.
- Use `--model <model>` or `-m <model>` to select the Qwen Code model for this run.

Argument handling:
- Preserve the user's arguments exactly.
- Treat `--wait`, `--background`, `--model <model>`, `--model=<model>`, and `-m <model>` as plugin control arguments; remove them before building the Qwen Code `/review` prompt.
- Do not add extra review instructions or rewrite the user's intent.
- The companion script parses `--wait` and `--background`, but Claude Code's `Bash(..., run_in_background: true)` is what actually detaches the run.
- Examples:
  - `/qwen:review`
  - `/qwen:review --wait`
  - `/qwen:review --model qwen3-coder-plus`
  - `/qwen:review --background 123`
  - `/qwen:review 123`
  - `/qwen:review src/auth.ts`
  - `/qwen:review 123 --comment`

Foreground flow:
- If the raw arguments include `--wait`, run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/qwen-companion.mjs" review "$ARGUMENTS"
```
- Return stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary before or after it.
- Do not fix any issues mentioned in the review output.

Background flow:
- If the raw arguments do not include `--wait`, launch the review with `Bash` in the background:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/qwen-companion.mjs" review "$ARGUMENTS"`,
  description: "Qwen review",
  run_in_background: true
})
```
- Do not call `BashOutput` or wait for completion in this turn.
- After launching the command, tell the user: "Qwen review started in the background. Check `/qwen:status` for progress."
