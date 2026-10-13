# Contributing

Thanks for helping improve this simple agent economy game. Read [`README.md`](./README.md) for the project overview, [`docs/local-development.md`](./docs/local-development.md) for the public local setup, and this guide for contribution checks. Maintainer-only instructions are kept outside the public source release.

## Contribution guidelines

- Keep changes focused, minimal, and aligned with the project's goals.
- Follow existing conventions and avoid unnecessary dependencies or unrelated refactoring.
- Preserve clear, predictable game and economy behavior. Explain changes to mechanics, agent behavior, or configuration in the relevant documentation.
- Add or update tests when changing behavior, including important edge cases.
- Do not include secrets, local environment files, or generated artifacts.

## Validation

- Run `npm test`, `npm run check`, and the setup and validation commands in `README.md` and [`docs/local-development.md`](./docs/local-development.md) that apply to your change.
- Review the final diff and confirm it contains only intended changes.
- If you cannot run a relevant check, mention that in your pull request.

## Pull requests

Describe the motivation and changes, note any impact on gameplay or the economy, and report the checks you ran. Link related issues and include reproduction steps or screenshots when useful. Keep review discussions respectful and constructive.
