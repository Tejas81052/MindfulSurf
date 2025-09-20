// MindfulSurf MV3 Background: robust minute tracking + DNR redirect blocking
const DEFAULT_SITES = {
  "youtube.com": 10,
  "instagram.com": 5,
  "snapchat.com": 5,
  "x.com": 5,
  "tiktok.com": 5,
};
const MAX_LIMIT = 30;
const MIN_LIMIT = 1;

// Storage keys (usage in local to avoid sync write quotas)
const USAGE_KEY = "siteUsage";
const LIMITS_KEY = "siteLimits"; // kept in sync to allow device sync of preferences
const LAST_RESET_KEY = "lastResetDay"; // kept in local (per-device reset)
const LAST_TICK_KEY = "lastTickAt"; // local: timestamp of last minute tick
const WHITELIST_KEY = "whitelist"; // in sync (preferences)
const SNOOZES_KEY = "snoozes"; // local: { [domain]: expiresAtMs }
const SNOOZE_USED_KEY = "snoozeUsed"; // local: { [domain]: { day: 'YYYY-MM-DD', used: {5:true,10:true,15:true} } }
const DNR_MIGRATION_KEY = "dnrRuleFormatV1Done"; // local: one-time migration flag

let siteLimits = {};
let siteUsage = {};
let lastResetDay = null;
let whitelist = [];
let snoozes = {};
// Track which domain triggered a redirect for a given tab
const lastBlockedByTab = new Map(); // tabId -> domain

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
      // Include the site in the query so blocked.html can always resolve it
      redirect: { url: chrome.runtime.getURL(`blocked.html?site=${domain}`) },
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
      {
        [USAGE_KEY]: siteUsage,
        [LAST_RESET_KEY]: lastResetDay,
        [SNOOZE_USED_KEY]: {},
      },
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
function getDynamicRules(callback) {
  chrome.declarativeNetRequest.getDynamicRules((rules) => callback(rules));
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

function rulesDiffer(a, b) {
  try {
    // Compare core bits we care about: redirect target and urlFilter
    const ar = a && a.action && a.action.redirect ? a.action.redirect : {};
    const br = b && b.action && b.action.redirect ? b.action.redirect : {};
    const aTarget = ar.url || ar.extensionPath || "";
    const bTarget = br.url || br.extensionPath || "";
    const aFilter = a && a.condition ? a.condition.urlFilter : "";
    const bFilter = b && b.condition ? b.condition.urlFilter : "";
    return aTarget !== bTarget || aFilter !== bFilter;
  } catch (e) {
    return true;
  }
}

function applyBlockingRules(callback) {
  // Determine which domains must be blocked based on usage >= limit
  const shouldBlock = Object.keys(siteLimits).filter((domain) => {
    if (isWhitelistedDomain(domain)) return false;
    if (isSnoozed(domain)) return false;
    return (siteUsage[domain] || 0) >= siteLimits[domain];
  });

  getDynamicRules((existingRules) => {
    const existingById = new Map(existingRules.map((r) => [r.id, r]));
    const desiredRules = shouldBlock.map((d) => buildRedirectRule(d));
    const desiredIds = new Set(desiredRules.map((r) => r.id));

    const removeRuleIdsSet = new Set();
    const addRulesMap = new Map(); // id -> rule (dedupe by id)

    // Remove any existing rule that's not desired anymore
    for (const r of existingRules) {
      if (!desiredIds.has(r.id)) removeRuleIdsSet.add(r.id);
    }
    // For each desired rule, add if missing or if differs
    for (const dr of desiredRules) {
      const ex = existingById.get(dr.id);
      if (!ex || rulesDiffer(ex, dr)) {
        if (ex) removeRuleIdsSet.add(dr.id);
        addRulesMap.set(dr.id, dr);
      }
    }

    const removeRuleIds = Array.from(removeRuleIdsSet);
    const addRules = Array.from(addRulesMap.values());

    if (removeRuleIds.length === 0 && addRules.length === 0) {
      return callback && callback();
    }

    chrome.declarativeNetRequest.updateDynamicRules(
      { removeRuleIds, addRules },
      () => callback && callback()
    );
  });
}

// Serialize updates to avoid concurrent add collisions (duplicate rule IDs)
let enforcing = false;
let pendingCallbacks = [];
function enforceBlockingRules(cb) {
  if (cb) pendingCallbacks.push(cb);
  if (enforcing) {
    return; // A run is in progress; callbacks will be flushed after it completes
  }
  enforcing = true;
  applyBlockingRules(() => {
    enforcing = false;
    // Flush callbacks gathered during the run
    const cbs = pendingCallbacks.splice(0);
    for (const f of cbs) {
      try {
        f();
      } catch (e) {
        // ignore
      }
    }
    // If more callbacks got queued while flushing, schedule another pass
    if (pendingCallbacks.length > 0) {
      enforceBlockingRules();
    }
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
  // Record the last tick timestamp for second-level countdowns in content
  chrome.storage.local.set({ [LAST_TICK_KEY]: Date.now() });
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

// One-time migration: purge and rebuild DNR rules so redirect uses ?site=...
function maybeMigrateRules() {
  try {
    chrome.storage.local.get([DNR_MIGRATION_KEY], (data) => {
      if (data && data[DNR_MIGRATION_KEY]) return; // already done
      clearAllBlockingRules(() => {
        // Rebuild desired rules based on current state
        loadState(() =>
          enforceBlockingRules(() => {
            chrome.storage.local.set({ [DNR_MIGRATION_KEY]: true }, () => {});
          })
        );
      });
    });
  } catch (e) {
    // ignore
  }
}
// Run migration at worker start
maybeMigrateRules();

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

// Allow pages (e.g., blocked.html) to request an immediate enforcement run
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "ms_enforce") {
    loadState(() => enforceBlockingRules(() => sendResponse(true)));
    return true; // keep the channel open for async sendResponse
  }
  if (message && message.type === "ms_getBlockedDomain") {
    const tabId = message.tabId;
    sendResponse(lastBlockedByTab.get(tabId) || null);
    return true;
  }
  if (message && message.type === "ms_getSnoozeAvailability") {
    const today = getDayString();
    const domain = message.domain;
    chrome.storage.local.get([SNOOZE_USED_KEY], (data) => {
      const all = data[SNOOZE_USED_KEY] || {};
      const rec = all[domain] || { day: today, used: {} };
      if (rec.day !== today) {
        return sendResponse({ 5: true, 10: true, 15: true });
      }
      sendResponse({ 5: !rec.used[5], 10: !rec.used[10], 15: !rec.used[15] });
    });
    return true;
  }
  if (message && message.type === "ms_markSnoozeUsed") {
    const domain = message.domain;
    const mins = message.minutes;
    const today = getDayString();
    chrome.storage.local.get([SNOOZE_USED_KEY], (data) => {
      const all = data[SNOOZE_USED_KEY] || {};
      const rec =
        all[domain] && all[domain].day === today
          ? all[domain]
          : { day: today, used: {} };
      rec.used = rec.used || {};
      rec.used[mins] = true;
      const next = { ...all, [domain]: rec };
      chrome.storage.local.set({ [SNOOZE_USED_KEY]: next }, () =>
        sendResponse(true)
      );
    });
    return true;
  }
  if (message && message.type === "ms_getSnoozeAvailableSimple") {
    const domain = message.domain;
    const today = getDayString();
    chrome.storage.local.get([SNOOZE_USED_KEY], (data) => {
      const all = data[SNOOZE_USED_KEY] || {};
      const rec = all[domain];
      const usedAny = !!(
        rec &&
        rec.day === today &&
        (rec.usedAny ||
          (rec.used && (rec.used[5] || rec.used[10] || rec.used[15])))
      );
      sendResponse({ available: !usedAny });
    });
    return true;
  }
  if (message && message.type === "ms_markSnoozeUsedSimple") {
    const domain = message.domain;
    const today = getDayString();
    chrome.storage.local.get([SNOOZE_USED_KEY], (data) => {
      const all = data[SNOOZE_USED_KEY] || {};
      const rec =
        all[domain] && all[domain].day === today
          ? all[domain]
          : { day: today, used: {} };
      rec.usedAny = true;
      const next = { ...all, [domain]: rec };
      chrome.storage.local.set({ [SNOOZE_USED_KEY]: next }, () =>
        sendResponse(true)
      );
    });
    return true;
  }
  if (message && message.type === "ms_applySnoozeAndUnblock") {
    const { domain, minutes } = message;
    const durationMs = Math.max(1, Number(minutes) || 0) * 60 * 1000;
    const expires = Date.now() + durationMs;
    const today = getDayString();
    // Load state, update snooze and usedAny, then enforce rules
    loadState(() => {
      // Update in-memory snoozes
      snoozes = { ...(snoozes || {}), [domain]: expires };
      chrome.storage.local.get([SNOOZE_USED_KEY], (data) => {
        const all = data[SNOOZE_USED_KEY] || {};
        const rec =
          all[domain] && all[domain].day === today
            ? all[domain]
            : { day: today, used: {} };
        rec.usedAny = true;
        const nextUsed = { ...all, [domain]: rec };
        chrome.storage.local.set(
          { [SNOOZES_KEY]: snoozes, [SNOOZE_USED_KEY]: nextUsed },
          () => {
            enforceBlockingRules(() => sendResponse({ ok: true, expires }));
          }
        );
      });
    });
    return true;
  }
});

// Listen for DNR rule matches to infer which domain triggered our blocked page
if (
  chrome.declarativeNetRequest &&
  chrome.declarativeNetRequest.onRuleMatchedDebug
) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    try {
      const ruleId = info.rule && info.rule.id;
      const tabId = info.tabId;
      if (!ruleId || !Number.isInteger(tabId) || tabId < 0) return;
      // Reconstruct domain by checking which key maps to this rule id
      const domain = Object.keys(siteLimits).find(
        (d) => domainToRuleId(d) === ruleId
      );
      if (domain) {
        lastBlockedByTab.set(tabId, domain);
      }
    } catch (e) {
      // ignore
    }
  });
}
