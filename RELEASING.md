# Releasing a Windows build

Windows installers are built on GitHub Actions (`windows-latest`), not on an office PC. The workflow is `.github/workflows/release.yml`.

## What it produces

For version `5.3.0-beta.22` the artifacts are:

- `Universal.Warrant.Return.Parser.Setup.5.3.0-beta.22.exe` (NSIS installer)
- `Universal.Warrant.Return.Parser.5.3.0-beta.22.exe` (portable exe)

A tag that contains `-beta` is published as a GitHub pre-release. Release notes start from `release/notes-<version>.md` (Highlights, Fixes, Still included, and Caution). The workflow fails if that file is missing. It inserts a Packages table with each file's size in bytes and its SHA-256, plus the `Get-FileHash` commands.

## Cut a release

1. Set `version` in `package.json` to the version you are shipping, and commit that.
2. Add `release/notes-<version>.md` with Highlights, Fixes, Still included, Caution, and a `<!-- PACKAGES -->` marker. The build fails if that file is missing.
3. Push a tag that matches it, including the leading `v`:

```powershell
git tag v5.3.0-beta.22
git push origin v5.3.0-beta.22
```

The workflow refuses to publish when the tag and `package.json` disagree.

## Dry run

Actions → Release → Run workflow. Enter the version from `package.json` and leave **dry run** checked. That builds both exes, runs the verify scripts, checks `app.asar`, and uploads the artifacts. It does not create a GitHub release. Uncheck dry run only when you want the pre-release published from a manual run. A pushed tag always publishes.

## GnuPG

`resources/gpg` is not in the git repo. The workflow downloads the official GnuPG 2.4.8 Windows installer:

`https://gnupg.org/ftp/gcrypt/binary/gnupg-w32-2.4.8_20250514.exe`

SHA-256 `2cd239a8301c59da3737f44566c8c6f9c1779a148af3561e77fb866a0a90de4e`

It extracts `bin\` into `resources/gpg` and skips the installer's `*.tmp` copies. The app itself only launches:

- `gpg.exe` to decrypt an Apple `.zip.gpg` (passcode on stdin)
- `gpgconf.exe` to stop that run's `gpg-agent`

Those two need the rest of the bin directory beside them: `gpg-agent.exe`, `pinentry-basic.exe`, and the DLLs (`libgpg-error-0.dll`, `libgcrypt-20.dll`, `libassuan-9.dll`, `libksba-8.dll`, `libgpgme-11.dll`, `libnpth-0.dll`, `libntbtls-0.dll`, `libsqlite3-0.dll`, `zlib1.dll`). The other `gpg*.exe` tools ship with the same official bin directory. Nothing from that download is committed.

`electron-builder` has `npmRebuild: false`. The verify scripts run under Node 22 first, while `better-sqlite3` still matches that ABI. `electron-rebuild` then runs immediately before the package step so the native module matches Electron 43. The smoke check sets `ELECTRON_RUN_AS_NODE=1` so Electron does not open a window on the runner.

## Checks before the exes are uploaded

`scripts/check-release-asar.mjs` extracts `app.asar` and fails the build if any of these are missing: `icloud`, `wizard.html`, `/api/apple/list`, `zipWorkspace`, `/api/zip/workspace`, `googleCategories`, `GOOGLE_CATEGORIES`, `case_tag_defs`, `google-row:`, `Tagged only`. It also fails if app code contains `C:\Users\` or `C:\UWRP-work`. Dependency files under `node_modules` inside the asar are not scanned.

The same job builds `dist/portable/viewer.js` and `viewer.css` first, then runs `scripts/verify-google-return.ts`, `scripts/verify-google-large.ts` (including a sparse PDF over 600 MB, a sparse zip the size of the 3.6 GB production that crashed beta.17, and colon filenames), and `scripts/verify-portable-stream.ts` under Node. CI then runs `npm run build` and `npx electron-builder --win --publish never`. The local `npm run electron:build` script is unchanged. Publishing is a later `gh release create` step, using `GH_TOKEN` from `github.token`, and only when the run is a tag push or a manual run with dry run turned off.

## Verify a download

In PowerShell, from the folder that contains the exe:

```powershell
Get-FileHash -Algorithm SHA256 .\Universal.Warrant.Return.Parser.Setup.5.3.0-beta.22.exe
```

Compare the hash with the Packages table on the release. The letters are hex; case does not matter. Do not run the installer if the hash differs.
