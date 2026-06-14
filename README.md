# Qwen Code Plugin for Claude Code

Use Qwen Code review from inside Claude Code.

This plugin adds:

- `/qwen:setup` to check whether the local `qwen` CLI is available.
- `/qwen:review` to run Qwen Code's built-in `/review` skill against the current repository.
- `/qwen:status`, `/qwen:result`, and `/qwen:cancel` to manage long-running review jobs.

## Requirements

- Claude Code with plugin support.
- Node.js 18.18 or later.
- Qwen Code installed and available on `PATH`.

Install Qwen Code if needed:

```bash
npm install -g @qwen-code/qwen-code
```

## Install

Add this repository as a Claude Code plugin marketplace:

```bash
/plugin marketplace add doudouOUC/qwen-code-plugin-cc
```

Install the plugin:

```bash
/plugin install qwen@qwen-code
```

Reload plugins:

```bash
/reload-plugins
```

Check setup:

```bash
/qwen:setup
```

## Usage

Review local changes:

```bash
/qwen:review
```

`/qwen:review` starts in the background by default and prints a job id.

Wait for a small review in the foreground:

```bash
/qwen:review --wait
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

Check a long-running review:

```bash
/qwen:status
/qwen:status qwen-review-1234abcd
```

Read a finished review:

```bash
/qwen:result qwen-review-1234abcd
```

Cancel a running review:

```bash
/qwen:cancel qwen-review-1234abcd
```

## Notes

`/qwen:review` is review-only from Claude Code's side. It forwards your arguments to Qwen Code's `/review` skill and appends a run-scoped review-only system prompt. In the default background mode it prints a job id and follow-up commands; use `/qwen:result <job-id>` to read the final review. With `--wait`, it prints Qwen Code output unchanged.

The companion runs Qwen Code with `--approval-mode yolo` so headless review can execute the analysis commands required by `/review`. Sandboxing is enabled by default. If your environment cannot run Qwen Code sandboxing, explicitly disable it with:

```bash
export QWEN_PLUGIN_NO_SANDBOX=1
```

Background job state is stored outside the project under:

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
