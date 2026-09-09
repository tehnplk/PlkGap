# Windows updates

The installed Windows app checks GitHub Releases 15 seconds after startup and every four hours. Users can also check from the title bar. Stable newer versions download in the background; the title bar then offers restart to update. Cancel keeps the download ready. Development/test runs do not check the network.

Installation requires user confirmation, no active imports, and successful API/database shutdown. Automatic installation on ordinary quit is disabled. The existing `userData/plkgap-pglite` directory is preserved; keep schema changes compatible with existing data.

## Release procedure

1. Ask the user whether to increase the version before making an installer. `package.json` is the version source; an update requires a higher version than the installed app. Update the lockfile with `npm install --package-lock-only`.
2. Run `npm run build`, `npm run test:updater`, and the Electron checks.
3. For a local installer, run `npm run dist:win`. For an authorized release upload, provide `GH_TOKEN` in the build environment and run `npm run release:win`. Never embed this token in the app. The upload creates a draft in `tehnplk/PlkGap`.
4. Keep the generated installer, `.blockmap`, and `latest.yml` together in the release. Publish the draft only when release is approved and validated. Draft/prerelease versions are not delivered to stable clients.
5. Install the older packaged version in a Windows test account, add disposable data, publish a higher test version to a separate test release repository, and verify download, cancel, restart, new version, and retained data before production rollout. Check offline retry too.

Configure Windows code signing through electron-builder's supported certificate/environment configuration (`CSC_LINK`, `CSC_KEY_PASSWORD`) before production distribution. Use the same signing identity for future releases; do not disable signature verification. HTTPS and release metadata hashes are provided by the updater, but do not replace publisher signing.

The initial installation must be made with the NSIS installer. A development checkout or an older app without updater support must be installed manually once. The updater does not deploy source code or publish releases itself.

Reference: https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md
