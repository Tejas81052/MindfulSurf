# MindfulSurf – Digital Wellbeing Extension

A Chrome/Edge MV3 extension that lets you set daily time limits for distracting sites and gently blocks them when time is up.

## What changed in this version

- Switched to robust time tracking using alarms (1-minute ticks) instead of setInterval in background.
- Uses Declarative Net Request dynamic rules to redirect blocked sites to `blocked.html` (more reliable and fast).
- Stores usage in `storage.local` to avoid sync write limits; preferences (limits) remain in `storage.sync`.
- Immediate redirect of already-open tabs once a site crosses its limit.
- Daily reset at local midnight with rules cleared/rebuilt.

## How to load

1. Open chrome://extensions (or edge://extensions).
2. Enable "Developer mode".
3. Click "Load unpacked" and select this `mindfulsurf` folder.
4. If the extension was already loaded, click the service worker "Reload" icon after updating files.

## Try it

- Click the toolbar icon to open the popup.
- Limits list shows defaults (youtube.com = 10, etc). Edit or add your own site.
- Visit a limited site and keep the tab active. Each active minute increments usage.
- When usage reaches the limit, future navigations are auto-redirected to `blocked.html`, and any open matching tabs will be redirected immediately.

## Notes

- Subdomains are covered (e.g., `www.youtube.com`, `m.youtube.com`).
- Usage increments only when the tab is active (focused) in any window.
- Daily reset occurs based on your device's local date (00:00). Usage is per-device.

## Troubleshooting

- If blocking seems off, reload the service worker in chrome://extensions.
- Make sure the extension has "Allow access to file URLs" disabled unless needed.
- Check that `declarativeNetRequest` permission is present and `blocked.html` is listed under `web_accessible_resources` in `manifest.json`.
- Edge also supports DNR; ensure you're on a recent version.

---

Built with JavaScript/CSS/HTML. Future scope: cloud sync of usage, React + charts for analytics popup.
