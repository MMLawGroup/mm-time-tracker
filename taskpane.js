// ============================================================
// M|M Law Group - Outlook Time Tracker
// Connects to Lawmatics via OAuth2
// Staff rates: Dan $600, Roby $250, Tiffany $250, Morgan $125, Robin $125
// ============================================================

const CONFIG = {
  CLIENT_ID:    "OZycIYc27e1ojo9IyP0ao7KuSYc5fRfTykCo9l4tj4g",
  CLIENT_SECRET:"a4CN--52ujeA0zIT6QozOrCnInWUmACZskSqaYtkf_Y",
  REDIRECT_URI: "https://MMLawGroup.github.io/mm-time-tracker/callback.html",
  BASE_URL:     "https://app.lawmatics.com/api/v1"
};

// ============================================================
// TIMER STATE
// ============================================================
let startTime   = null;
let elapsed     = 0;
let timerHandle = null;
let paused      = false;

function startTimer() {
  startTime   = Date.now();
  paused      = false;
  timerHandle = setInterval(updateDisplay, 1000);
  setLabel("Tracking time...");
  document.getElementById("btn-pause").textContent = "Pause";
}

function updateDisplay() {
  const total = elapsed + (Date.now() - startTime);
  document.getElementById("timer-display").textContent = msToHms(total);
}

function msToHms(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return pad(h) + ":" + pad(m) + ":" + pad(s);
}

function pad(n) { return String(n).padStart(2, "0"); }
function setLabel(t) { document.getElementById("timer-label").textContent = t; }

function togglePause() {
  if (paused) {
    startTime   = Date.now();
    timerHandle = setInterval(updateDisplay, 1000);
    paused      = false;
    setLabel("Tracking time...");
    document.getElementById("btn-pause").textContent = "Pause";
  } else {
    elapsed += Date.now() - startTime;
    clearInterval(timerHandle);
    paused = true;
    setLabel("Paused");
    document.getElementById("btn-pause").textContent = "Resume";
  }
}

function resetTimer() {
  clearInterval(timerHandle);
  elapsed   = 0;
  startTime = null;
  paused    = false;
  document.getElementById("timer-display").textContent = "00:00:00";
  document.getElementById("btn-pause").textContent     = "Pause";
  setLabel("Timer reset");
  startTimer();
}

function getTotalSeconds() {
  const total = elapsed + (paused ? 0 : (Date.now() - startTime));
  return Math.round(total / 1000);
}

// ============================================================
// RATE DISPLAY
// ============================================================
function updateRate() {
  const sel  = document.getElementById("attorney-select");
  const rate = parseFloat(sel.options[sel.selectedIndex].getAttribute("data-rate"));
  document.getElementById("rate-pill").textContent = "$" + rate.toFixed(2) + " / hr";
}

function checkReady() {
  const matter = document.getElementById("matter-select").value;
  document.getElementById("btn-log").disabled = !matter;
}

// ============================================================
// OAUTH AUTHENTICATION
// ============================================================
function getStoredToken() {
  try { return sessionStorage.getItem("lm_access_token"); } catch(e) { return null; }
}
function setStoredToken(t) {
  try { sessionStorage.setItem("lm_access_token", t); } catch(e) {}
}

function startAuth() {
  const authUrl =
    "https://app.lawmatics.com/oauth/authorize" +
    "?client_id="    + encodeURIComponent(CONFIG.CLIENT_ID) +
    "&redirect_uri=" + encodeURIComponent(CONFIG.REDIRECT_URI) +
    "&response_type=token" +
    "&scope=read+write";

  const popup = window.open(authUrl, "LawmaticsAuth", "width=600,height=700");

  const poll = setInterval(() => {
    try {
      if (!popup || popup.closed) { clearInterval(poll); return; }
      const url = popup.location.href;
      if (url && url.includes("access_token=")) {
        clearInterval(poll);
        popup.close();
        const m = url.match(/access_token=([^&]+)/);
        if (m) {
          setStoredToken(decodeURIComponent(m[1]));
          document.getElementById("auth-banner").style.display = "none";
          loadMatters();
        }
      }
    } catch(e) { /* cross-origin polling - keep waiting */ }
  }, 500);
}

