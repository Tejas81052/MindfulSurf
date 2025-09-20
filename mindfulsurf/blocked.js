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
  try {
    chrome.runtime.sendMessage(
      { type: "ms_applySnoozeAndUnblock", domain, minutes },
      () => {
        // small delay to allow rules to update across processes
        setTimeout(() => {
          if (document.referrer) {
            window.location.replace(document.referrer);
          } else if (domain) {
            window.location.replace(`https://${domain}/`);
          } else {
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
        }, 250);
      }
    );
  } catch (e) {
    // Fallback: navigate anyway
    if (document.referrer) {
      window.location.replace(document.referrer);
    } else if (domain) {
      window.location.replace(`https://${domain}/`);
    } else {
      window.close();
    }
  }
}

document.addEventListener("DOMContentLoaded", function () {
  let site = determineBlockedSite();
  const siteDisplay = document.getElementById("siteDisplay");
  if (site && siteDisplay) siteDisplay.textContent = site;

  const snoozeGroup = document.getElementById("snooze-group");
  const snoozeOnce = document.getElementById("snooze-once-btn");
  const restMsg = document.getElementById("rest-message");
  // Helper to resolve site dynamically if not yet known
  function resolveSite(cb) {
    if (site) return cb(site);
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab) return cb(null);
        chrome.runtime.sendMessage(
          { type: "ms_getBlockedDomain", tabId: tab.id },
          (resp) => {
            if (resp) {
              site = resp;
              if (siteDisplay) siteDisplay.textContent = site;
            }
            cb(site || null);
          }
        );
      });
    } catch (e) {
      cb(null);
    }
  }

  if (snoozeOnce) {
    snoozeOnce.addEventListener("click", () => {
      resolveSite((s) => {
        if (s) setSnooze(s, 5);
      });
    });
  }

  // If we couldn't detect site yet, ask background for the domain associated with this tab
  if (!site) {
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab) return;
        chrome.runtime.sendMessage(
          { type: "ms_getBlockedDomain", tabId: tab.id },
          (resp) => {
            if (resp) {
              site = resp;
              if (siteDisplay) siteDisplay.textContent = site;
            }
          }
        );
      });
    } catch (e) {
      // ignore
    }
  }

  // Disable snooze buttons that have already been used today for this domain
  function applySimpleAvailability(avail) {
    if (!snoozeGroup || !restMsg) return;
    if (!avail || !avail.available) {
      snoozeGroup.style.display = "none";
      restMsg.style.display = "block";
    } else {
      snoozeGroup.style.display = "flex";
      restMsg.style.display = "none";
    }
  }
  function refreshSimpleAvailability() {
    if (!chrome || !chrome.runtime) return;
    const ask = (domain) => {
      chrome.runtime.sendMessage(
        { type: "ms_getSnoozeAvailableSimple", domain },
        (resp) => applySimpleAvailability(resp)
      );
    };
    if (site) ask(site);
    else resolveSite((s) => s && ask(s));
  }
  refreshSimpleAvailability();

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
