# Release Workflow

This repository uses an automated release workflow based on [semantic-release](https://github.com/semantic-release/semantic-release) and conventional commits.

## How It Works

When commits are pushed to the `master` or `main` branch, the release workflow automatically:

1. Analyzes commit messages to determine the next version
2. Generates release notes
3. Updates version in `package.json`, `manifest.json`, and `versions.json`
4. Creates a changelog
5. Builds the plugin (`npm run build`)
6. Creates a GitHub release with build artifacts
7. Commits the version updates back to the repository

## Commit Message Format

Use conventional commit format to trigger releases:

- `feat: add new feature` → **Minor version bump** (e.g., 1.2.0 → 1.3.0)
- `fix: fix a bug` → **Patch version bump** (e.g., 1.2.0 → 1.2.1)
- `feat!: breaking change` or `BREAKING CHANGE:` in footer → **Major version bump** (e.g., 1.2.0 → 2.0.0)

### Examples

```bash
# Minor version bump
git commit -m "feat: add new chat feature"

# Patch version bump
git commit -m "fix: resolve memory leak"

# Major version bump (with !)
git commit -m "feat!: change API interface"

# Major version bump (with BREAKING CHANGE footer)
git commit -m "feat: change API interface

BREAKING CHANGE: The API interface has changed significantly"
```

## Release Artifacts

Each release includes:

- `main.js` - The compiled plugin
- `styles.css` - The plugin styles
- `manifest.json` - The plugin manifest

These files are automatically built and attached to the GitHub release.

## Configuration

- **Workflow**: `.github/workflows/release.yml`
- **Semantic Release Config**: `.releaserc.json`
- **Version Bump Script**: `version-bump.mjs`

## Notes

- Only commits pushed to `master` or `main` trigger releases
- The workflow runs after the CI checks pass
- Version updates are committed back to the repository with `[skip ci]` to avoid infinite loops
- The changelog is automatically updated in `CHANGELOG.md`
