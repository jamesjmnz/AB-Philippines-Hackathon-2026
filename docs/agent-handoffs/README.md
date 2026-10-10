# Agent handoffs

A handoff is the short report a delegated agent returns to the lead orchestrator when it finishes or stops a task. The lead reviews it, checks the work independently, and only then stages and commits.

Handoffs filed so far: [P2-domain](P2-domain.md), [P3-ui](P3-ui.md), [P7-integration](P7-integration.md). Each describes the code at the time it was written; later commits may have changed it.

## Rules

- One handoff per task. File name: `P<phase>-<agent>-<short-topic>.md`, for example `P2-pulse-domain-engineer-ledger.md`.
- Report what happened, including failures. Do not write "passes" for a command that was not run.
- Paste a short summary of **real** command output: the command, the exit status, counts, and the first relevant error lines. Do not paste secrets, report text or key material.
- Never mark a gate as passed. Gates are decided by the lead on evidence.
- Agents never run `git add`, `git commit`, `git push`, `git merge` or open PRs.
- Stay inside owned paths. If a change is needed elsewhere, describe it under "Integration implications" instead of making it.

## Template

```markdown
# Handoff: <task title>

- Agent: <profile name>
- Phase: P<n>
- Date: <YYYY-MM-DD>
- Outcome: complete | partial | blocked

## Changed files

| Path | Change |
| --- | --- |
| src/... | added / modified / deleted, one line on what and why |

## Commands run

| Command | Exit | Output summary |
| --- | --- | --- |
| npm run typecheck | 0 or non-zero | what it actually printed, briefly |
| npm test -- <pattern> | | suites, tests, failures as printed |

Not run, and why: <list>

## Status claimed

Use only: IMPLEMENTED, UNIT-TESTED, BUILT, VERIFIED ON DEVICE, MOCKED, MISSING, BLOCKED, NOT STARTED, IN PROGRESS.

| Item | Status | Evidence |
| --- | --- | --- |

## Integration implications

- Contract or interface changes other agents must know about.
- Changes needed in shared files (package.json, lockfile, app.config.ts, CLAUDE.md, central schemas) for the lead to make.
- New dependencies requested, with version and reason.
- Docs that need updating.

## Blockers

- What is blocked, the exact error or missing prerequisite, what was tried (up to three distinct attempts), and the human step needed if any.

## Unverified

- Anything written but not exercised, and anything assumed.
```

## Review by the lead

Before committing, the lead reruns the reported commands, reads the diff, checks that no file outside the agent's owned paths changed, and updates [AGENTIC_PROGRESS.md](../AGENTIC_PROGRESS.md) and [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md).
