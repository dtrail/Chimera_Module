<script>
  import { onMount } from "svelte";
  import { readFile, runCommand } from "./lib/api";

  // State Variables
  let activeProfile = $state([]);
  let inactiveProfile = $state([]);
  let kernelStats = $state([]);
  let totalBlocked = $state(0);
  let customWakelock = $state("");
  let rawConfigText = $state("");
  let sortBy = $state("total"); // 'total', 'blocked', 'name'

  const blocklistPath = "/data/adb/chimera/blocklist.conf";
  const statsPath = "/sys/kernel/chimera_doom/stats";

  // Replicates our reliable regex split logic
  function parseLines(rawString) {
    if (!rawString) return [];
    return rawString
      .replace(/\\r\\n/g, "\n")
      .replace(/\\r/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\\\n/g, "\n")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(
        (l) => l.length > 2 && !l.startsWith("# ---") && !l.startsWith("# =="),
      );
  }

  async function loadAll() {
    console.log("Loading WebUI data...");
    try {
      const rawConf = await readFile(blocklistPath);
      const rawStats = await readFile(statsPath);

      rawConfigText = rawConf;
      const confLines = parseLines(rawConf);

      // Build Profiles
      let tempActive = [];
      let tempInactive = [];
      let tempStats = [];
      let tempTotal = 0;

      confLines.forEach((line) => {
        if (line.includes("gääähhhnnn")) return;

        const isActive = !line.startsWith("#");
        const name = isActive ? line : line.substring(1).trim();

        // Strict Wakelock Name Validation
        // Ignore lines that are comments/sentences (have spaces) or empty
        if (!name || name.includes(" ") || name.length < 3) return;

        if (isActive) tempActive.push(name);
        else tempInactive.push(name);
      });

      // Parse Kernel Stats
      if (rawStats && !rawStats.includes("No such file")) {
        const statLines = parseLines(rawStats);
        statLines.forEach((line) => {
          let cleanLine = line;
          if (cleanLine.startsWith("|")) cleanLine = cleanLine.substring(1);
          if (cleanLine.endsWith("|"))
            cleanLine = cleanLine.substring(0, cleanLine.length - 1);

          if (
            cleanLine.includes("|") &&
            !cleanLine.toLowerCase().includes("name") &&
            !cleanLine.includes(":---")
          ) {
            const parts = cleanLine.split("|").map((x) => x.trim());
            if (parts.length >= 3 && parts[0]) {
              const name = parts[0];
              const blocked = parseInt(parts[1].replace(/\*/g, "")) || 0;
              const allowed = parseInt(parts[2]) || 0;
              tempTotal += blocked;
              tempStats.push({
                name,
                blocked,
                allowed,
                total: blocked + allowed,
              });
            }
          }
        });
      }

      // Merge inactive blocklist items into stat view for control
      confLines.forEach((line) => {
        const rawName = line.startsWith("#") ? line.substring(1).trim() : line;
        if (
          rawName &&
          !tempStats.some((s) => s.name.toLowerCase() === rawName.toLowerCase())
        ) {
          tempStats.push({ name: rawName, blocked: 0, allowed: 0, total: 0 });
        }
      });

      // Only sort once locally so reactive derived sorting can handle the rest
      tempStats.sort((a, b) => b.total - a.total);

      // Update reactivity
      activeProfile = tempActive;
      inactiveProfile = tempInactive;
      kernelStats = tempStats;
      totalBlocked = tempTotal;
    } catch (e) {
      console.error("Error loading data:", e);
    }
  }

  // Derived reactive sorting
  let sortedStats = $derived(
    [...kernelStats].sort((a, b) => {
      if (sortBy === "blocked") return b.blocked - a.blocked;
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return b.total - a.total; // default 'total'
    }),
  );

  async function toggleWL(name, block) {
    const escapedName = name.replace(/"/g, '\\"');
    const boolStr = block ? "true" : "false";

    // Extremely safe standard shell toggler to avoid KSU missing bins
    const cmd = `
            FILE="${blocklistPath}"
            NAME="${escapedName}"
            if grep -q -i "\\(^#* *\\b$NAME\\b\\)" "$FILE"; then
                if [ "${boolStr}" = "true" ]; then
                    sed -i "s/^#* *\\b$NAME\\b/$NAME/I" "$FILE"
                else
                    sed -i "s/^#* *\\b$NAME\\b/# $NAME/I" "$FILE"
                fi
            else
                if ! grep -q "^# --- User Added ---$" "$FILE"; then
                    echo "" >> "$FILE"
                    echo "# --- User Added ---" >> "$FILE"
                fi
                if [ "${boolStr}" = "true" ]; then
                    echo "$NAME" >> "$FILE"
                else
                    echo "# $NAME" >> "$FILE"
                fi
            fi
            pkill -HUP -f chimera_controller.sh
        `;

    await runCommand(cmd);
    await loadAll();
  }

  async function deleteWL(name) {
    const cmd = `sed -i "/^#* *${name}$/d" "${blocklistPath}" ; sed -i "/^#* *${name.toLowerCase()}$/d" "${blocklistPath}" ; pkill -HUP -f chimera_controller.sh`;
    await runCommand(cmd);
    await loadAll();
  }

  async function toggleChimera(on) {
    await runCommand(`setprop persist.chimera.enable ${on ? 1 : 0}`);
    alert(on ? "Chimera ARMED! 🐉" : "Chimera DISARMED! 💤");
  }

  async function addCustom() {
    const name = customWakelock.trim();
    if (name.length > 2) {
      await toggleWL(name, true);
      customWakelock = "";
    }
  }

  onMount(() => {
    loadAll();
  });

  function isBlockedCheck(name) {
    const cleanName = name.toLowerCase();
    return activeProfile.some((rule) => {
      const cleanRule = rule.toLowerCase();
      if (cleanRule === cleanName) return true;
      if (cleanRule.endsWith("*")) {
        const prefix = cleanRule.slice(0, -1);
        if (cleanName.startsWith(prefix)) return true;
      }
      return false;
    });
  }
</script>

<main
  class="w-full max-w-md mx-auto p-4 bg-[#121212] text-[#e0e0e0] min-h-screen font-sans"
>
  <!-- Leaner Header -->
  <header
    class="flex items-center justify-between mb-6 pb-4 border-b border-[#333]"
  >
    <div>
      <h1
        class="text-xl font-black text-red-500 tracking-wider m-0 leading-tight"
      >
        CHIMERA
      </h1>
      <h2 class="text-[10px] text-neutral-500 uppercase tracking-widest mt-1">
        Doom Sleep Controller
      </h2>
    </div>
    <button
      onclick={loadAll}
      class="text-neutral-400 hover:text-white bg-[#1e1e1e] border border-[#333] p-2 rounded-lg transition cursor-pointer"
    >
      ↻
    </button>
  </header>

  <!-- Dashboard Cards -->
  <div class="grid grid-cols-2 gap-3 mb-4">
    <div
      class="bg-[#1e1e1e] border border-[#333] rounded-xl p-4 text-center shadow-md"
    >
      <div class="text-3xl font-black text-red-500">{totalBlocked}</div>
      <div
        class="text-[10px] text-neutral-500 mt-1 uppercase tracking-wider font-bold"
      >
        Blocked
      </div>
    </div>
    <div
      class="bg-[#1e1e1e] border border-[#333] rounded-xl p-4 text-center shadow-md"
    >
      <div class="text-3xl font-black text-green-500">
        {activeProfile.length}<span class="text-sm text-neutral-600"
          >/{inactiveProfile.length}</span
        >
      </div>
      <div
        class="text-[10px] text-neutral-500 mt-1 uppercase tracking-wider font-bold"
      >
        Rules
      </div>
    </div>
  </div>

  <!-- Master Controls Card -->
  <div class="bg-[#1e1e1e] border border-[#333] rounded-xl p-4 mb-4 shadow-md">
    <h3 class="text-sm font-bold mb-3 text-neutral-300 uppercase tracking-wide">
      Master Switch
    </h3>
    <div class="flex gap-2">
      <button
        onclick={() => toggleChimera(true)}
        class="flex-1 bg-red-600/90 hover:bg-red-500 text-white text-sm font-bold py-2 rounded-lg transition-colors cursor-pointer border border-red-700"
      >
        Enable
      </button>
      <button
        onclick={() => toggleChimera(false)}
        class="flex-1 bg-[#2a2a2a] hover:bg-[#333] text-neutral-300 text-sm font-bold py-2 rounded-lg transition-colors border border-[#444] cursor-pointer"
      >
        Disable
      </button>
    </div>
  </div>

  <!-- Active Profile Raw Card -->
  <div class="bg-[#1e1e1e] border border-[#333] rounded-xl p-4 mb-4 shadow-md">
    <div class="flex justify-between items-center mb-3">
      <h3 class="text-sm font-bold text-neutral-300 uppercase tracking-wide">
        Configuration
      </h3>
      <button
        onclick={() => window.open("file:///data/adb/chimera/blocklist.conf")}
        class="text-[10px] uppercase font-bold bg-[#2a2a2a] border border-[#444] px-2 py-1 rounded text-blue-400 hover:bg-[#333] transition cursor-pointer"
      >
        Edit
      </button>
    </div>

    <div
      class="bg-[#121212] border border-[#222] rounded-lg p-3 max-h-48 overflow-y-auto w-full"
    >
      {#if !rawConfigText}
        <p class="text-neutral-600 text-[10px] italic m-0">
          Loading blocklist.conf...
        </p>
      {:else}
        <pre
          class="text-[11px] text-neutral-400 font-mono whitespace-pre-wrap break-all leading-normal m-0">{rawConfigText}</pre>
      {/if}
    </div>
  </div>

  <!-- Live Analytics Card -->
  <div class="bg-[#1e1e1e] border border-[#333] rounded-xl p-4 mb-4 shadow-md">
    <div class="flex flex-col gap-3 mb-4">
      <h3 class="text-sm font-bold text-neutral-300 uppercase tracking-wide">
        Live Analytics
      </h3>

      <!-- Filter Controls -->
      <div
        class="flex bg-[#121212] rounded-lg p-1 border border-[#222] text-[10px] font-bold uppercase w-full"
      >
        <button
          onclick={() => (sortBy = "total")}
          class={`flex-1 py-1.5 rounded transition ${sortBy === "total" ? "bg-[#333] text-white" : "text-neutral-500"}`}
          >Fires</button
        >
        <button
          onclick={() => (sortBy = "blocked")}
          class={`flex-1 py-1.5 rounded transition ${sortBy === "blocked" ? "bg-[#333] text-white" : "text-neutral-500"}`}
          >Blocked</button
        >
        <button
          onclick={() => (sortBy = "name")}
          class={`flex-1 py-1.5 rounded transition ${sortBy === "name" ? "bg-[#333] text-white" : "text-neutral-500"}`}
          >A-Z</button
        >
      </div>
    </div>

    <div class="space-y-2">
      {#if sortedStats.length === 0}
        <p
          class="text-center text-neutral-600 text-[10px] py-4 italic uppercase"
        >
          Awaiting kernel events...
        </p>
      {/if}

      {#each sortedStats as wl}
        {@const isBlocked = isBlockedCheck(wl.name)}
        <div class="bg-[#222] border border-[#333] rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div
              class="font-mono font-bold text-[11px] text-[#e0e0e0] break-all leading-tight pr-2"
            >
              {wl.name}
            </div>
            <div
              class={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest whitespace-nowrap ${isBlocked ? "bg-red-500/20 text-red-500 border border-red-500/30" : "bg-green-500/10 text-green-500/70 border border-green-500/20"}`}
            >
              {isBlocked ? "Blocked" : "Allowed"}
            </div>
          </div>

          <div
            class="flex gap-3 text-[10px] text-neutral-500 font-bold uppercase tracking-wider mb-3"
          >
            <span>Fires: <span class="text-neutral-300">{wl.total}</span></span>
            <span class={wl.blocked > 0 ? "text-red-400" : ""}
              >Blk: <span>{wl.blocked}</span></span
            >
            <span>All: <span class="text-neutral-300">{wl.allowed}</span></span>
          </div>

          <div class="flex gap-2">
            <button
              onclick={() =>
                window.open(
                  `https://www.google.com/search?q=android+wakelock+"${encodeURIComponent(wl.name)}"`,
                  "_blank",
                )}
              class="flex-none bg-[#1a1a1a] border border-[#333] text-neutral-400 rounded px-2 text-[10px] font-bold uppercase hover:bg-[#2a2a2a] transition cursor-pointer"
            >
              Info
            </button>
            <button
              onclick={() => toggleWL(wl.name, !isBlocked)}
              class={`flex-1 rounded py-1 px-2 text-[10px] font-bold uppercase transition cursor-pointer border ${isBlocked ? "bg-green-600/20 text-green-500 border-green-600/30 hover:bg-green-600/30" : "bg-red-600/20 text-red-500 border-red-600/30 hover:bg-red-600/30"}`}
            >
              {isBlocked ? "Allow" : "Block"}
            </button>
            <button
              onclick={() => deleteWL(wl.name)}
              class="flex-none bg-[#1a1a1a] border border-[#333] text-neutral-500 hover:text-red-500 px-2 rounded flex items-center justify-center transition cursor-pointer"
            >
              ✖
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Manual Entry Card -->
  <div class="bg-[#1e1e1e] border border-[#333] rounded-xl p-4 shadow-md">
    <h3 class="text-sm font-bold mb-3 text-neutral-300 uppercase tracking-wide">
      Manual Rule
    </h3>
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={customWakelock}
        placeholder="Wakelock name..."
        class="flex-1 bg-[#121212] border border-[#333] rounded-lg px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-red-500/50 transition m-0"
      />
      <button
        onclick={addCustom}
        class="bg-red-600/90 hover:bg-red-500 text-white text-xs uppercase font-bold px-4 rounded-lg transition cursor-pointer border border-red-700"
      >
        Add
      </button>
    </div>
  </div>
</main>
