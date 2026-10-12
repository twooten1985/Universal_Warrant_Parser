# Universal Warrant Return Parser

Offline Windows app for reading provider warrant returns. Parsing, the case database, and media stay on this machine. The app does not change the original return files.

## CHANGES

The Locations Map plots every coordinate in the return: IP addresses (only when IP lookup is on), photo EXIF, video metadata, JSON and CSV location records, and sidecar JSON. It is available whenever any point exists. Layers, clustering, and a date range filter the view. A point opens the media item or the source record. CSV and KML export the points on the map. The media browser inspect view shows coordinates, altitude, capture time, device, and source, and Has location filters the grid. The portable viewer shows the same inspect data and a coordinate list with maps links. It does not load map tiles by itself.

Image and video locations are read from file headers only (JPEG, PNG, WebP, HEIC/HEIF, TIFF, DNG, and MP4/MOV/M4V/3GP), including large files. JSON and CSV are scanned in chunks. Results are stored on the case (`gps_lat`, `gps_lng`, altitude, capture time, device, coordinate source, and a locations table) so a saved case reopens without reading the return again. Rescan media on the map rebuilds them.

Media browser pages the attachments. Above and below the grid, use **Per page** to choose 25, 50, 100, 250, or 500. First, Prev, Next, and Last move through the filtered set, and the line next to those buttons shows the current page and the total. The two controls stay on the same page. Choosing a page from the bottom control scrolls back to the top of the grid. Only that page is drawn, and only those thumbnails are loaded.

The portable case is a zip the app writes on disk. The server streams it: media files are copied one at a time, and the case records are split into small script files the viewer loads with script tags. Unzip the folder and double-click `Portable_Case_Viewer.html`. That page is the same media vault as the app (search, type tabs, exhibit tags, inspect view, and the same paging above and below the grid). It does not need this program installed and it does not call the network to show pictures. Original evidence files are not changed. A tagged-only package keeps tagged media. Turning media off leaves the browser empty. The build dialog shows files done and the current file, and Cancel deletes a partial zip. Failures are written to `uwrp-errors.log`.

Saving a case stores the parsed records, account details, tags, and notes in the local SQLite database. A small picture that was embedded in the workspace (such as the sample return) is copied into an app-owned media cache at that moment so it can be shown again. The original warrant files are not modified. Reopening that case, including after a crash or a restart, loads those records and does not parse the original return again. The app also auto-saves a few seconds after a successful parse and reopens the last case on startup. Media bytes are not copied into the database. Thumbnails are read from the original path, or from an app-owned cache when the file came from a zip. If that file is gone, the tile says **Media file missing** and the rest of the case still opens.

While a parse, save, or case load is actually working, a progress panel shows the step and a percent when the count is known. A blank window is a different problem: if the page hits an error, a message is shown instead of a white screen, and the error is appended to `uwrp-errors.log` next to the case database. In the installed app, **Help → Toggle Developer Tools** (Ctrl+Shift+I), **Help → Open Log Folder**, and **Help → Reload Window** stay on the menu bar. The **Diagnostics** button in the header opens the same log path and the same commands. If the window stops responding, or the renderer process ends, the app offers a reload instead of leaving a white window. Reload opens the saved case from the database.

Large returns no longer keep every file's text or every image as base64 in the page. The server reads source files when it parses, events are stored one row at a time, and the media grid only mounts the current page. Video tiles load metadata for a preview instead of the whole file.

## Run locally

1. `npm install`
2. `npm run dev`

The dev server prints the URL it is using. The case database is `database.sqlite` in the working directory. `uwrp-errors.log` is written beside it.

Packaged Windows build: `npm run electron:build`. The database and `uwrp-errors.log` are in the app's user data folder. Help → Open Log Folder opens that folder.

`npm run lint` is the TypeScript check. `npm run build` writes the renderer and `dist/server.cjs`.
