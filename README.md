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
Credits: https://YOUR-USERNAME.github.io/po-vibe/credits.html

## Local preview

Run python3 -m http.server 8141 here, then visit http://localhost:8141/.
WASD/arrows drive, Space handbrake, C camera, R reset, G look panel.

## Current limits

The corridor still needs touch-driving controls and real-device mobile performance testing.
Hosting this build does not make it mobile-ready. No analytics is configured.
Libraries and fonts require internet access. The full asset collection is approximately 350 MB;
a play session downloads only the assets it requests.

release.json identifies the source revision. Make changes in the source repository and export
a new release; do not copy its .gitattributes or .git into this repository.
