// Show a break reminder every 30 minutes
function showBreakReminder() {
  if (document.getElementById("mindfulsurf-break-reminder")) return;
  const div = document.createElement("div");
  div.id = "mindfulsurf-break-reminder";
  div.style.position = "fixed";
  div.style.top = "20px";
  div.style.right = "20px";
  div.style.background = "#e0f7fa";
  div.style.color = "#006064";
  div.style.padding = "20px 30px";
  div.style.borderRadius = "10px";
  div.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
  div.style.zIndex = "9999";
  div.innerHTML =
    '<b>MindfulSurf:</b> Time for a short break! <button id="mindfulsurf-close">Dismiss</button>';
  document.body.appendChild(div);
  document.getElementById("mindfulsurf-close").onclick = () => div.remove();
}

let reminderTimer = null;
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

function startReminderTimer() {
  if (reminderTimer !== null) return; // already running
  reminderTimer = setInterval(() => {
    if (document.visibilityState === "visible") {
      showBreakReminder();
    }
  }, INTERVAL_MS);
}

function stopReminderTimer() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}

// Start initially when visible
if (document.visibilityState === "visible") {
  startReminderTimer();
}

// Some sites disallow the 'unload' event via Permissions-Policy.
// Use pagehide/visibilitychange instead to avoid policy violations.
window.addEventListener("pagehide", () => {
  stopReminderTimer();
});

// When the page becomes hidden, pause; when visible again, resume
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    stopReminderTimer();
  } else {
    startReminderTimer();
  }
});

// Some browsers fire pageshow on BFCache restores; resume the timer.
window.addEventListener("pageshow", () => {
  if (document.visibilityState === "visible") startReminderTimer();
});

// ==========================
// MindfulSurf Remaining-Time Overlay
// - Draggable, corner-snapping panel showing minutes left for current site
// - Respects whitelist and snooze (hidden if snoozed or not limited)
// - Collapsible and position persisted per-domain in storage.local
// ==========================

