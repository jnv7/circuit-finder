# Conventions

Engineering rules for this project. See [docs/VISION.md](docs/VISION.md) for the
product goal and [docs/ROADMAP.md](docs/ROADMAP.md) for phases and priorities.

## Language

- All code, identifiers, comments, commit messages, and documentation are in
  **English**.
- Conversations about the project may happen in any language, but nothing that
  lands in the repository is an exception to the rule above.

## Testing

- Every change ships with automated tests.
- Tests are **fast and offline by default**. Anything that needs the network
  (tile servers, Overpass, external datasets) is isolated behind fixtures/mocks,
  or tagged so it does not run in the default suite.
- The default test suite must pass before any work is considered done.
- Test runner: **Vitest**.

## Functional first

- Each roadmap phase delivers something that runs end to end, even if the quality
  is rough.
- Prefer shipping a thin working slice over a broad unfinished one.

## Stack constraints

- Static site only: **TypeScript + Vite**, built to static files.
- Deployable to **GitHub Pages** with no backend, no database, no paid services.
- Persistence is `localStorage` plus JSON file export/import.
- Keep dependencies minimal and free of API keys or subscriptions.

## Commits

- Imperative mood, English, concise subject line.
- One logical change per commit.
