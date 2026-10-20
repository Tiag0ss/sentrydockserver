# What’s New changelog

Static release notes shipped with the app (`changelog.json`). Served by `GET /api/whats-new`.

## Source of truth: `package.json` version bumps in git

Woodpecker builds from `V*` tags **after** you bump `package.json`. The changelog follows **package.json introductions in git**, not fabricated feature lists.

Release sequence:

1. Bump `version` in `package.json` to the version you are about to ship
2. Refresh this changelog (`pnpm whats-new:generate`), then curate titles/bullets
3. Commit `package.json` + `docs/whats-new/changelog.json` together
4. Create the `V*` tag so Woodpecker builds

## Commands

```bash
pnpm whats-new:generate
# optional: keep hand-curated bullets for older versions
pnpm whats-new:generate -- --keep-curated
```

- Does **not** overwrite the hand-authored `0.1.0` entry
- By default **rebuilds every version after 0.1.0** from git commit subjects between version introductions
- For the **current** `package.json` version, lists subjects from the previous introduction through `HEAD`
- After generate, curate titles/bullets in `changelog.json` as needed
