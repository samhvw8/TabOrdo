---
type: Playbook
title: Releasing TabOrdo
description: Steps to cut a TabOrdo release (version bump, dated CHANGELOG section, annotated tag, push, GitHub Release that triggers the Chrome Web Store publish), what each CI workflow does, the commit conventions, and what to do when the store publish fails.
resource: https://github.com/samhvw8/TabOrdo/blob/main/.github/workflows/publish.yml
tags: [release, ci, chrome-web-store, versioning, git]
generated: { by: claude-code/claude-opus-5, at: 2026-09-22T23:00:00Z }
sources:
  - id: claude-md
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CLAUDE.md
    title: CLAUDE.md "Release Process"
    last_modified: 2026-07-18
  - id: publish-yml
    resource: https://github.com/samhvw8/TabOrdo/blob/main/.github/workflows/publish.yml
    title: .github/workflows/publish.yml
    last_modified: 2026-07-27
  - id: build-yml
    resource: https://github.com/samhvw8/TabOrdo/blob/main/.github/workflows/build.yml
    title: .github/workflows/build.yml
    last_modified: 2026-08-04
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG.md
    last_modified: 2026-09-17
  - id: mise-toml
    resource: https://github.com/samhvw8/TabOrdo/blob/main/mise.toml
    title: mise.toml (Node version)
    last_modified: 2026-09-22
  - id: commit-bump-072
    resource: https://github.com/samhvw8/TabOrdo/commit/c51f9f8c02065f90bf674bad36ab7e87d9c68b81
    title: "docs: changelog and version bump for 0.7.2"
    last_modified: 2026-08-23
  - id: commit-fix-071
    resource: https://github.com/samhvw8/TabOrdo/commit/013f617c809952ee0dd87a7aa602c4555b51533e
    title: "fix: keep exactly one copy when deduplicating pinned tabs"
    last_modified: 2026-08-22
  - id: commit-docs-060
    resource: https://github.com/samhvw8/TabOrdo/commit/dc267f28e9403cf6ec8725b3d48082a81eb8c640
    title: "docs: changelog and README for 0.6.0"
    last_modified: 2026-08-04
  - id: commit-artifact
    resource: https://github.com/samhvw8/TabOrdo/commit/1c7216c1ed30522551a28ac40ff0051596793355
    title: "ci: upload the build artifact that has never been uploaded"
    last_modified: 2026-08-04
  - id: git-history
    resource: https://github.com/samhvw8/TabOrdo/commits/main
    title: git log and git tag on main at 9740b5d
    last_modified: 2026-09-17
  - id: releases
    resource: https://github.com/samhvw8/TabOrdo/releases
    title: GitHub Releases (gh release list)
    last_modified: 2026-08-23
  - id: publish-run-072
    resource: https://github.com/samhvw8/TabOrdo/actions/runs/32646251724
    title: Publish to Chrome Web Store run for v0.7.2 (failed; v0.7.0 and v0.7.1 runs fail the same way)
    last_modified: 2026-08-23
  - id: publish-run-073
    resource: https://github.com/samhvw8/TabOrdo/actions/runs/35174579836
    title: Publish to Chrome Web Store run for v0.7.3 (failed, 400 on the submit call)
    last_modified: 2026-09-17
  - id: publish-run-080
    resource: https://github.com/samhvw8/TabOrdo/actions/runs/35740300825
    title: Publish to Chrome Web Store run for v0.8.0 (uploaded and submitted for review)
    last_modified: 2026-09-22
---

# Overview

A release is a version bump on `main`, an annotated tag, and a **published** GitHub Release. Publishing the Release is what triggers the Chrome Web Store submission. Every release must be tagged, or CI and publishing drift away from the version numbers.[^claude-md]

# Steps

1. Check that `main` is green locally: `npm run check` and `npm test`. Verify: both exit 0 (publish runs them again, see below).[^publish-yml]
2. Bump `version` in `package.json`. Verify: `package-lock.json` changes with it; the recent bump commits touch all three release files.[^claude-md][^commit-bump-072]
3. Turn `## Unreleased` into `## X.Y.Z — YYYY-MM-DD` in `CHANGELOG.md`. Verify: the heading matches the dated sections below it.[^claude-md][^changelog]
4. Commit only those files as `docs: changelog and version bump for X.Y.Z`.[^commit-bump-072]
5. `git tag -a vX.Y.Z -m "vX.Y.Z"`. Verify: `git cat-file -t vX.Y.Z` prints `tag`.[^claude-md]
6. `git push origin main --follow-tags`. Verify: the Build & Package run for the bump commit succeeds.[^claude-md][^build-yml]
7. When ready to ship: `gh release create vX.Y.Z --title "vX.Y.Z" --notes-from-tag` (or paste the CHANGELOG section). Verify: the "Publish to Chrome Web Store" run for the tag succeeds.[^claude-md][^publish-yml]

