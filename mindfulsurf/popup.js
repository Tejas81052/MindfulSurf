const DEFAULT_SITES = {
  "youtube.com": 10,
  "instagram.com": 5,
  "snapchat.com": 5,
  "x.com": 5,
  "tiktok.com": 5,
};
const MAX_LIMIT = 30;
const MIN_LIMIT = 1;

function normalizeHostname(hostname) {
  return hostname.replace(/^www\./, "");
}

function extractHostname(input) {
  try {
    // If input is a full URL, extract hostname
    const url = new URL(input.startsWith("http") ? input : "https://" + input);
    return normalizeHostname(url.hostname);
  } catch (e) {
    // If not a valid URL, treat as domain
    return normalizeHostname(
      input.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0]
    );
  }
}

function isValidDomain(domain) {
  // Basic domain validation: must contain at least one dot and only valid characters
  // e.g. mystmightmayhem.com, google.co.uk
  return /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain);
}

document.getElementById("save").addEventListener("click", () => {
  let rawInput = document.getElementById("site").value.trim();
  let site = extractHostname(rawInput);
  let limit = parseInt(document.getElementById("limit").value);
  if (!site || isNaN(limit)) return;

  // Prevent adding/removing default sites
  if (DEFAULT_SITES[site]) return;

  // Only allow valid domains
  if (!isValidDomain(site)) {
    alert("Please enter a valid website domain (e.g. example.com)");
    return;
  }

  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  if (limit < MIN_LIMIT) limit = MIN_LIMIT;

  chrome.storage.sync.get(["siteLimits"], (data) => {
    let nextLimits = data.siteLimits || {};
    nextLimits[site] = limit;
    chrome.storage.sync.set({ siteLimits: nextLimits }, () => {
      // Clear inputs for better UX
      document.getElementById("site").value = "";
      document.getElementById("limit").value = "";
      loadSites();
    });
  });
});

// Allow Enter key to submit
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const active = document.activeElement && document.activeElement.id;
    if (active === "site" || active === "limit") {
      document.getElementById("save").click();
    }
  }
});

function loadSites() {
  chrome.storage.sync.get(["siteLimits"], (data) => {
    let list = document.getElementById("siteList");
    list.innerHTML = "";
    let siteLimits = { ...DEFAULT_SITES, ...(data.siteLimits || {}) };
    for (let site in siteLimits) {
      let li = document.createElement("li");
      li.textContent = `${site} → ${siteLimits[site]} mins`;
      // Only allow removal for non-default sites
      if (!DEFAULT_SITES[site]) {
        let removeBtn = document.createElement("button");
        removeBtn.textContent = "Remove";
        removeBtn.onclick = () => {
          chrome.storage.sync.get(["siteLimits"], (data) => {
            let nextLimits = data.siteLimits || {};
            delete nextLimits[site];
            chrome.storage.sync.set({ siteLimits: nextLimits }, loadSites);
          });
        };
        li.appendChild(removeBtn);
      }
      // Only allow changing limit for default sites, but not exceeding MAX_LIMIT or below MIN_LIMIT
      if (DEFAULT_SITES[site]) {
        let editBtn = document.createElement("button");
        editBtn.textContent = "Edit";
        editBtn.onclick = () => {
          let newLimit = prompt(
            `Set new limit for ${site} (min ${MIN_LIMIT}, max ${MAX_LIMIT} min):`,
            siteLimits[site]
          );
          newLimit = parseInt(newLimit);
          if (
            !isNaN(newLimit) &&
            newLimit >= MIN_LIMIT &&
            newLimit <= MAX_LIMIT
          ) {
            chrome.storage.sync.get(["siteLimits"], (data) => {
              let siteLimits = data.siteLimits || {};
              siteLimits[site] = newLimit;
              chrome.storage.sync.set({ siteLimits }, loadSites);
            });
          } else {
            alert(
              `Limit must be between ${MIN_LIMIT} and ${MAX_LIMIT} minutes.`
            );
          }
        };
        li.appendChild(editBtn);
      }
      list.appendChild(li);
    }
  });
}

function dailyResetIfNeededPopup() {
  chrome.storage.local.get(["lastResetDay"], (data) => {
    const today = new Date().toISOString().slice(0, 10);
    if (data.lastResetDay !== today) {
      chrome.storage.local.set({ siteUsage: {}, lastResetDay: today });
    }
  });
}

dailyResetIfNeededPopup();
loadSites();
