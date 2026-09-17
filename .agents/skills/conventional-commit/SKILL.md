---
name: conventional-commit
description: Commit current changes using the conventional commit convention that's mandatory in this repo
---

# Conventional commits

- Format the subject as `type(scope): short imperative summary`. The type is mandatory: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, or `revert`. The `(scope)` is optional. Ignore breaking changes, no need for `!` before `:`
- Review `git status`, unstaged diffs, and staged diffs before committing. Stage only intended files or hunks, then verify the full staged diff.
- Use the commit body (description) to provide brief additional context beyond the subject, such as why the change was needed.
- Never cosign commits: no `Co-Authored-By:` trailers, generated-by lines, or any agent/tool attribution.
