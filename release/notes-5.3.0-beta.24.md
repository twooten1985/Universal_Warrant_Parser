# Universal Warrant Return Parser 5.3.0-beta.24

## Highlights

- Dropbox images and videos are in the Media Vault with the other providers. The vault can be limited by provider and by an individual return, together with the filters that were already there. The inspect view shows the Dropbox part, Deleted Files or File Data, and the category.
- Dropbox documents, file-activity rows, authentication-log rows, mobile devices, linked computers, and billing can take the same color case tags as other evidence. The tags stay with the case, follow Tagged only, and are included in the evidence locker and exports.
- The Dropbox user report is read from a compressed, multi-page PDF, including table cells and an IPv6 address that wraps onto the next line. The file can be named user-metadata.pdf, User Metadata.pdf, or a part-numbered variant, at any depth, including inside a zip. If the text cannot be read, the Dropbox account panel says why and still offers the PDF.

## Fixes

- A Dropbox user report whose text lived in a compressed stream, or whose file name was not exactly user-metadata.pdf, no longer left the account panel empty with no explanation.

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
