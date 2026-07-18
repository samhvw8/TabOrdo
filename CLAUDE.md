# TabOrdo

Chrome MV3 tab-manager extension. Stack: WXT + Svelte 5 + TypeScript + Tailwind.

## Commands

| Task | Command |
|------|---------|
| Build | `npm run build` |
| Dev | `npm run dev` |
| Test | `npm test` |

## Release Process (IMPORTANT — do not skip tagging)

Every release MUST be tagged, or CI/publish won't line up with versions:

1. Bump `version` in `package.json`
2. Add a dated section to `CHANGELOG.md`
3. Commit the bump
4. Tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`
5. Push commit AND tag: `git push origin main --follow-tags`

CI notes:

- `build.yml` runs on every push to `main`
- `publish.yml` (Chrome Web Store) triggers ONLY on a published GitHub Release — create a release from the tag when ready to ship: `gh release create vX.Y.Z --title "vX.Y.Z" --notes-from-tag` (or paste the CHANGELOG section)