// ============================================================
// LOAD MATTERS FROM LAWMATICS
// ============================================================
async function loadMatters() {
  const token = getStoredToken();
  if (!token) {
    document.getElementById("auth-banner").style.display = "block";
    document.getElementById("matter-select").innerHTML =
      '<option value="">-- Sign in first --</option>';
    return;
  }

  document.getElementById("matter-select").innerHTML =
    '<option value="">-- Loading... --</option>';

  try {
    let allMatters = [];
    let page = 1;

    while (true) {
      const resp = await fetch(
        CONFIG.BASE_URL + "/matters?per_page=100&page=" + page +
        "&status=active",
        { headers: { "Authorization": "Bearer " + token,
                     "Accept": "application/json" } }
      );

      if (resp.status === 401) {
        setStoredToken(null);
        sessionStorage.removeItem("lm_access_token");
        document.getElementById("auth-banner").style.display = "block";
        document.getElementById("matter-select").innerHTML =
          '<option value="">-- Session expired, sign in again --</option>';
        return;
      }

      if (!resp.ok) throw new Error("HTTP " + resp.status);

      const data  = await resp.json();
      const items = data.data || data.matters || (Array.isArray(data) ? data : []);

      if (!items.length) break;
      allMatters = allMatters.concat(items);
      if (items.length < 100) break;
      page++;
    }

    const sel = document.getElementById("matter-select");
    sel.innerHTML = '<option value="">-- Select a matter --</option>';
    allMatters
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .forEach(m => {
        const opt      = document.createElement("option");
        opt.value      = m.id;
        opt.textContent = m.name || m.title || ("Matter #" + m.id);
        sel.appendChild(opt);
      });

  } catch (err) {
    document.getElementById("matter-select").innerHTML =
      '<option value="">-- Error loading matters --</option>';
    console.error("loadMatters error:", err);
  }
}

// ============================================================
// LOG TIME ENTRY TO LAWMATICS
// ============================================================
async function logTime() {
  const token = getStoredToken();
  if (!token) { startAuth(); return; }

  const matterId = document.getElementById("matter-select").value;
  if (!matterId) { showStatus("Please select a matter.", "error"); return; }

  const seconds = getTotalSeconds();
  if (seconds < 5) { showStatus("Timer too short. Did you forget to start it?", "error"); return; }

  const sel      = document.getElementById("attorney-select");
  const attorney = sel.value;
  const rate     = parseFloat(sel.options[sel.selectedIndex].getAttribute("data-rate"));
  const hours    = seconds / 3600;
  const amount   = (hours * rate).toFixed(2);
  const note     = document.getElementById("note-input").value.trim() ||
                   "Email time tracked via Outlook";

  const btn = document.getElementById("btn-log");
  btn.disabled    = true;
  btn.textContent = "Logging...";

  try {
    const body = {
      time_entry: {
        matter_id:   parseInt(matterId, 10),
        date:        new Date().toISOString().split("T")[0],
        hours:       parseFloat(hours.toFixed(4)),
        rate:        rate,
        amount:      parseFloat(amount),
        description: note,
        billed_by:   attorney,
        billable:    true
      }
    };

    const resp = await fetch(CONFIG.BASE_URL + "/time_entries", {
      method:  "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type":  "application/json",
        "Accept":        "application/json"
      },
      body: JSON.stringify(body)
    });

    if (resp.ok) {
      showStatus(
        "Logged " + hours.toFixed(2) + " hrs @ $" + rate + "/hr = $" + amount +
        " (" + attorney + ")",
        "success"
      );
      resetTimer();
      document.getElementById("note-input").value = "";
    } else if (resp.status === 401) {
      setStoredToken(null);
      sessionStorage.removeItem("lm_access_token");
      showStatus("Session expired. Please sign in again.", "error");
      document.getElementById("auth-banner").style.display = "block";
    } else {
      const err = await resp.json().catch(() => ({}));
      showStatus("Error: " + (err.message || JSON.stringify(err)), "error");
    }

  } catch (e) {
    showStatus("Network error: " + e.message, "error");
  }

  btn.disabled    = false;
  btn.textContent = "Log Time to Lawmatics";
  checkReady();
}

// ============================================================
// HELPERS
// ============================================================
function showStatus(msg, type) {
  const el = document.getElementById("status-msg");
  el.textContent   = msg;
  el.className     = type;
  el.style.display = "block";
  if (type === "success") {
    setTimeout(() => { el.style.display = "none"; }, 6000);
  }
}

// ============================================================
// OFFICE INIT
// ============================================================
Office.onReady(function(info) {
  if (info.host === Office.HostType.Outlook) {
    startTimer();
    loadMatters();

    // Pre-fill description with email subject
    try {
      const item = Office.context.mailbox.item;
      if (item && item.subject) {
        item.subject.getAsync(function(result) {
          if (result.status === Office.AsyncResultStatus.Succeeded) {
            document.getElementById("note-input").value =
              "Email: " + result.value;
          }
        });
      }
    } catch(e) { /* compose mode may not have subject */ }
  }
});
