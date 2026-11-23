# Universal Warrant Return Parser 5.3.0-beta.23

## Highlights

- Dropbox is a warrant provider. Part archives, file activity, and the user report import as one return. The Case returns row shows the Dropbox user id and the name from the user report when that report is present.
- File activity keeps the UTC time Dropbox wrote. A row links to a file only when the path and category agree. Rows with no file, and files with no row, both stay visible.
- A zip and the folder extracted from it can sit side by side. The zip is the copy that is imported. The extracted copy is recorded as skipped. Files that are not part of the return are left out.

## Fixes

- None beyond the Dropbox import.

## Still included

- Apple iCloud, including the import wizard
- Snapchat
- Google categories
- Tags, including Tagged only
- Portable export

## Caution

- The Dropbox return used to test this build is synthetic. It is not case data.
- This build is unsigned. Windows may warn before it runs.

<!-- PACKAGES -->