# What CI does

| Workflow | Trigger | Steps |
|----------|---------|-------|
| `build.yml` "Build & Package" | push to `main`, PR to `main` | Node from `mise.toml` via `jdx/mise-action`,[^mise-toml] `npm ci`, `npm run check`, `npm test`, `npm run zip`; on `main` only, upload `.output/*.zip` as artifact `tab-ordo-chrome` (30 days)[^build-yml] |
| `publish.yml` "Publish to Chrome Web Store" | `release: published`, `workflow_dispatch` | Node from `mise.toml`, `npm ci`, check, test, zip, then `npx wxt submit --chrome-zip .output/*-chrome.zip` with the `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN` secrets[^publish-yml] |

- Publish repeats check and test because nothing makes a release wait for `build.yml`. Without them, publishing could ship a build that `build.yml` is about to fail.[^publish-yml]
- The upload step needs `include-hidden-files: true`. `.output` is a dot-directory, and without the flag every build on `main` uploaded nothing and only warned.[^build-yml][^commit-artifact]

# Commit conventions

| Commit | Carries |
|--------|---------|
| `fix:` / `feat:` / `perf:` | Code **and** its tests; sometimes the CHANGELOG entry too (`013f617` edited `CHANGELOG.md`, `lib/tabs/dedup.ts` and its test)[^commit-fix-071] |
| `docs: changelog and version bump for X.Y.Z` | `CHANGELOG.md`, `package.json`, `package-lock.json` only; the tag points here (`v0.7.2` → `c51f9f8`)[^commit-bump-072][^git-history] |
| `docs: changelog entry for …` | CHANGELOG-only follow-ups between releases[^git-history] |

Conventional-commit subjects start in July 2026. Earlier history uses free-form subjects such as "Bump version to 0.5.0, update docs…".[^git-history]

# When the store publish fails

- **A green upload is not a release.** v0.7.0, v0.7.1 and v0.7.2 uploaded their ZIP, then the publish call returned 400 "Publish condition not met: … you must provide mandatory privacy information in the new Developer Dashboard", so none reached users.[^publish-run-072] v0.7.3 failed at the same call with another 400.[^publish-run-073] Fix the listing as [the store listing page](/processes/chrome-web-store-listing.md) describes, then rerun the failed run with `gh run rerun <run-id>`; it rebuilds from the same tag.
- **v0.8.0 went through** (2026-09-22): the run's submit step logged "Uploading new ZIP file", then "Submitting for review" and passed. It still has to clear store review before users get it.[^publish-run-080]
- Check the "Publish to Chrome Web Store" run after every release; nothing else reports a failed submission.[^publish-yml]
- **The `v0.6.0` GitHub Release is still a draft**, so it never published.[^releases] 0.6.0 had been dated and documented without being tagged.[^commit-docs-060]

# Gotchas

- A draft Release does not fire `release: published`; only publishing it does.[^publish-yml][^releases]
- Two setup items are still open: move the GCP OAuth app from testing to production so the refresh token stops expiring, and try a `workflow_dispatch` run with `--dry-run`.
- The oldest CHANGELOG section reads `0.1.0 — 2025-05-20`, although the repository's first commit is from 2026-05-20.[^changelog][^git-history]

# Related

[TabOrdo](/tabordo.md) · [No host permissions](/decisions/no-host-permissions.md) · [Chrome stub](/testing/chrome-stub.md)

[^claude-md]: CLAUDE.md
[^publish-yml]: .github/workflows/publish.yml
[^build-yml]: .github/workflows/build.yml
[^changelog]: CHANGELOG.md
[^mise-toml]: mise.toml
[^commit-bump-072]: commit c51f9f8
[^commit-fix-071]: commit 013f617
[^commit-docs-060]: commit dc267f2
[^commit-artifact]: commit 1c7216c
[^git-history]: git log / git tag
[^publish-run-073]: GitHub Actions run 35174579836
[^publish-run-080]: GitHub Actions run 35740300825
[^releases]: gh release list
[^publish-run-072]: GitHub Actions run 32646251724
