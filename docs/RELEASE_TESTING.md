# Release Workflow Test Guide

This document provides guidance on testing the automated release workflow.

## Prerequisites

- The workflow is configured in `.github/workflows/release.yml`
- Semantic-release configuration is in `.releaserc.json`
- Current version is tracked in `package.json`

## Testing the Workflow

### Manual Testing Steps

1. **Create a test branch from master:**
   ```bash
   git checkout master
   git pull
   git checkout -b test/release-workflow
   ```

2. **Make a test commit with conventional format:**
   ```bash
   # For a patch release (e.g., 3.1.5 → 3.1.6)
   git commit --allow-empty -m "fix: test release workflow"
   
   # For a minor release (e.g., 3.1.5 → 3.2.0)
   git commit --allow-empty -m "feat: test release workflow"
   
   # For a major release (e.g., 3.1.5 → 4.0.0)
   git commit --allow-empty -m "feat!: test release workflow"
   ```

3. **Push and merge to master:**
   ```bash
   git push origin test/release-workflow
   # Create PR and merge to master
   ```

4. **Monitor the workflow:**
   - Go to Actions tab in GitHub
   - Watch the "Release" workflow run
   - Verify it completes successfully

5. **Verify the release:**
   - Check the Releases page for the new release
   - Verify the version number is correct
   - Confirm artifacts are attached (main.js, styles.css, manifest.json)
   - Check that CHANGELOG.md is updated
   - Verify package.json, manifest.json, and versions.json are updated in master

## Expected Behavior

### For `feat:` commits
- Version bumps from 3.1.5 to 3.2.0
- Creates a minor release
- Adds feature to changelog under "Features" section

### For `fix:` commits
- Version bumps from 3.1.5 to 3.1.6
- Creates a patch release
- Adds fix to changelog under "Bug Fixes" section

### For `feat!:` or `BREAKING CHANGE:` commits
- Version bumps from 3.1.5 to 4.0.0
- Creates a major release
- Adds breaking change to changelog under "BREAKING CHANGES" section

## Workflow Artifacts

After a successful release, these files should be updated:
- `package.json` - Version field
- `package-lock.json` - Version field
- `manifest.json` - Version field
- `versions.json` - New version entry
- `CHANGELOG.md` - Release notes

And these files should be attached to the GitHub release:
- `main.js` - Compiled plugin
- `styles.css` - Plugin styles
- `manifest.json` - Plugin manifest

## Troubleshooting

### Workflow doesn't trigger
- Ensure commit is pushed to `master` or `main` branch
- Check that commit message follows conventional format
- Verify workflow file syntax is correct

### Build fails
- Check Node.js version matches (should be 22.x)
- Verify all dependencies are installed correctly
- Run `npm run build` locally to test

### Version not bumped
- Ensure commit message has correct prefix (feat:, fix:, feat!:)
- Check semantic-release logs in workflow output
- Verify `.releaserc.json` configuration

### Assets not attached
- Verify build produces `main.js`, `styles.css`, `manifest.json`
- Check that files are not in `.gitignore`
- Review workflow logs for asset upload errors

## Reverting a Release

If a release needs to be reverted:

1. **Delete the GitHub release** (optional - keeps tag)
2. **Revert the version commit:**
   ```bash
   git revert <commit-sha>
   git push origin master
   ```
3. **Manually adjust versions if needed:**
   - Update package.json
   - Run `npm run version` to sync manifest.json and versions.json
   - Commit and push

Note: semantic-release tracks released versions, so reverting may require manual intervention.
