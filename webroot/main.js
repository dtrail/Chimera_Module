// --- ON-SCREEN DEBUGGER & MAGISK/MMRL ROOT BRIDGE ---

function debugLog(msg) {
  const list = document.getElementById("wakelock-list");

  if (list) {
    list.innerHTML += `<p style="color: yellow; font-size: 11px; text-align: left; font-family: monospace; margin: 2px 0;">> ${msg}</p>`;
  }
}

async function run(cmd) {
  try {
    const parseRes = (res) => {
      let p = res;
      // WebUI X gibt oft JSON-Strings zurück (z.B. "{\"errno\":0,\"stdout\":\"...\",\"stderr\":\"\"}")
      if (typeof res === "string") {
        try { p = JSON.parse(res); } catch(e) {}
      }
      if (p !== null && typeof p === "object") {
        if (p.stdout !== undefined) return p.stdout;
        if (p.stderr !== undefined) return p.stderr;
      }
      return typeof p === "string" ? p : String(p);
    };

    // 1. WebUI X Portable / KSU / APatch Bridge
    if (typeof window.ksu !== "undefined" && typeof window.ksu.exec !== "undefined") {
      return parseRes(await window.ksu.exec(cmd));
    }
    
    // 2. Offizielle MMRL WebUI+ Bridge
    if (typeof window.os !== "undefined" && typeof window.os.exec !== "undefined") {
      return parseRes(await window.os.exec(cmd));
    }

    // 3. Alternative MMRL Bridge
    if (typeof window.mmrl !== "undefined" && typeof window.mmrl.exec !== "undefined") {
      return parseRes(await window.mmrl.exec(cmd));
    }

    // fallback für ältere Module
    if (typeof window.su !== "undefined" && typeof window.su.exec !== "undefined") {
       return parseRes(await window.su.exec(cmd));
    }

    throw new Error("Keine Root-Bridge (KSU/MMRL/OS) gefunden!");
  } catch (e) {
    debugLog(`Shell Error: ${e.message}`);

    // Letzter Rettungsanker: Zeige uns, was WebUI X geladen hat (alles mit exec, etc.)
    const available = Object.keys(window).filter(
      (k) => typeof window[k] === "object" && window[k] !== null && typeof window[k].exec === "function"
    );

    debugLog(
      "Gefundene exec APIs im Fenster: " +
        (available.length > 0 ? available.join(", ") : "KEINE")
    );

    return "";
  }
}

async function loadAll() {
  document.getElementById("wakelock-list").innerHTML = "";

  debugLog("Starte Kernel-Abfrage via Root-Bridge...");

  try {
    // Hole Live-Daten direkt aus dem Kernel-Modul um Verzögerungen und Markdown-Bugs zu umgehen!
    const statsPath = "/sys/kernel/chimera_doom/stats";
    const confPath = "/data/adb/chimera/blocklist.conf";

    // Befehle einzeln ausführen für sauberes Fehler-Tracking
    const rawStats = await run(`cat ${statsPath}`);
    const rawConf = await run(`cat ${confPath}`);

    if (!rawStats && !rawConf) return;

    updateProfileView(rawConf);
    updateStatsView(rawStats, rawConf);
  } catch (e) {
    debugLog(`CRASH: ${e.message}`);
  }
}

function updateProfileView(data) {
  let activeCount = 0;
  const container = document.getElementById("blocklist-content");
  container.innerHTML = "";

  const safeData = data ? data.replace(/\\r\\n/g, "\n").replace(/\\r/g, "\n").replace(/\\n/g, "\n") : "";

  if (safeData && !safeData.includes("No such file")) {
    const lines = safeData
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 2 && !l.startsWith("# ---") && !l.startsWith("# =="));

    let hasActive = false;
    lines.forEach((line) => {
      // Entferne komische Escape-Reste aus dem String (KSU gibt oft "\n" LITERAL zurück)
      const cleanLine = line.replace(/\\r/g, '').replace(/\\n/g, '').trim();
      
      if (!cleanLine.startsWith("#") && cleanLine.length > 2 && !cleanLine.includes("gääähhhnnn")) {
        activeCount++;
        hasActive = true;
        const chip = document.createElement("span");
        chip.style.cssText = "display: inline-block; background: var(--red); color: white; padding: 4px 8px; border-radius: 4px; margin: 4px; font-family: monospace; font-size: 0.85rem;";
        chip.innerText = cleanLine; // Use the CLEAN line, not the raw one!
        container.appendChild(chip);
      }
    });

    if (!hasActive) {
      container.innerHTML = '<p style="color: #555;">Keine aktiven Wakelocks im Profil.</p>';
    }
  } else {
    container.innerHTML = '<p style="color: #555;">Konnte blocklist.conf nicht lesen.</p>';
  }

  document.getElementById("stat-active-profile").innerText = activeCount;
}

