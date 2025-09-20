// MindfulSurf MV3 Background: robust minute tracking + DNR redirect blocking
const DEFAULT_SITES = {
  "youtube.com": 10,
  "instagram.com": 5,
  "snapchat.com": 5,
  "x.com": 5,
};
const MAX_LIMIT = 30;
const MIN_LIMIT = 1;

// Storage keys (usage in local to avoid sync write quotas)
const USAGE_KEY = "siteUsage";
const LIMITS_KEY = "siteLimits"; // kept in sync to allow device sync of preferences
const LAST_RESET_KEY = "lastResetDay"; // kept in local (per-device reset)
const WHITELIST_KEY = "whitelist"; // in sync (preferences)
const SNOOZES_KEY = "snoozes"; // local: { [domain]: expiresAtMs }

let siteLimits = {};
let siteUsage = {};
let lastResetDay = null;
let whitelist = [];
let snoozes = {};

// --- Helpers
function normalizeHostname(hostname) {
  return hostname.replace(/^www\./, "");
}

function getDayString() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function domainToRuleId(domain) {
  // Stable small positive hash for deterministic rule ids
  let h = 0;
  for (let i = 0; i < domain.length; i++) {
    h = (h << 5) - h + domain.charCodeAt(i);
    h |= 0; // 32-bit
  }
  // Place in a safe positive range (avoid collisions with other extensions or static rules)
  return 100000 + ((h >>> 0) % 900000); // 100000..999999
}

function buildRedirectRule(domain) {
  return {
    id: domainToRuleId(domain),
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/blocked.html" },
    },
    condition: {
      // Match main-frame navigations to the domain or its subdomains
      urlFilter: `||${domain}^`,
      resourceTypes: ["main_frame"],
    },
  };
}

function clampLimits(limits) {
  const result = { ...limits };
  for (const site of Object.keys(result)) {
    if (result[site] > MAX_LIMIT) result[site] = MAX_LIMIT;
    if (result[site] < MIN_LIMIT) result[site] = MIN_LIMIT;
  }
  return result;
}

function cleanupExpiredSnoozes(callback) {
  const now = Date.now();
  let changed = false;
  for (const d of Object.keys(snoozes)) {
    if (!snoozes[d] || snoozes[d] <= now) {
      delete snoozes[d];
      changed = true;
    }
  }
  if (changed) {
    chrome.storage.local.set(
      { [SNOOZES_KEY]: snoozes },
      () => callback && callback()
    );
  } else {
    callback && callback();
  }
}

// --- State sync
function loadState(callback) {
  // Load limits from sync (merge with defaults), usage/reset from local
  chrome.storage.sync.get([LIMITS_KEY, WHITELIST_KEY], (syncData) => {
    const mergedLimits = clampLimits({
      ...DEFAULT_SITES,
      ...((syncData && syncData[LIMITS_KEY]) || {}),
    });
    chrome.storage.local.get(
      [USAGE_KEY, LAST_RESET_KEY, SNOOZES_KEY],
      (localData) => {
        siteLimits = mergedLimits;
        siteUsage = (localData && localData[USAGE_KEY]) || {};
        lastResetDay =
          (localData && localData[LAST_RESET_KEY]) || getDayString();
        whitelist = (syncData && syncData[WHITELIST_KEY]) || [];
        snoozes = (localData && localData[SNOOZES_KEY]) || {};
        cleanupExpiredSnoozes(() => callback && callback());
      }
    );
  });
}

function saveUsage(callback) {
  chrome.storage.local.set({ [USAGE_KEY]: siteUsage }, () => {
    callback && callback();
  });
}

function saveLastReset(callback) {
  chrome.storage.local.set({ [LAST_RESET_KEY]: lastResetDay }, () => {
    callback && callback();
  });
}

function dailyResetIfNeeded(callback) {
  const today = getDayString();
  if (lastResetDay !== today) {
    siteUsage = {};
    lastResetDay = today;
    chrome.storage.local.set(
      { [USAGE_KEY]: siteUsage, [LAST_RESET_KEY]: lastResetDay },
      () => {
        // After reset, drop all blocking rules
        clearAllBlockingRules(() => callback && callback());
      }
    );
  } else {
    callback && callback();
  }
}

// --- Declarative Net Request rules management
function getCurrentlyBlockedDomains(callback) {
  chrome.declarativeNetRequest.getDynamicRules((rules) => {
    const domains = new Set();
    for (const r of rules) {
      // Recover domain from rule by reverse mapping is non-trivial; rely on ids we generated
      // We'll iterate our limits and check which ids exist instead
    }
    // Instead, return rule ids set
    const ids = new Set(rules.map((r) => r.id));
    callback(ids);
  });
}

