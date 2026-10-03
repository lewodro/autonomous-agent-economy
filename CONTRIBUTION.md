# Contributing

Thanks for helping improve this simple agent economy game. Before contributing, read [`AGENTS.md`](./AGENTS.md) for repository-specific instructions and [`README.md`](./README.md) for the project overview, setup, and usage. Follow any requirements in those files; this guide supplements them.

## Contribution guidelines

- Keep changes focused, minimal, and aligned with the project's goals.
- Follow existing conventions and avoid unnecessary dependencies or unrelated refactoring.
- Preserve clear, predictable game and economy behavior. Explain changes to mechanics, agent behavior, or configuration in the relevant documentation.
- Add or update tests when changing behavior, including important edge cases.
- Do not include secrets, local environment files, or generated artifacts.

## Validation

- Run `npm test` and `npm run check`, plus the setup and validation commands documented in `AGENTS.md` and `README.md` that apply to your change.
- Review the final diff and confirm it contains only intended changes.
- If you cannot run a relevant check, mention that in your pull request.

## Pull requests

Describe the motivation and changes, note any impact on gameplay or the economy, and report the checks you ran. Link related issues and include reproduction steps or screenshots when useful. Keep review discussions respectful and constructive.