function updateStatsView(stats, conf) {
  const container = document.getElementById("wakelock-list");

  if (!stats || stats.includes("No such file")) {
    debugLog("Keine Stats gefunden. Ist der Bildschirm mal aus gewesen?");
    return;
  }

  // Pre-Processor: KSU escapte Newlines als echte String-Breaks wandeln, 
  // um den Bug "alles in eine lange Zeile" ein für alle Mal zu killen!
  const safeStats = stats.replace(/\\r\\n/g, "\n").replace(/\\r/g, "\n").replace(/\\n/g, "\n");
  const safeConf = conf ? conf.replace(/\\r\\n/g, "\n").replace(/\\r/g, "\n").replace(/\\n/g, "\n") : "";

  const activeList = safeConf
    .split("\n")
    .map((l) => l.replace(/\\r/g, '').replace(/\\n/g, '').trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.toLowerCase());

  let wakelocks = [];
  let totalBlocked = 0;

  const lines = safeStats.split("\n");

  lines.forEach((line) => {
    let cleanLine = line.trim();
    if (cleanLine.startsWith("|")) cleanLine = cleanLine.substring(1);
    if (cleanLine.endsWith("|")) cleanLine = cleanLine.substring(0, cleanLine.length - 1);

    if (cleanLine.includes("|") && !cleanLine.toLowerCase().includes("name") && !cleanLine.includes(":---")) {
      const p = cleanLine.split("|").map((x) => x.trim());

      // Erwartet wird p = ["WakelockName", "10", "5"] -> sysfs nodes
      if (p.length >= 3 && p[0]) {
        const name = p[0];
        const blocked = parseInt(p[1].replace(/\*/g, "")) || 0;
        const allowed = parseInt(p[2]) || 0;

        totalBlocked += blocked;
        wakelocks.push({ name, blocked, allowed, total: blocked + allowed });
      }
    }
  });

  // HIER DER NEUE TEIL: Lese ALLE anderen Wakelocks aus der blocklist.conf ein, 
  // damit man sie anklicken kann, auch wenn sie aktuell 0 Hits haben!
  const confLines = safeConf.split("\n");
  confLines.forEach((line) => {
    let rawItem = line.replace(/\\r/g, '').replace(/\\n/g, '').trim();
    // Überspringe leere Zeilen und Sektions-Überschriften (# ---)
    if (rawItem.length > 2 && !rawItem.startsWith("# ---") && !rawItem.startsWith("# ==")) {
      // Wenn es durch ein # erlaubt ist, entfernen wir das #, um an den Namen zu kommen
      if (rawItem.startsWith("#")) {
        rawItem = rawItem.substring(1).trim();
      }
      
      if (rawItem.length > 2) {
         // Prüfe, ob dieser Name (z.B. gms_scheduler) schon per sysfs Statistik eingespielt wurde
         const exists = wakelocks.some(wl => wl.name.toLowerCase() === rawItem.toLowerCase());
         if (!exists) {
            // Zeige den Eintrag aus der Blocklist im Dashboard ohne bisherige Hits an
            wakelocks.push({ name: rawItem, blocked: 0, allowed: 0, total: 0 });
         }
      }
    }
  });

  document.getElementById("stat-total-blocked").innerText = totalBlocked;

  wakelocks.sort((a, b) => b.total - a.total);

  container.innerHTML = "";

  if (wakelocks.length === 0) {
    container.innerHTML =
      '<p style="text-align:center; color:#555;">Warte auf Wakelock-Aktivität vom Kernel...</p>';

    return;
  }

  // --- MAGISK/MMRL CARD RENDERER ---

  wakelocks.forEach((wl) => {
    // Advanced Matching Logic (Case-Insensitive & Wildcard Support)
    const isBlocked = activeList.some(rule => {
      const cleanRule = rule.trim().toLowerCase();
      const cleanName = wl.name.toLowerCase();
      
      // Exact match
      if (cleanRule === cleanName) return true;
      
      // Prefix wildcard match (z.B. "wlan_*")
      if (cleanRule.endsWith('*')) {
         const prefix = cleanRule.slice(0, -1); // Entferne das '*'
         if (cleanName.startsWith(prefix)) return true;
      }
      return false;
    });

    const item = document.createElement("div");

    item.style.cssText =
      "background: #111; border: 1px solid #333; border-radius: 12px; padding: 14px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 10px;";

    const blockedColor = wl.blocked > 0 ? "var(--red)" : "#888";

    const statusColor = isBlocked ? "var(--red)" : "var(--green)";

    const statusText = isBlocked ? "BLOCKED" : "ALLOWED";

    item.innerHTML = `

            <div style="display: flex; justify-content: space-between; align-items: center;">

                <div style="font-family: monospace; font-size: 1.05rem; font-weight: bold; color: var(--text);">

                    ${wl.name}

                </div>

                <div style="font-size: 0.75rem; font-weight: bold; padding: 3px 8px; border-radius: 6px; background: #222; color: ${statusColor}; border: 1px solid ${statusColor};">

                    ${statusText}

                </div>

            </div>

            <div style="font-size: 0.8rem; color: #888; display: flex; gap: 15px;">

                <span>Fires: <b style="color:#ccc">${wl.total}</b></span>

                <span style="color: ${blockedColor}">Blocked: <b>${wl.blocked}</b></span>

                <span>Allowed: <b style="color:#ccc">${wl.allowed}</b></span>

            </div>

            <div class="wl-actions" style="display: flex; gap: 8px; margin-top: 5px;"></div>

        `;

    const actionsDiv = item.querySelector(".wl-actions");

    const btnSearch = document.createElement("button");

    btnSearch.style.cssText =
      "background: #222; color: white; border: 1px solid #444; flex: 1; padding: 8px; border-radius: 8px;";

    btnSearch.innerText = "🔍 Info";

    btnSearch.addEventListener("click", () =>
      window.open(
        `https://www.google.com/search?q=android+wakelock+"${encodeURIComponent(wl.name)}"`,
        "_blank",
      ),
    );

    actionsDiv.appendChild(btnSearch);

    const btnToggle = document.createElement("button");

    btnToggle.style.cssText = `background: ${isBlocked ? "var(--green)" : "var(--red)"}; color: ${isBlocked ? "#000" : "#fff"}; border: none; flex: 1; padding: 8px; border-radius: 8px;`;

    btnToggle.innerText = isBlocked ? "Allow" : "Block";

    btnToggle.addEventListener("click", () => toggleWL(wl.name, !isBlocked));

    actionsDiv.appendChild(btnToggle);

    const btnDelete = document.createElement("button");

    btnDelete.style.cssText =
      "background: transparent; color: #888; border: 1px solid #444; width: 40px; padding: 8px; border-radius: 8px;";

    btnDelete.innerText = "✖";

    btnDelete.addEventListener("click", () => deleteWL(wl.name));

    actionsDiv.appendChild(btnDelete);

    container.appendChild(item);
  });
}

