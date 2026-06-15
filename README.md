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

Recommended model style for larger reviews:

```bash
/qwen:review --model qwen3.7-max
/qwen:review --model <deepseek-model-name>
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

Check a long-running review while it is still running:

```bash
/qwen:status
/qwen:status qwen-review-1234abcd
```

Read a finished review again:

```bash
/qwen:result qwen-review-1234abcd
```

Cancel a running review:

```bash
/qwen:cancel qwen-review-1234abcd
```

## Notes

`/qwen:review` is review-only from Claude Code's side. It forwards your review target arguments to Qwen Code's `/review` skill and appends a run-scoped review-only system prompt. In the default background mode Claude Code owns the background command, so it can report completion and surface the final Qwen Code output automatically. Use `/qwen:status` to inspect an active run, `/qwen:cancel` to stop it, and `/qwen:result <job-id>` if you want to read a stored result again. With `--wait`, it prints Qwen Code output unchanged in the current turn.

`--wait`, `--background`, `--model <model>`, `--model=<model>`, and `-m <model>` are handled by this plugin. Other arguments are passed to Qwen Code's `/review` prompt unchanged.

## How Qwen Code review runs

This plugin does not implement its own reviewer. It starts the local Qwen Code
CLI and asks it to run its built-in `/review` skill. Qwen Code decides the
review target from the forwarded arguments:

- no extra arguments: local uncommitted changes
- PR number or PR URL: that pull request's diff and PR context
- file path: that file's diff, or the current file content when there is no diff

Qwen Code review is usually more expensive than a single prompt over `git diff`.
It can collect PR context, load project review rules, run deterministic checks,
inspect changed files, and synthesize verified findings. For large PRs this can
send repeated overlapping repository and review context to the model.

For that reason, prefer strong models with good prompt-cache behavior for larger
reviews. In environments where they are available, `qwen3.7-max` and DeepSeek
family models are good candidates because high cache hit rates can reduce repeat
review latency and cost. The plugin only forwards the model name to Qwen Code;
it does not validate model availability, so use the exact model identifier
configured in your Qwen Code environment.

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
