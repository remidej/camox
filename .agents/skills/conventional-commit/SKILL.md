---
name: conventional-commit
description: Commit current changes using the conventional commit convention that's mandatory in this repo
---

# Conventional commits

- Format the subject as `type(scope): short imperative summary`. The type is mandatory: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, or `revert`. The `(scope)` is optional.
- Mark a breaking change with `!` before `:` (`feat(api)!: …`) and say what breaks in the body. A change is breaking when a project serving an older published SDK would stop working: the API drops or narrows a procedure, a realtime message, or the Definition Set sync an older SDK uses, or the SDK changes an API that a project's code calls. Release-please reads the `!`. See `docs/adr/0019-the-api-bridges-old-sdks-until-projects-are-upgraded.md`.
- Review `git status`, unstaged diffs, and staged diffs before committing. Stage only intended files or hunks, then verify the full staged diff.
- Use the commit body (description) to provide brief additional context beyond the subject, such as why the change was needed.
- Never cosign commits: no `Co-Authored-By:` trailers, generated-by lines, or any agent/tool attribution.
