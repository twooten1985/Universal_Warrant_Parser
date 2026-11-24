# Universal Warrant Return Parser 5.3.0-beta.25

## Highlights

- The HTML report is written to a folder from outside the window. Media is copied into a files folder beside report.html. The window stays open, progress is shown, and a failed export shows the reason and writes it to the error log.
- The PDF report is a PDF file. The contents, records, tags, file names, and web addresses are clickable links. Images are small JPEG thumbnails. A video uses a first-frame thumbnail when one can be made, otherwise a labeled placeholder with the name and hash.
- Blur is off unless you turn on Blur sensitive media for that export.

## Fixes

- Exporting an HTML report no longer builds the whole report, including media bytes, inside the window. That work was large enough to close the window.
- PDF pictures are no longer a blurred empty file icon.

## Still included

- Apple iCloud, including the import wizard
- Snapchat
- Google categories
- Dropbox
- Tags, including Tagged only
- Portable export

## Caution

- The reports used to test this build are synthetic. They are not case data.
- This build is unsigned. Windows may warn before it runs.

<!-- PACKAGES -->
