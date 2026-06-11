// ============================================================
// M|M Law Group - Outlook Time Tracker
// Connects to Lawmatics via OAuth2
// Staff rates: Dan $600, Roby $250, Tiffany $250, Morgan $125, Robin $125
// ============================================================

const CONFIG = {
  CLIENT_ID:     "OZycIYc27e1ojo9IyP0ao7KuSYc5fRfTykCo9l4tj4g",
  CLIENT_SECRET: "a4CN--52ujeA0zIT6QozOrCnInWUmACZskSqaYtkf_Y",
  REDIRECT_URI:  "https://MMLawGroup.github.io/mm-time-tracker/callback.html",
  BASE_URL:      "https://app.lawmatics.com/api/v1"
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
    "?client_id="     + encodeURIComponent(CONFIG.CLIENT_ID) +
    "&redirect_uri="  + encodeURIComponent(CONFIG.REDIRECT_URI) +
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
// LOAD MATTERS
// ============================================================
let allMatters = [];

async function loadMatters() {
  const token = getStoredToken();
  if (!token) {
    document.getElementById("auth-banner").style.display = "block";
    document.getElementById("matter-select").innerHTML =
      '<option value="">-- Sign in to Lawmatics first --</option>';
    return;
  }

  document.getElementById("matter-select").innerHTML =
    '<option value="">-- Loading matters... --</option>';

  try {
    allMatters = [];
    let page   = 1;

    while (true) {
      const resp = await fetch(
        CONFIG.BASE_URL + "/matters?per_page=100&page=" + page,
        { headers: { "Authorization": "Bearer " + token } }
      );
      if (!resp.ok) {
        if (resp.status === 401) {
          setStoredToken(null);
          sessionStorage.removeItem("lm_access_token");
          document.getElementById("auth-banner").style.display = "block";
          document.getElementById("matter-select").innerHTML =
            '<option value="">-- Sign in to Lawmatics first --</option>';
          return;
        }
        break;
      }
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
        const opt         = document.createElement("option");
        opt.value         = m.id;
        opt.textContent   = m.name || m.title || ("Matter #" + m.id);
        opt.dataset.name  = m.name || m.title || "";
        sel.appendChild(opt);
      });

    // After matters load, try to auto-link by sender email
    if (window._senderEmail) {
      autoLinkMatter(window._senderEmail);
    }

  } catch (err) {
    document.getElementById("matter-select").innerHTML =
      '<option value="">-- Error loading matters --</option>';
    console.error("loadMatters error:", err);
  }
}

// ============================================================
// AUTO-LINK MATTER BY EMAIL
// ============================================================
async function autoLinkMatter(email) {
  if (!email) return;
  const token = getStoredToken();
  if (!token) return;

  const matchBadge = document.getElementById("match-badge");
  if (matchBadge) matchBadge.style.display = "none";

  try {
    // Step 1: Search Lawmatics contacts by email address
    const contactResp = await fetch(
      CONFIG.BASE_URL + "/contacts?email=" + encodeURIComponent(email),
      { headers: { "Authorization": "Bearer " + token } }
    );
    if (!contactResp.ok) return;

    const contactData    = await contactResp.json();
    const contacts       = contactData.data || contactData.contacts || (Array.isArray(contactData) ? contactData : []);
    if (!contacts.length) return;

    // Use first matching contact
    const contact        = contacts[0];
    const contactId      = contact.id;
    const contactName    = contact.name || contact.first_name + " " + (contact.last_name || "");

    // Step 2: Find matters linked to this contact
    const matterResp = await fetch(
      CONFIG.BASE_URL + "/matters?contact_id=" + contactId,
      { headers: { "Authorization": "Bearer " + token } }
    );
    if (!matterResp.ok) return;

    const matterData     = await matterResp.json();
    const linkedMatters  = matterData.data || matterData.matters || (Array.isArray(matterData) ? matterData : []);
    if (!linkedMatters.length) return;

    // Pick the most recent open matter (or first if none open)
    const openMatters    = linkedMatters.filter(m => m.status === "open" || m.status === "active" || !m.status);
    const bestMatch      = openMatters.length ? openMatters[openMatters.length - 1] : linkedMatters[linkedMatters.length - 1];

    // Step 3: Select it in the dropdown
    const sel            = document.getElementById("matter-select");
    let found            = false;
    for (let i = 0; i < sel.options.length; i++) {
      if (String(sel.options[i].value) === String(bestMatch.id)) {
        sel.selectedIndex = i;
        found             = true;
        break;
      }
    }

    if (!found) return;

    checkReady();

    // Step 4: Show a match badge
    if (matchBadge) {
      const matterName   = bestMatch.name || bestMatch.title || ("Matter #" + bestMatch.id);
      matchBadge.textContent = "Auto-linked: " + matterName + " (" + contactName.trim() + ")";
      matchBadge.style.display = "block";
    }

  } catch(e) {
    console.warn("autoLinkMatter error:", e);
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

  const seconds  = getTotalSeconds();
  if (seconds < 1) { showStatus("Timer is at zero.", "error"); return; }

  const sel      = document.getElementById("attorney-select");
  const rate     = parseFloat(sel.options[sel.selectedIndex].getAttribute("data-rate"));
  const attorney = sel.options[sel.selectedIndex].text.replace(/ ($.*)/, "");
  const hours    = seconds / 3600;
  const amount   = (hours * rate).toFixed(2);
  const note     = document.getElementById("note-input").value.trim() ||
                   "Email time entry";

  const btn      = document.getElementById("btn-log");
  btn.disabled   = true;
  btn.textContent = "Logging...";

  try {
    const resp = await fetch(CONFIG.BASE_URL + "/time_entries", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify({
        time_entry: {
          matter_id:    matterId,
          duration:     seconds,
          note:         note,
          rate:         rate,
          amount:       amount,
          staff_member: attorney
        }
      })
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
  const el           = document.getElementById("status-msg");
  el.textContent     = msg;
  el.className       = type;
  el.style.display   = "block";
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

    try {
      const item = Office.context.mailbox.item;
      if (item) {
        // Pre-fill description with email subject
        if (item.subject) {
          item.subject.getAsync(function(result) {
            if (result.status === Office.AsyncResultStatus.Succeeded) {
              document.getElementById("note-input").value =
                "Email re: " + result.value;
            }
          });
        }

        // Read sender email for auto-linking
        // item.from is available in read mode; item.to[0] as fallback
        if (item.from) {
          item.from.getAsync(function(result) {
            if (result.status === Office.AsyncResultStatus.Succeeded && result.value) {
              const senderEmail = result.value.emailAddress;
              window._senderEmail = senderEmail;
              // If matters are already loaded, auto-link now
              if (allMatters.length > 0) {
                autoLinkMatter(senderEmail);
              }
              // Otherwise loadMatters() will call autoLinkMatter when done
            }
          });
        }
      }
    } catch(e) { /* compose mode may not have subject/from */ }
  }
});
