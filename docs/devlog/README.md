# Devlog entry convention

For each meaningful feature PR, add **one** `YYYY-MM-DD-short-title.md` file here. `npm run build` creates `post/devlog.json` from these files, and `/post` renders it. Do not edit a second hardcoded timeline in HTML. Keep entries tied to code that actually shipped on main.

The file starts with simple `key: value` metadata between `---` lines. Required keys: `date` (`YYYY-MM-DD`), `title`, `summary`, `commit` (repository commit URL). Optional: `pr` (pull-request URL). Follow with short Markdown sections, such as `Why`, `Frontend`, `Backend`, `Research`, `Economy`, `Tests`, and `Known issues`; include only applicable sections. The site displays the body as plain text inside an expandable technical note, so do not put secrets or private customer data there.

Example:

```md
---
date: 2026-10-08
title: Explain one shipped change
summary: A short statement of what users can verify.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/abcdef0
pr: https://github.com/lewodro/autonomous-agent-economy/pull/123
---
## Why
The concrete reason for this change.

## Tests
The checks that passed, and any known limits.
```

Run `npm run build` and `npm run docs:check` before committing. `post/devlog.json` is generated and committed so development and production serve the same history; the Docker image regenerates it from the source files during its own build.
