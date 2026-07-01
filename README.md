# Qwen Code Review Plugin

Use Qwen Code review from Claude Code and Codex CLI.

This repository contains two plugins for the same Qwen Code review capability:

- **Claude Code plugin** (`plugins/qwen/`) — adds `/qwen:review` and job management commands.
- **Codex CLI plugin** (`plugins/qwen-codex/`) — adds the `$qwen-review` skill.

Both plugins call the local `qwen` CLI to run Qwen Code's built-in `/review` skill.

## Requirements

- Node.js 18.18 or later.
- Qwen Code installed and available on `PATH`.

Install Qwen Code if needed:

```bash
npm install -g @qwen-code/qwen-code
```

## Install — Claude Code

```bash
/plugin marketplace add doudouOUC/qwen-code-plugin-cc
/plugin install qwen@qwen-code
/reload-plugins
/qwen:setup
```

## Install — Codex CLI

```bash
codex plugin marketplace add doudouOUC/qwen-code-plugin-cc
codex plugin add qwen@qwen-code
```

## Claude Code Usage

Review local changes:

```bash
/qwen:review
```

`/qwen:review` starts in a Claude Code background task by default. Claude Code
will report when the background command finishes and surface the final Qwen Code
review output.

Wait for a small review in the foreground:

```bash
/qwen:review --wait
```

Run with a specific Qwen Code model:

```bash
/qwen:review --model qwen3-coder-plus
/qwen:review -m qwen3-coder-plus 123 --comment
```

Review a pull request:

```bash
/qwen:review 123
```

Review a specific file:

```bash
/qwen:review src/auth.ts
```

Post Qwen Code inline comments on a PR:

```bash
/qwen:review 123 --comment
```

Manage jobs:

```bash
/qwen:status
/qwen:status qwen-review-1234abcd
/qwen:result qwen-review-1234abcd
/qwen:cancel qwen-review-1234abcd
```

## Codex CLI / App Usage

Once installed, the `$qwen-review` skill is available in Codex CLI and Codex App. Ask Codex to review your code:

```
Use $qwen-review to review the current changes
```

Codex will run the `qwen` CLI with review-only flags and present the findings.

## Notes

`/qwen:review` (Claude Code) and `$qwen-review` (Codex) are both review-only. They forward your review target arguments to Qwen Code's `/review` skill and append a review-only system prompt.

`--wait`, `--background`, `--model <model>`, `--model=<model>`, and `-m <model>` are handled by the Claude Code plugin. Other arguments are passed to Qwen Code's `/review` prompt unchanged.

The Claude Code companion runs Qwen Code with `--approval-mode yolo` so headless review can execute the analysis commands required by `/review`. Sandboxing is enabled by default. If your environment cannot run Qwen Code sandboxing, explicitly disable it with:

```bash
export QWEN_PLUGIN_NO_SANDBOX=1
```

Claude Code background job state is stored under:

```text
~/.qwen-code-plugin-cc/workspaces/
```

## Development

Run tests:

```bash
npm test
```

## License

Apache-2.0
