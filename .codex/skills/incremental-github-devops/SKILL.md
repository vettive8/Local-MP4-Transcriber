---
name: incremental-github-devops
description: Preserve stable baselines and ship repository changes through incremental GitHub branches, TDD checks, CI/CD updates, and draft pull requests. Use when Codex needs to commit current work before risky changes, create or reuse feature branches, keep a legacy stable branch, push incremental checkpoints, prepare GitHub Actions or Cloud Run deployment workflows, or explain the release/devops path.
---

# Incremental GitHub DevOps

## Overview

Use this workflow to keep one stable version protected while moving fast on feature branches. Treat GitHub as the checkpoint ledger: baseline first, tests before fixes, small commits, pushed branches, and draft PRs for review.

## Workflow

1. Inspect the repository before touching files.
- Run `git status --short --branch` and inspect relevant diffs.
- Identify untracked files that are fixtures, secrets, generated reports, or user data. Do not stage them blindly.
- Check the current branch and remote with `git branch --show-current` and `git remote -v`.

2. Preserve a stable baseline before risky work.
- If the user asks for a stable or legacy version, create a branch like `legacy/stable-YYYY-MM-DD` from the known-good commit and push it.
- Commit existing intended work before making new changes when the user requests it.
- Leave unrelated dirty work alone unless it blocks the task.

3. Choose the branch deliberately.
- Use `main` for stable accepted work only.
- Use `codex/<short-task-name>` for new implementation branches.
- Reuse the same feature branch when continuing the same task; create a new branch when the goal or review surface changes.

4. Follow TDD for behavior changes.
- Add or update focused tests that describe the desired behavior.
- Run the smallest relevant test first and confirm it fails for the expected reason when practical.
- Implement the fix, then rerun the targeted test and the broader validation set.

5. Validate before pushing.
- Prefer this matrix for this repo: `npm run lint`, `npm run test:unit`, `npm run build`, and `npm run test:e2e`.
- Run headed Playwright checks when UI behavior changes.
- Record any validation that could not be run and why.

6. Commit incrementally.
- Stage only the files that belong to the change.
- Use clear commit messages that describe the behavior or workflow added.
- Push the current branch after each useful checkpoint if the user asked for incremental GitHub publishing.

7. Prepare GitHub handoff.
- Open a draft PR for feature branches unless the user explicitly asks for direct merge work.
- Include summary, tests run, and deployment notes.
- For Cloud Run, require GitHub secrets or workload identity values. Never hardcode project IDs, service accounts, credentials, or tokens in source.

## Guardrails

- Do not commit `.env*`, local book fixtures, generated browser reports, credentials, or dependency folders.
- Do not rewrite shared history unless the user explicitly requests it.
- Do not merge or deploy production changes without a clear user request.
- Explain the current architecture and branch/release posture when asked; keep it grounded in actual files and workflows.