function clearAllBlockingRules(callback) {
  chrome.declarativeNetRequest.getDynamicRules((rules) => {
    const ids = rules.map((r) => r.id);
    if (ids.length === 0) return callback && callback();
    chrome.declarativeNetRequest.updateDynamicRules(
      { removeRuleIds: ids, addRules: [] },
      () => callback && callback()
    );
  });
}

function enforceBlockingRules(callback) {
  // Determine which domains must be blocked based on usage >= limit
  const shouldBlock = Object.keys(siteLimits).filter((domain) => {
    if (isWhitelistedDomain(domain)) return false;
    if (isSnoozed(domain)) return false;
    return (siteUsage[domain] || 0) >= siteLimits[domain];
  });

  getCurrentlyBlockedDomains((existingIds) => {
    const desiredRules = shouldBlock.map((d) => buildRedirectRule(d));
    const desiredIds = new Set(desiredRules.map((r) => r.id));

    // Compute removals: rules that exist but are not desired
    const removeRuleIds = Array.from(existingIds).filter(
      (id) => !desiredIds.has(id)
    );
    // Compute additions: desired that don't exist yet
    const addRules = desiredRules.filter((r) => !existingIds.has(r.id));

    if (removeRuleIds.length === 0 && addRules.length === 0) {
      return callback && callback();
    }

    chrome.declarativeNetRequest.updateDynamicRules(
      { removeRuleIds, addRules },
      () => callback && callback()
    );
  });
}

// --- Tracking logic
function findMatchedSiteForUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const hostname = normalizeHostname(u.hostname);
    if (isWhitelistedHostname(hostname)) return null;
    const matched = Object.keys(siteLimits).find(
      (site) => hostname === site || hostname.endsWith("." + site)
    );
    if (!matched) return null;
    if (isSnoozed(matched)) return null;
    return matched;
  } catch (e) {
    return null;
  }
}

function isWhitelistedDomain(domain) {
  // domain is a site key like "youtube.com"; whitelist can include that or parent domains
  return whitelist.some((w) => domain === w || domain.endsWith("." + w));
}

function isWhitelistedHostname(hostname) {
  return whitelist.some((w) => hostname === w || hostname.endsWith("." + w));
}

function isSnoozed(domain) {
  const exp = snoozes && snoozes[domain];
  if (!exp) return false;
  if (Date.now() > exp) return false;
  return true;
}

function minuteTick() {
  loadState(() =>
    dailyResetIfNeeded(() => {
      // Count all active tabs across all windows
      chrome.tabs.query({ active: true }, (tabs) => {
        const touchedSites = new Set();
        for (const t of tabs) {
          if (!t.url) continue;
          const site = findMatchedSiteForUrl(t.url);
          if (site) touchedSites.add(site);
        }
        if (touchedSites.size === 0) {
          // Still update rules in case something just crossed due to external edits
          return enforceBlockingRules(() => {});
        }
        // Increment one minute for each active site
        for (const s of touchedSites) {
          siteUsage[s] = (siteUsage[s] || 0) + 1;
        }
        saveUsage(() =>
          enforceBlockingRules(() => {
            // After rules are updated, force-redirect any currently open blocked tabs immediately
            chrome.tabs.query({}, (allTabs) => {
              for (const t of allTabs) {
                if (!t.url) continue;
                const site = findMatchedSiteForUrl(t.url);
                if (!site) continue;
                if ((siteUsage[site] || 0) >= siteLimits[site]) {
                  chrome.tabs.update(t.id, {
                    url: chrome.runtime.getURL(`blocked.html?site=${site}`),
                  });
                }
              }
            });
          })
        );
      });
    })
  );
}

// --- Event wiring
// Alarm-based minute tracking (service worker friendly)
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("mindfulsurf_tick", { periodInMinutes: 1 });
  // Initialize state and rules now
  loadState(() => dailyResetIfNeeded(() => enforceBlockingRules(() => {})));
});

// Ensure alarm exists when the worker starts
chrome.alarms.get("mindfulsurf_tick", (alarm) => {
  if (!alarm) chrome.alarms.create("mindfulsurf_tick", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "mindfulsurf_tick") minuteTick();
});

// When a tab finishes loading, if it's over the limit, force it to blocked page
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.url) return;
  if (changeInfo.status && changeInfo.status !== "complete") return;
  loadState(() => {
    const matched = findMatchedSiteForUrl(tab.url);
    if (matched && (siteUsage[matched] || 0) >= siteLimits[matched]) {
      chrome.tabs.update(tabId, {
        url: chrome.runtime.getURL(`blocked.html?site=${matched}`),
      });
    }
  });
});

// React to changes in site limits from the popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes[LIMITS_KEY] || changes[WHITELIST_KEY])) {
    loadState(() => enforceBlockingRules(() => {}));
  }
  if (area === "local" && changes[SNOOZES_KEY]) {
    loadState(() => enforceBlockingRules(() => {}));
  }
});
