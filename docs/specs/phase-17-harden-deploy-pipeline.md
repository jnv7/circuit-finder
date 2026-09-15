# Spec — Phase 17: Harden the deploy pipeline (correct Pages source, never publish unbuilt content silently again)

Status: `todo`
Depends on: [phase-16-fix-flaky-real-data-tests.md](phase-16-fix-flaky-real-data-tests.md)
See: [../ROADMAP.md](../ROADMAP.md), [../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Investigating why the published site didn't reflect Phase 13-15 found two
separate, compounding problems, both confirmed directly against the live
site and the GitHub Actions API (2026-09-14/15):

1. **The `CI + Pages` workflow's one run for the Phase 15 push failed at
   `npm run test:run`** (Phase 16's problem) and correctly skipped
   `npm run build` and the deploy step as a result — the workflow did exactly
   what it should when tests fail.
2. **Despite that, the live site changed anyway, ~10 minutes later** — fetched
   directly: `https://www.jnvasconcelos.com/circuit-finder/`'s `index.html`
   is **byte-identical to the repo's *source* `index.html`**, referencing
   `<script src="/src/main.ts">` — a raw, unbundled TypeScript file, served
   by GitHub with `content-type: video/mp2t` (a browser cannot execute this
   as a module). `/circuit-finder/assets/` — where Vite's real build output
   would live — returns `404`. **The live site is not "missing recent
   changes", it is not running a built application at all**, for any phase,
   since the last time the proper workflow's deploy step actually
   succeeded (Phase 12, 2026-09-12).

The second point is the one this phase exists to fix: something outside the
`CI + Pages` workflow is publishing the raw branch content to Pages
regardless of whether the real build ever ran or passed. The most likely
explanation, consistent with every fact gathered (`GET
/repos/.../pages` returning `404` rather than the expected Actions-source
config; a separate, unconditionally-successful `pages build and deployment`
system run appearing for the same commit the real workflow failed on) is that
the repository's **Pages source setting has reverted to (or was never
confirmed as) "Deploy from a branch"**, GitHub's legacy mode that publishes
whatever sits in a branch directly, bypassing the custom Actions workflow
entirely. That is a **one-time manual setting to correct**, not something a
code change can fix by itself — but this phase also adds a permanent,
automated check so a repeat of this (whether the same cause or a different
one) is caught the moment it happens, not discovered by chance weeks later.

## How it stays true to the project's conventions

- **CONVENTIONS.md: "Deployable to GitHub Pages with no backend."** A site
  that silently serves raw source instead of the deployed app defeats that
  guarantee in the worst way — not down, but *wrong*, which is harder to
  notice than an outage.
- **"Every change ships with automated tests."** Extended here to the
  deploy pipeline itself: a post-deploy smoke check is a test, just of the
  live artifact instead of a pure function — the same principle, applied one
  layer further out.
- **Minimal dependencies, no paid services.** The fix is a repo setting plus
  a few lines of workflow YAML and a `curl`/`node` check — no new service,
  no new tool.

## Decisions locked for this phase

- **Step 1 (manual, one-time, not code): correct the Pages source setting.**
  In the repository's **Settings → Pages**, the **Source** must be
  **"GitHub Actions"**, not "Deploy from a branch". This is the actual root
  fix for "the live site serves raw source" — no code change makes GitHub
  stop doing this on its own, since it happens entirely outside the
  `CI + Pages` workflow. Record the correction (who/when, screenshot or just
  a decision-log line) in the ROADMAP so the reason this matters is not lost
  the next time someone touches repo settings.
- **Step 2 (code): a post-deploy smoke check, in the same workflow, right
  after the real deploy step.** After `actions/deploy-pages@v4` succeeds,
  fetch the deployment's own reported URL (`steps.deployment.outputs
  .page_url`, already captured by the existing `id: deployment` step) and
  assert the response:
  - does **not** contain the literal string `/src/main.ts` (the unmistakable
    signature of raw, unbuilt source being served);
  - **does** contain a reference matching a built asset path
    (`/assets/*.js`, Vite's actual output pattern for this project).
  Fail the job loudly if either check fails — this turns "the site is
  silently wrong" into "the workflow run is red", which is exactly the
  failure mode CI is supposed to convert visible problems into.
- **The smoke check runs *after* every successful deploy, unconditionally**
  — not just as a one-off verification of this specific incident, so a
  *future* Pages misconfiguration (settings drift, a GitHub product change,
  anything) is caught on the very next push, automatically.
- **No change to the `build` job or its steps** (`npm run test:run`,
  `npm run build`, `actions/configure-pages`, `actions/upload-pages-artifact`
  are all correct and unaffected) — this phase only adds one new step to the
  end of the existing `deploy` job.
- **The check is a plain shell step in the workflow YAML, not a new script
  file** — a few lines of `curl` + `grep`, matching the size and style of
  the workflow's existing steps; no new `package.json` dependency, no new
  `src/` file, since this has nothing to do with the application's own code
  or test suite.

## Repository layout after this phase

```text
.github/
└── workflows/
    └── deploy.yml   # + a "Verify deployed site" step at the end of the deploy job
docs/
└── ROADMAP.md        # decision-log entry recording the Pages source correction
```

No change to `src/`, `package.json`, or any application file.

## New / changed code

### `.github/workflows/deploy.yml`

```yaml
  deploy:
    needs: build
    if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
      - name: Verify the deployed site is the built app, not raw source
        run: |
          set -euo pipefail
          URL="${{ steps.deployment.outputs.page_url }}"
          BODY="$(curl -sL "$URL")"
          if echo "$BODY" | grep -q '/src/main.ts'; then
            echo "::error::Deployed page references /src/main.ts — this is raw, unbuilt source, not the Vite build output. Check the repository's Settings > Pages > Source is set to 'GitHub Actions', not 'Deploy from a branch'."
            exit 1
          fi
          if ! echo "$BODY" | grep -qE '/circuit-finder/assets/[^"]+\.js'; then
            echo "::error::Deployed page does not reference a built asset under /circuit-finder/assets/*.js — the live site may not be serving a real build."
            exit 1
          fi
          echo "Deployed site verified: serving a real build, not raw source."
```

(Sketch — exact `grep` pattern may need adjusting to the real asset path
Vite emits; verify against a real successful deploy's HTML before finalising
the pattern, the same way every constant elsewhere in this codebase was
checked against real data before shipping.)

## Constants

None — this phase adds a workflow step, not a tunable value.

## Tests

- This phase's own correctness is verified by the workflow itself, not
  `vitest`:
  - After Step 1 (Pages source corrected) and Step 2 (smoke check added),
    trigger a deploy (any push to `main`, or `workflow_dispatch`) and confirm
    the `deploy` job's new step passes, with the live site's HTML actually
    inspected in the job log.
  - **Regression check, deliberately run once**: temporarily point the smoke
    check's `URL` at a known-bad target (e.g. hardcode the raw
    `index.html`'s content inline, or briefly revert Step 1 if safe to do so
    in a scratch environment) to confirm the check actually fails loudly
    instead of silently passing — the same "prove the guard rail catches the
    thing it's meant to catch" discipline `graph.test.ts`'s Phase 9 crossing-
    detection tests already apply to application code, applied here to a
    workflow check instead.
- No `src/**/*.test.ts` changes — nothing about the application's own
  behaviour changes in this phase.

## Acceptance criteria

- Repository Settings → Pages → Source reads "GitHub Actions".
- The next successful push to `main` results in a `CI + Pages` run whose
  `deploy` job includes a passing "Verify the deployed site" step, and the
  live site (`https://www.jnvasconcelos.com/circuit-finder/`, or whatever
  `page_url` resolves to) actually loads the running application in a real
  browser — checked directly, not inferred from the workflow's green
  checkmark alone.
- `docs/ROADMAP.md` updated: Phase 17 → `done`, a dated decision-log entry
  recording (a) the Pages source correction and (b) confirmation the smoke
  check both passes on a good deploy and was verified to fail on a bad one.

## Not in scope

- **Diagnosing *why* the Pages source setting was wrong** (whether it was
  ever correctly "GitHub Actions" and reverted, or never confirmed since the
  very first Pages setup) — the API call needed to inspect that history
  requires repository-admin authentication this investigation didn't have;
  Step 1 corrects the setting regardless of how it got that way.
- **A broader deployment/release process** (staging environment, manual
  approval gates, rollback tooling) — this is a single-maintainer static
  site per VISION.md's own "static and free" principle; one automated
  post-deploy check is proportionate, a release pipeline is not.
- **Monitoring or alerting beyond the workflow's own pass/fail status** (e.g.
  a scheduled periodic check independent of pushes, a notification
  integration) — the smoke check catches the failure mode this phase was
  written for (a broken deploy on push); catching drift *between* pushes is
  a different, separately-justified feature if it ever turns out to matter.