(function () {
  if (!window.chrome || !chrome.storage) return;

  const LIMITS_KEY = "siteLimits";
  const USAGE_KEY = "siteUsage";
  const WHITELIST_KEY = "whitelist";
  const SNOOZES_KEY = "snoozes";
  const OVERLAY_PREFS_KEY = "overlayPrefs"; // { [domain]: { corner: 'br'|'bl'|'tr'|'tl', collapsed: boolean } }
  const LAST_TICK_KEY = "lastTickAt"; // timestamp of last minute tick written by background
  const SETTINGS_KEY = "msSettings"; // { showSnoozeCountdown: boolean }

  const DEFAULT_SITES = {
    "youtube.com": 10,
    "instagram.com": 5,
    "snapchat.com": 5,
    "x.com": 5,
    "tiktok.com": 5,
  };

  function normalizeHostname(hostname) {
    return (hostname || "").replace(/^www\./, "");
  }
  function getPageHostname() {
    try {
      return normalizeHostname(location.hostname);
    } catch (e) {
      return null;
    }
  }
  function isWhitelistedHostname(list, hostname) {
    if (!Array.isArray(list)) return false;
    return list.some((w) => hostname === w || hostname.endsWith("." + w));
  }
  function findMatchedSite(hostname, limits) {
    if (!hostname || !limits) return null;
    const sites = Object.keys(limits);
    return (
      sites.find((s) => hostname === s || hostname.endsWith("." + s)) || null
    );
  }
  function getSnoozeExpiry(snoozes, domain) {
    if (!snoozes || !domain) return null;
    const exp = snoozes[domain];
    return exp && typeof exp === "number" ? exp : null;
  }

  function isExtensionAlive() {
    return !!(window.chrome && chrome.runtime && chrome.runtime.id);
  }

  // UI
  let overlayEl = null;
  let labelEl = null;
  let collapseBtn = null;
  const CORNERS = ["br", "bl", "tr", "tl"]; // bottom-right, bottom-left, top-right, top-left

  function createOverlay() {
    if (document.getElementById("mindfulsurf-overlay")) return;
    const root = document.createElement("div");
    root.id = "mindfulsurf-overlay";
    root.style.position = "fixed";
    root.style.zIndex = "2147483647";
    root.style.fontFamily =
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial";
    root.style.userSelect = "none";
    root.style.transition = "opacity 0.2s ease";

    const panel = document.createElement("div");
    panel.style.display = "flex";
    panel.style.alignItems = "center";
    panel.style.gap = "8px";
    panel.style.padding = "8px 10px";
    panel.style.background = "rgba(0,0,0,0.65)";
    panel.style.color = "#fff";
    panel.style.borderRadius = "10px";
    panel.style.boxShadow = "0 2px 10px rgba(0,0,0,0.25)";
    panel.style.backdropFilter = "blur(2px)";
    panel.style.cursor = "move"; // as a hint that it can be dragged

    const icon = document.createElement("span");
    icon.textContent = "⏳";
    icon.style.fontSize = "14px";
    icon.style.lineHeight = "1";

    labelEl = document.createElement("span");
    labelEl.style.fontWeight = "600";
    labelEl.style.fontSize = "13px";
    labelEl.textContent = "–";

    collapseBtn = document.createElement("button");
    collapseBtn.textContent = "–";
    Object.assign(collapseBtn.style, {
      background: "transparent",
      border: "none",
      color: "#fff",
      cursor: "pointer",
      padding: "0 2px",
      margin: "0",
      fontSize: "16px",
      lineHeight: "1",
    });
    collapseBtn.title = "Hide timer";

    panel.appendChild(icon);
    panel.appendChild(labelEl);
    panel.appendChild(collapseBtn);
    root.appendChild(panel);
    document.documentElement.appendChild(root);
    overlayEl = root;

    enableDragging(root);
  }

  function setCorner(corner) {
    if (!overlayEl) return;
    overlayEl.style.top =
      overlayEl.style.right =
      overlayEl.style.bottom =
      overlayEl.style.left =
        "auto";
    const margin = 12;
    switch (corner) {
      case "br":
        overlayEl.style.right = margin + "px";
        overlayEl.style.bottom = margin + "px";
        break;
      case "bl":
        overlayEl.style.left = margin + "px";
        overlayEl.style.bottom = margin + "px";
        break;
      case "tr":
        overlayEl.style.right = margin + "px";
        overlayEl.style.top = margin + "px";
        break;
      case "tl":
        overlayEl.style.left = margin + "px";
        overlayEl.style.top = margin + "px";
        break;
      default:
        overlayEl.style.right = margin + "px";
        overlayEl.style.bottom = margin + "px";
    }
  }

  function nearestCorner(clientX, clientY) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const distances = [
      { c: "tl", d: Math.hypot(clientX, clientY) },
      { c: "tr", d: Math.hypot(w - clientX, clientY) },
      { c: "bl", d: Math.hypot(clientX, h - clientY) },
      { c: "br", d: Math.hypot(w - clientX, h - clientY) },
    ];
    distances.sort((a, b) => a.d - b.d);
    return distances[0].c;
  }

  function enableDragging(el) {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e) => {
      const isButton = e.target === collapseBtn;
      if (isButton) return; // don't start drag from button
      dragging = true;
      lastX = e.touches ? e.touches[0].clientX : e.clientX;
      lastY = e.touches ? e.touches[0].clientY : e.clientY;
      document.addEventListener("mousemove", onMove, { passive: true });
      document.addEventListener("mouseup", onUp, { passive: true });
      document.addEventListener("touchmove", onMove, { passive: true });
      document.addEventListener("touchend", onUp, { passive: true });
    };
    const onMove = (e) => {
      if (!dragging) return;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      // visually move near the pointer while dragging by setting transform
      el.style.transition = "none";
      el.style.transform = `translate(${x - lastX}px, ${y - lastY}px)`;
    };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      el.style.transition = "";
      el.style.transform = "";
      const x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
      const y = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
      const corner = nearestCorner(x, y);
      setCorner(corner);
      persistPrefs({ corner });
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };
    el.addEventListener("mousedown", onDown, { passive: true });
    el.addEventListener("touchstart", onDown, { passive: true });
  }

  // State
  let currentDomain = null;
  let collapsed = false;
  let corner = "br";

  function getPrefs(cb) {
    chrome.storage.local.get([OVERLAY_PREFS_KEY], (data) => {
      const all = data[OVERLAY_PREFS_KEY] || {};
      cb(all);
    });
  }
  function persistPrefs(partial) {
    if (!currentDomain) return;
    getPrefs((all) => {
      const cur = all[currentDomain] || {};
      const next = { ...cur, ...partial };
      const merged = { ...all, [currentDomain]: next };
      chrome.storage.local.set({ [OVERLAY_PREFS_KEY]: merged });
    });
  }

  function applyPrefsForDomain(domain) {
    getPrefs((all) => {
      const p = all[domain] || {};
      collapsed = !!p.collapsed;
      corner = CORNERS.includes(p.corner) ? p.corner : "br";
      if (!overlayEl) createOverlay();
      setCorner(corner);
      renderCollapsed();
    });
  }

  function renderCollapsed() {
    if (!overlayEl) return;
    const panel = overlayEl.firstChild;
    if (!panel) return;
    if (collapsed) {
      panel.style.padding = "6px 8px";
      if (labelEl) labelEl.style.display = "none";
      if (collapseBtn) collapseBtn.textContent = "+";
      collapseBtn.title = "Show timer";
    } else {
      panel.style.padding = "8px 10px";
      if (labelEl) labelEl.style.display = "";
      if (collapseBtn) collapseBtn.textContent = "–";
      collapseBtn.title = "Hide timer";
    }
  }

  function formatMMSS(remainingMinutes, lastTickAt) {
    if (remainingMinutes <= 0) return "Time's up";
    if (!lastTickAt || typeof lastTickAt !== "number") {
      return `${remainingMinutes}:00 left`;
    }
    const now = Date.now();
    const elapsed = Math.max(0, now - lastTickAt);
    const elapsedS = Math.floor(elapsed / 1000);
    // Start displaying at mm:59 right after a tick to avoid a jarring jump
    const total = Math.max(0, (remainingMinutes || 0) * 60 - elapsedS - 1);
    const m = Math.max(0, Math.floor(total / 60));
    const s = Math.max(0, total % 60);
    return `${m}:${String(s).padStart(2, "0")} left`;
  }

  function formatSecondsMMSS(totalSeconds) {
    const sec = Math.max(0, Math.floor(totalSeconds || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  let lastRender = {
    domain: null,
    remaining: null,
    lastTickAt: null,
    snoozeEndAt: null, // ms timestamp when snooze ends; if set, we render a snooze countdown
  };
  let secondsTimer = null;
  let refreshTimer = null;
  function stopOverlayTimers() {
    if (secondsTimer) {
      clearInterval(secondsTimer);
      secondsTimer = null;
    }
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }
  function render(domain, remainingMinutes, lastTickAt, snoozeEndAt) {
    if (!overlayEl || !labelEl) return;
    // Avoid thrash
    lastRender = {
      domain,
      remaining: remainingMinutes,
      lastTickAt,
      snoozeEndAt: snoozeEndAt || null,
    };
    if (snoozeEndAt) {
      const left = Math.max(0, Math.ceil((snoozeEndAt - Date.now()) / 1000));
      labelEl.textContent = `Snoozed: ${formatSecondsMMSS(left)}`;
    } else {
      labelEl.textContent = formatMMSS(remainingMinutes, lastTickAt);
    }
    if (!secondsTimer) {
      secondsTimer = setInterval(() => {
        if (!overlayEl || !labelEl) return;
        if (lastRender.snoozeEndAt) {
          const left = Math.max(
            0,
            Math.ceil((lastRender.snoozeEndAt - Date.now()) / 1000)
          );
          labelEl.textContent = `Snoozed: ${formatSecondsMMSS(left)}`;
          if (left <= 0) {
            // Snooze ended; refresh view to show remaining site time
            lastRender.snoozeEndAt = null;
            loadAndMaybeShow();
          }
        } else {
          labelEl.textContent = formatMMSS(
            lastRender.remaining || 0,
            lastRender.lastTickAt || null
          );
        }
      }, 1000);
    }
  }

  function loadAndMaybeShow() {
    if (!isExtensionAlive()) {
      // Extension got reloaded/unloaded; stop timers to prevent errors
      stopOverlayTimers();
      return;
    }
    const hostname = getPageHostname();
    if (!hostname) return;

    try {
      chrome.storage.sync.get(
        [LIMITS_KEY, WHITELIST_KEY, SETTINGS_KEY],
        (syncData) => {
          const limits = { ...DEFAULT_SITES, ...(syncData[LIMITS_KEY] || {}) };
          const whitelist = syncData[WHITELIST_KEY] || [];
          const settings = syncData[SETTINGS_KEY] || {};
          if (isWhitelistedHostname(whitelist, hostname)) return; // never show on whitelisted

          const matched = findMatchedSite(hostname, limits);
          if (!matched) return; // not a limited site

          chrome.storage.local.get(
            [USAGE_KEY, SNOOZES_KEY, LAST_TICK_KEY],
            (localData) => {
              const usage = localData[USAGE_KEY] || {};
              const snoozes = localData[SNOOZES_KEY] || {};
              const lastTickAt = localData[LAST_TICK_KEY] || null;
              const limit = limits[matched] || 0;
              if (!limit) return;
              const used = usage[matched] || 0;
              const remaining = Math.max(0, limit - used);
              currentDomain = matched;

              // Build UI and apply saved prefs
              createOverlay();
              applyPrefsForDomain(currentDomain);
              const snoozeEndAt = getSnoozeExpiry(snoozes, matched);
              const showSnoozeCountdown = !!settings.showSnoozeCountdown;
              if (snoozeEndAt && Date.now() < snoozeEndAt) {
                if (showSnoozeCountdown) {
                  render(currentDomain, remaining, lastTickAt, snoozeEndAt);
                } else {
                  if (overlayEl) {
                    overlayEl.remove();
                    overlayEl = null;
                  }
                  stopOverlayTimers();
                  return;
                }
              } else {
                render(currentDomain, remaining, lastTickAt, null);
              }

              // Wire collapse toggle
              if (collapseBtn && !collapseBtn._wired) {
                collapseBtn._wired = true;
                collapseBtn.addEventListener("click", () => {
                  collapsed = !collapsed;
                  renderCollapsed();
                  persistPrefs({ collapsed });
                });
              }
            }
          );
        }
      );
    } catch (e) {
      // ignore if extension context got invalidated mid-call
    }
  }

  // Update when storage changes (usage/limits/whitelist/snoozes/settings)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!isExtensionAlive()) return;
    if (
      (area === "local" &&
        (changes[USAGE_KEY] ||
          changes[SNOOZES_KEY] ||
          changes[LAST_TICK_KEY])) ||
      (area === "sync" &&
        (changes[LIMITS_KEY] ||
          changes[WHITELIST_KEY] ||
          changes[SETTINGS_KEY]))
    ) {
      // If lastTick changed, update our render cache then refresh
      if (
        area === "local" &&
        changes[LAST_TICK_KEY] &&
        changes[LAST_TICK_KEY].newValue
      ) {
        lastRender.lastTickAt = changes[LAST_TICK_KEY].newValue;
      }
      loadAndMaybeShow();
    }
  });

  // Initial load and periodic refresh as a fallback
  loadAndMaybeShow();
  function startOverlayRefresh() {
    if (!refreshTimer) {
      refreshTimer = setInterval(() => {
        loadAndMaybeShow();
      }, 15000);
    }
  }
  startOverlayRefresh();

  // Pause timers when page hidden/unloaded; resume when visible
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      stopOverlayTimers();
    } else {
      loadAndMaybeShow();
      startOverlayRefresh();
    }
  });
  window.addEventListener("pagehide", () => {
    stopOverlayTimers();
  });
  window.addEventListener("pageshow", () => {
    loadAndMaybeShow();
    startOverlayRefresh();
  });
})();
