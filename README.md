# MindfulSurf – Digital Wellbeing Extension

A Chrome/Edge MV3 extension that helps you spend time intentionally: set daily limits for distracting sites, see a small on-page timer, and get gently blocked when time is up.

## 1) Setup & Installation

- Requirements: Chrome/Edge with Manifest V3 support.
- Install (unpacked):
  1.  Open `chrome://extensions` (or `edge://extensions`).
  2.  Enable "Developer mode".
  3.  Click "Load unpacked" and select this `mindfulsurf` folder.
  4.  If already loaded, click the service worker "Reload" button after updates.

Optional developer helpers:

- To reveal the Developer section in Options temporarily, open: `options.html?dev=1` (or add `#dev=1`).
- To persist Dev mode, set `msSettings.devMode = true` in `chrome.storage.sync`.

## 2) Quick Start

1. Click the toolbar icon to open the popup.
2. Add or edit site limits (defaults included, e.g., `youtube.com` = 10 minutes).
3. Browse normally. When a limited site is active, usage increments once per minute.
4. When a site hits its daily limit, further visits are redirected to a friendly block page. You can use one 5‑minute snooze per site per day.

## 3) Project Architecture Overview

MindfulSurf is organized around MV3’s service worker, Declarative Net Request (DNR), and simple UI surfaces.

- Background service worker (`background.js`)

  - Tracks time with `chrome.alarms` (one-minute ticks).
  - Writes `LAST_TICK` for smooth second-level countdowns in pages.
  - Builds/updates DNR dynamic redirect rules to `blocked.html?site=<domain>` when a site reaches its limit.
  - Handles daily reset at local midnight (clears usage and resets snooze-used flags).
  - Serializes DNR updates to avoid duplicate rule ID errors and includes a one-time migration that rebuilds rules.
  - Provides messaging endpoints for UI (enforce rules, snooze status, etc.).

- Content script (`content.js`)

  - Shows a compact, draggable overlay timer on limited sites.
  - Displays remaining time in `mm:ss` using `LAST_TICK` to keep seconds accurate.
  - During a snooze, it can either display `Snoozed: m:ss` or hide entirely (controlled by Options).
  - Includes a lightweight 30‑minute break reminder; timers pause/resume with page visibility.

- Block page (`blocked.html` + `blocked.js`)

  - Friendly UI explaining the block; shows the site.
  - A single “Snooze 5 min” button (once per site per day). After use, a rest message replaces the button.
  - Snooze is applied atomically in the background and rules are refreshed immediately.

- Options page (`options.html` + `options.js`)

  - Manage whitelist, view today’s usage, and tweak preferences.
  - Preferences include: show/hide snooze countdown on pages.
  - Developer section (hidden unless dev mode is on) includes a one‑click “Reset today” button.

- Popup (`popup.html` + `popup.js`)

  - Quick add/edit of site limits (defaults editable, custom sites removable).

- Styles (`style.css`) and Manifest (`manifest.json`)
  - Shared minimal styling with dark mode.
  - MV3 manifest with storage/tabs/alarms/DNR permissions and web‑accessible `blocked.html/js`.

## 4) Data & Permissions

- Permissions: `storage`, `tabs`, `alarms`, `declarativeNetRequest`, `declarativeNetRequestFeedback` (+ host permissions for http/https). No remote scripts or fonts.
- Storage layout:
  - `storage.sync` (preferences): `siteLimits`, `whitelist`, `msSettings` (e.g., `showSnoozeCountdown`, optional `devMode`).
  - `storage.local` (per-device state): `siteUsage`, `lastResetDay`, `lastTickAt`, `snoozes` (domain → expiry), `snoozeUsed` (per-site per-day).
- Privacy: All data stays in the browser. No network calls.

## 5) Core Behaviors

- Time tracking

  - Every minute, the background updates `siteUsage` for all active tabs’ matched sites.
  - Subdomains match their parent domain limits (e.g., `m.youtube.com` → `youtube.com`).
  - Daily reset: clears `siteUsage` and `snoozeUsed` at local midnight.

- Blocking

  - When a site’s usage ≥ limit, a DNR dynamic rule redirects main-frame requests to `blocked.html?site=<domain>`.
  - Already-open matching tabs are updated to the block page.
  - Rule updates are serialized and deduped to prevent duplicate ID errors.

- Snooze (one per site per day)

  - Blocked page applies snooze via a single message: `ms_applySnoozeAndUnblock`.
  - Background marks snooze-used for today, sets snooze expiry, and re-enforces rules immediately.
  - During snooze, overlay can show a live countdown or hide (Option).

- Overlay timer
  - Draggable, corner-snapping, collapsible; preferences are saved per-domain.
  - Uses `LAST_TICK` to render a smooth `mm:ss` countdown without jitter when switching tabs.

## 6) Source Files & Responsibilities

- `manifest.json` — MV3 manifest, permissions, background worker, content scripts, web‑accessible resources.
- `background.js` — State loading/saving, minute alarm, site matching, rule management (DNR), daily reset, messaging, serialized enforcement, rule migration.
- `content.js` — Break reminder, overlay UI (timer & snooze countdown option), lifecycle guards, per-domain UI prefs.
- `blocked.html`, `blocked.js` — Block screen UI, one‑time daily snooze, atomic snooze+unblock, options link, close tab.
- `options.html`, `options.js` — Whitelist management, usage view & chart, preferences (snooze countdown), dev-only “Reset today”.
- `popup.html`, `popup.js` — Quick add/edit of site limits.
- `style.css` — Shared UI styles with dark mode.

## 7) Configuration & Preferences

- Limits: via Popup (and visible in Options). Defaults include `youtube.com`, `instagram.com`, `snapchat.com`, `x.com`, `tiktok.com`.
- Whitelist: never counted or blocked; subdomains included.
- Preferences (Options → Preferences):
  - Show snooze countdown on pages (on/off).
- Developer helpers (Options → Developer):
  - Reset today (usage + snooze) — visible if `?dev=1` or `msSettings.devMode` is true.

## 8) Troubleshooting

- If blocking or snooze seems off, reload the service worker in `chrome://extensions`.
- Ensure `declarativeNetRequest`(+Feedback) permissions and that `blocked.html`/`blocked.js` are in `web_accessible_resources`.
- On first run after upgrading, the extension clears and rebuilds DNR rules (one‑time migration) so redirects include `?site=...`.
- The background serializes rule updates to prevent duplicate rule ID errors. If you still see DNR errors, try disabling/re-enabling the extension once.

## 9) Changelog (Highlights)

- Minute-based tracking via `chrome.alarms`.
- DNR redirect with `blocked.html?site=<domain>`.
- Atomic snooze application and immediate rule refresh.
- One snooze per site per day with rest message.
- Overlay timer with optional snooze countdown, robust lifecycle.
- Serialized DNR updates and one‑time migration to new rule format.
- Options polish (default limits, whitelist, usage chart, dev reset button).

---

Built with JavaScript, HTML, and CSS. Future scope: export/import settings, analytics view, and scheduled pauses.

Team: Sparta.

Team Members: Thimmaiah K K, Rehan, Abdul Ameen
