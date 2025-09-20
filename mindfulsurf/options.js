const LIMITS_KEY = "siteLimits";
const USAGE_KEY = "siteUsage";
const WHITELIST_KEY = "whitelist";

function normalizeHostname(hostname) {
  return hostname.replace(/^www\./, "");
}

function extractHostname(input) {
  try {
    const url = new URL(input.startsWith("http") ? input : "https://" + input);
    return normalizeHostname(url.hostname);
  } catch (e) {
    return normalizeHostname(
      input.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0]
    );
  }
}

function isValidDomain(domain) {
  return /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain);
}

function loadWhitelist() {
  chrome.storage.sync.get([WHITELIST_KEY], (data) => {
    const list = data[WHITELIST_KEY] || [];
    const tbody = document.querySelector("#whitelistTable tbody");
    tbody.innerHTML = "";
    for (const domain of list) {
      const tr = document.createElement("tr");
      const tdDomain = document.createElement("td");
      tdDomain.textContent = domain;
      const tdActions = document.createElement("td");
      const btn = document.createElement("button");
      btn.textContent = "Remove";
      btn.onclick = () => {
        const next = list.filter((d) => d !== domain);
        chrome.storage.sync.set({ [WHITELIST_KEY]: next }, loadWhitelist);
      };
      tdActions.appendChild(btn);
      tr.appendChild(tdDomain);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }
  });
}

function loadUsage() {
  chrome.storage.sync.get([LIMITS_KEY], (syncData) => {
    chrome.storage.local.get([USAGE_KEY], (localData) => {
      const limits = { ...(syncData[LIMITS_KEY] || {}) };
      const usage = localData[USAGE_KEY] || {};
      const tbody = document.querySelector("#usageTable tbody");
      const summary = document.getElementById("usageSummary");
      const bars = document.getElementById("usageBars");
      const sites = Object.keys({ ...limits, ...usage }).sort();
      tbody.innerHTML = "";
      bars.innerHTML = "";
      let blockedCount = 0;
      for (const s of sites) {
        const u = usage[s] || 0;
        const l = limits[s] || 0;
        const over = l > 0 && u >= l;
        if (over) blockedCount++;
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${s}</td><td>${u}</td><td>${l || "-"}</td><td>${
          over ? '<span class="pill">Blocked</span>' : ""
        }</td>`;
        tbody.appendChild(tr);

        // Bar chart row
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.alignItems = "center";
        wrapper.style.gap = "8px";
        wrapper.style.margin = "4px 0";
        const label = document.createElement("div");
        label.style.width = "160px";
        label.style.overflow = "hidden";
        label.style.textOverflow = "ellipsis";
        label.style.whiteSpace = "nowrap";
        label.textContent = s;
        const track = document.createElement("div");
        track.style.height = "10px";
        track.style.flex = "1";
        track.style.background = "var(--bar-track)";
        track.style.borderRadius = "999px";
        const fill = document.createElement("div");
        fill.style.height = "100%";
        fill.style.borderRadius = "999px";
        const ratio = l > 0 ? Math.min(1, u / l) : 0;
        fill.style.width = `${ratio * 100}%`;
        fill.style.background = over ? "var(--bar-over)" : "var(--bar-fill)";
        track.appendChild(fill);
        const val = document.createElement("div");
        val.className = "muted";
        val.style.width = "80px";
        val.textContent = l ? `${u}/${l}m` : `${u}m`;
        wrapper.appendChild(label);
        wrapper.appendChild(track);
        wrapper.appendChild(val);
        bars.appendChild(wrapper);
      }
      summary.textContent = sites.length
        ? `Blocked ${blockedCount} / ${sites.length} sites today.`
        : "No usage recorded yet.";
    });
  });
}

function addWhitelistDomain() {
  const raw = document.getElementById("whitelistInput").value.trim();
  const domain = extractHostname(raw);
  if (!domain || !isValidDomain(domain)) {
    alert("Enter a valid domain, e.g. example.com");
    return;
  }
  chrome.storage.sync.get([WHITELIST_KEY], (data) => {
    const list = data[WHITELIST_KEY] || [];
    if (list.includes(domain)) return loadWhitelist();
    list.push(domain);
    chrome.storage.sync.set({ [WHITELIST_KEY]: list }, () => {
      document.getElementById("whitelistInput").value = "";
      loadWhitelist();
    });
  });
}

// Events
document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("addWhitelist")
    .addEventListener("click", addWhitelistDomain);
  loadWhitelist();
  loadUsage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes[WHITELIST_KEY] || changes[LIMITS_KEY])) {
    loadWhitelist();
    loadUsage();
  }
  if (area === "local" && changes[USAGE_KEY]) {
    loadUsage();
  }
});
