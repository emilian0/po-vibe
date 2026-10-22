# Po Vibe

Ready-to-host browser driving game. The root link opens the summer Dolomites → Lake Garda drive.
This repository contains runtime files and actual binary assets, with no Git LFS dependency.

## Publish on GitHub Pages

1. Create an empty GitHub repository named po-vibe.
2. Push this local repository to it.
3. In Settings → Pages, choose **Deploy from a branch**, **main**, **/(root)**.

Play: https://YOUR-USERNAME.github.io/po-vibe/
Direct entry: https://YOUR-USERNAME.github.io/po-vibe/game/?spawn=dolomites
Po circuit and car picker: https://YOUR-USERNAME.github.io/po-vibe/game/
Data sources and required attributions: [DATA_SOURCES.md](DATA_SOURCES.md)

## Local preview

Run python3 -m http.server 8141 here, then visit http://localhost:8141/.
WASD/arrows drive, Space handbrake, C camera, R reset, G look panel.
On touch screens: drag the fixed left steering pad and hold the gas or brake/reverse pedal on the right.
Camera and reset are above the drive area. Your location is saved on this device; the next visit offers Continue or Start at the beginning.
Landscape is recommended. Add &touch to the game URL to preview touch controls on desktop.

## Current limits

Touch input and layouts are browser-tested; real-device mobile performance testing is still needed.
No analytics is configured.
Libraries and fonts require internet access. The Alfa-only asset collection is approximately 167 MB;
a play session downloads only the assets it requests.

release.json identifies the source revision. Make changes in the source repository and export
a new release; do not copy its .gitattributes or .git into this repository.
