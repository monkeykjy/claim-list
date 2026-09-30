# Repository Guidelines

## Repository Scope

This is the ClaimList implementation repository. It contains the Next.js, TypeScript, Tailwind CSS, and SQLite implementation and product documentation. The anonymous baseline and generic deployment deliverables have implementation records; the optional-account increment in `docs/account-system.md` is implemented and verified; verification evidence is in `docs/verification.md`. Actual development and verification commands are documented in `README.md`; the staged implementation plan is `docs/development-plan.md`. The planning repository is `/Users/monkey/Myspace/ProductNotes/claim-list`; implement the application here when requested.

## Sources of Truth

Read `docs/account-system.md` (ACC-001, the latest approved increment), `docs/product-requirements.md`, `docs/pages-and-states.md`, `docs/known-limitations.md`, and `docs/development-handoff.md` before implementing features. Distinguish confirmed requirements from suggestions. Update documentation when behavior changes; do not present planned features as implemented.

## Confirmed Product Boundaries

Use Next.js, Tailwind CSS, and SQLite. The first release runs as a single instance on an intranet server, exposes one configurable list, and permits anonymous use alongside optional participant accounts. All passwords require 8–128 characters without composition rules. Register with email, password, password confirmation, and name; use the account name when claiming while logged in. Administrator actions require server-side authorization.

For unbound tasks, completion still permits claimant IP **OR** browser UUID; preserve AUTH-001. Account-bound tasks require the owner account session and must never fall back to IP or UUID. On successful login, bind only unowned tasks claimed by the current UUID, including completed tasks; preserve historical names and timestamps. Never bind by IP or overwrite existing account ownership. Editing a display name must not transfer ownership. Participant accounts and administrator authentication remain separate; `pnpm reset:passwd` only resets the administrator password.

## Structure and Development

Choose dependency versions and implementation tooling during development. Document actual setup, build, lint, type-check, and test commands in `README.md` after adding their configuration. `pnpm reset:passwd` is implemented with hidden terminal input, credential validation, and session invalidation. Preserve its real behavior.

Prefer focused modules, descriptive names, and consistent formatting. Keep browser code separate from server-only authentication and database code. Use the documented Node test runner and Playwright suites; no coverage threshold is mandated.

## Verification and Data

Test duplicate-title rejection, atomic batch insertion, concurrent claims, completion authorization, and administrator session invalidation as these features are implemented. Preserve user input on ordinary refresh and failed requests. A confirmed claim conflict is an exception: show a temporary inline notice beneath that item’s claimant name, discard that item’s name draft, and refresh the list. Keep credentials, SQLite files, and associated runtime files out of Git and static asset directories. Document persistent storage, migrations, and backup restoration before deployment.

## Commits and Reviews

Existing history contains an initial commit without a broader convention. Use focused, imperative commit subjects. Describe changed behavior and validation; include screenshots for UI changes. Preserve the existing license and unrelated work.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
