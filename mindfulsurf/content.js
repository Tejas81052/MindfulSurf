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

let reminderTimer = setInterval(() => {
  if (document.visibilityState === "visible") {
    showBreakReminder();
  }
}, 30 * 60 * 1000); // 30 minutes

// Some sites disallow the 'unload' event via Permissions-Policy.
// Use pagehide/visibilitychange instead to avoid policy violations.
window.addEventListener("pagehide", () => {
  if (reminderTimer) clearInterval(reminderTimer);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" && reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
});