async function deleteWL(name) {
  const file = "/data/adb/chimera/blocklist.conf";
  // Safe sed: In-Place deletion (ignores case if supported, otherwise exact match).
  const cmd = `sed -i "/^#* *${name}$/d" "${file}" ; sed -i "/^#* *${name.toLowerCase()}$/d" "${file}" ; pkill -HUP -f chimera_controller.sh`;
  await run(cmd);
  loadAll();
}

async function toggleWL(name, block) {
  const file = "/data/adb/chimera/blocklist.conf";
  
  // Safe sed in-place deletion
  let cmd = `sed -i "/^#* *${name}$/d" "${file}" ; sed -i "/^#* *${name.toLowerCase()}$/d" "${file}" ; `;

  if (block) cmd += `echo "${name}" >> "${file}" ; `;
  else cmd += `echo "# ${name}" >> "${file}" ; `;

  cmd += `pkill -HUP -f chimera_controller.sh`;
  await run(cmd);
  loadAll();
}

async function toggleChimera(on) {
  await run(`setprop persist.chimera.enable ${on}`);

  alert(on ? "Chimera ARMED! 🐉" : "Chimera DISARMED! 💤");
}

async function addCustom() {
  const input = document.getElementById("custom-wl-input");

  const name = input.value.trim();

  if (name.length > 2) {
    await toggleWL(name, true);

    input.value = "";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("btn-enable")
    .addEventListener("click", () => toggleChimera(1));

  document
    .getElementById("btn-disable")
    .addEventListener("click", () => toggleChimera(0));

  document
    .getElementById("btn-refresh")
    .addEventListener("click", () => loadAll());

  document
    .getElementById("btn-add-custom")
    .addEventListener("click", () => addCustom());

  loadAll();
});
