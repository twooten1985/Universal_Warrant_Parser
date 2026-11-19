# Universal Warrant Return Parser 5.3.0-beta.22

## Highlights

- Add Return asks you to confirm the detected provider before a zip or folder is parsed. The top-right control is only a view filter (All, or one provider).
- Each return can have an optional subject and a role: Suspect, Victim, Witness, or Other. Returns already in a case are Unassigned until you edit them.
- The Case returns panel is one summary row per return: name, subject, role, provider, account id when one was detected, import date, source name, SHA-256 when it was already computed, and counts. Re-parse, Rename, and Remove act on that return's parsed rows. Remove does not change the source files.

## Fixes

- A Google return no longer loads a PDF, a zip, or another binary into one string. That read was hitting the JavaScript string limit on Drive PDFs and Node's 2 GiB file limit on a multi-gigabyte production zip.
- Zips that have a disk path are extracted by streaming. A large zip the window cannot read by path is skipped with a warning instead of crashing the tab.
- Entry names Windows cannot store, including a colon in a mail timestamp, reserved names, and very long paths, are sanitized on disk. The original name stays in the metadata.
- A file that cannot be parsed is logged to `uwrp-errors.log` with the path relative to the return, and the window lists it. The rest of the return still opens.
- A window reload that aborts the previous page load is no longer recorded as a crash.

## Still included

- Apple iCloud, including the import wizard
- Snapchat
- Google categories
- Tags, including Tagged only
- Portable export

## Caution

- The large returns used to test this build are synthetic. They are not case data.
- This build is unsigned. Windows may warn before it runs.

<!-- PACKAGES -->
