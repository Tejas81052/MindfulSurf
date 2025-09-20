function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function extractHostname(input) {
  try {
    const u = new URL(input);
    return u.hostname.replace(/^www\./, "");
  } catch (e) {
    return null;
  }
}

function determineBlockedSite() {
  const fromQuery = getQueryParam("site");
  if (fromQuery) return fromQuery;
  // Fallback to referrer hostname if present
  const ref = document.referrer;
  const host = extractHostname(ref);
  return host || null;
}

function setSnooze(domain, minutes) {
  const durationMs = Math.max(1, minutes) * 60 * 1000;
  const expires = Date.now() + durationMs;
  chrome.storage.local.get(["snoozes"], (data) => {
    const s = data.snoozes || {};
    s[domain] = expires;
    chrome.storage.local.set({ snoozes: s }, () => {
      // Try to return to the previous page if known
      if (document.referrer) {
        window.location.replace(document.referrer);
      } else {
        // Otherwise just close the tab
        try {
          chrome.tabs.query(
            { active: true, lastFocusedWindow: true },
            (tabs) => {
              if (tabs && tabs[0]) {
                chrome.tabs.remove(tabs[0].id);
              } else {
                window.close();
              }
            }
          );
        } catch (e) {
          window.close();
        }
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const site = determineBlockedSite();
  const siteDisplay = document.getElementById("siteDisplay");
  if (site && siteDisplay) siteDisplay.textContent = site;

  const snooze5 = document.getElementById("snooze-5-btn");
  const snooze10 = document.getElementById("snooze-10-btn");
  const snooze15 = document.getElementById("snooze-15-btn");
  const wire = (btn, mins) => {
    if (!btn) return;
    if (site) {
      btn.addEventListener("click", () => setSnooze(site, mins));
    } else {
      btn.disabled = true;
      btn.title = "Could not detect site to snooze";
    }
  };
  wire(snooze5, 5);
  wire(snooze10, 10);
  wire(snooze15, 15);

  const closeBtn = document.getElementById("close-tab-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      // Prefer using chrome.tabs.remove for reliability
      try {
        if (chrome && chrome.tabs && chrome.tabs.query) {
          chrome.tabs.query(
            { active: true, lastFocusedWindow: true },
            (tabs) => {
              if (tabs && tabs[0]) {
                chrome.tabs.remove(tabs[0].id);
              } else {
                window.close();
              }
            }
          );
        } else {
          window.close();
        }
      } catch (e) {
        window.close();
      }
    });
  }

  const openOptions = document.getElementById("open-options-btn");
  if (openOptions) {
    openOptions.addEventListener("click", () => {
      if (chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL("options.html"), "_blank");
      }
    });
  }
});
