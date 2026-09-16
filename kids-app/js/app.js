// My Family Hub — Kids App
(() => {
  "use strict";

  const { getSupabaseConfig, setSupabaseConfig, getClient } = window.SupabaseBootstrap;
  const DEVICE_KEY = "fsd:kidsDevice";
  let sb = null;
  let pendingChild = null; // { name, email, emoji } picked on the avatar screen, pre-login
  let pinBuffer = "";

  const state = {
    view: "home", me: null, family: null,
    tasks: [], rewards: [], redemptions: [], quranGoal: null, schoolEvents: [], homework: [], calendarEvents: []
  };

  const CATEGORY_META = {
    FAITH: { label: "Faith", icon: "🕌" },
    LEARNING: { label: "Learning", icon: "📚", tint: "#EAF1FF" },
    RESPONSIBILITY: { label: "Responsibility", icon: "🧹", tint: "#EAFBF2" },
    ACTIVITIES: { label: "Activities", icon: "⚽", tint: "#FFF1E6" }
  };
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const PRAYER_ORDER = [["fajr", "🌅", "Fajr"], ["dhuhr", "☀️", "Dhuhr"], ["asr", "🌤️", "Asr"], ["maghrib", "🌇", "Maghrib"], ["isha", "🌙", "Isha"]];

  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function isoDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
  function escapeHtml(str) { return String(str ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
  function isTaskSatisfied(t) { if (!t.done) return false; if (t.needs_approval) return t.approval_status === "approved"; return true; }
  function showToast(msg, icon = "✨") {
    const t = document.getElementById("toast");
    t.textContent = `${icon} ${msg}`;
    t.classList.add("show");
    clearTimeout(showToast._tm);
    showToast._tm = setTimeout(() => t.classList.remove("show"), 2400);
  }
  function openModal(html) { document.getElementById("modal-content").innerHTML = html; document.getElementById("modal-backdrop").classList.remove("hidden"); }
  function closeModal() { document.getElementById("modal-backdrop").classList.add("hidden"); }
  window.closeModal = closeModal;

  function getDeviceConfig() { try { return JSON.parse(localStorage.getItem(DEVICE_KEY)); } catch (e) { return null; } }
  function setDeviceConfig(cfg) { localStorage.setItem(DEVICE_KEY, JSON.stringify(cfg)); }

  // A little celebratory burst for non-religious tasks — prayers & Qur'an
  // stay calm and check-mark based on purpose (see calm-row styling).
  function burst() {
    const layer = document.getElementById("burst");
    const emojis = ["🎉", "⭐", "✨", "🌈", "🥳"];
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    for (let i = 0; i < 16; i++) {
      const span = document.createElement("span");
      span.className = "burst-piece";
      span.textContent = emojis[i % emojis.length];
      const angle = (Math.PI * 2 * i) / 16;
      const dist = 120 + Math.random() * 80;
      span.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      span.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      span.style.left = `${cx}px`; span.style.top = `${cy}px`;
      layer.appendChild(span);
      setTimeout(() => span.remove(), 950);
    }
  }

  // ---------------------------------------------------------------
  // BOOT
  // ---------------------------------------------------------------
  async function boot() {
    const sbCfg = getSupabaseConfig();
    const device = getDeviceConfig();
    if (!sbCfg || !device) { showSetupScreen(sbCfg, device); return; }
    sb = getClient();
    const { data } = await sb.auth.getSession();
    if (data.session) { const ok = await loadApp(); if (!ok) showPickerScreen(); }
    else showPickerScreen();
  }

  function showSetupScreen(sbCfg, device) {
    document.getElementById("setup-screen").classList.remove("hidden");
    if (sbCfg) { document.getElementById("su-url").value = sbCfg.url; document.getElementById("su-key").value = sbCfg.anonKey; }
    if (device) {
      document.getElementById("su-c1-name").value = device[0]?.name || "Adhaa";
      document.getElementById("su-c1-email").value = device[0]?.email || "";
      document.getElementById("su-c1-emoji").value = device[0]?.emoji || "👧";
      document.getElementById("su-c2-name").value = device[1]?.name || "Aleef";
      document.getElementById("su-c2-email").value = device[1]?.email || "";
      document.getElementById("su-c2-emoji").value = device[1]?.emoji || "👦";
    }
    document.getElementById("setup-save-btn").addEventListener("click", () => {
      const url = document.getElementById("su-url").value.trim();
      const key = document.getElementById("su-key").value.trim();
      const c1email = document.getElementById("su-c1-email").value.trim();
      const c2email = document.getElementById("su-c2-email").value.trim();
      const errEl = document.getElementById("setup-error");
      if (!url || !key || !c1email || !c2email) { errEl.innerHTML = `<div class="auth-error">Please fill in every field.</div>`; return; }
      setSupabaseConfig(url, key);
      setDeviceConfig([
        { name: document.getElementById("su-c1-name").value.trim() || "Adhaa", email: c1email, emoji: document.getElementById("su-c1-emoji").value.trim() || "👧" },
        { name: document.getElementById("su-c2-name").value.trim() || "Aleef", email: c2email, emoji: document.getElementById("su-c2-emoji").value.trim() || "👦" }
      ]);
      sb = getClient();
      document.getElementById("setup-screen").classList.add("hidden");
      showPickerScreen();
    });
  }

  function showPickerScreen() {
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("pin-screen").classList.add("hidden");
    document.getElementById("picker-screen").classList.remove("hidden");
    const device = getDeviceConfig() || [];
    document.getElementById("avatar-picker").innerHTML = device.map((c, i) => `
      <button class="avatar-tile" data-pick="${i}"><span class="big-emoji">${c.emoji}</span><span class="tile-name">${escapeHtml(c.name)}</span></button>`).join("");
    document.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => openPinScreen(device[parseInt(b.dataset.pick, 10)])));
    document.getElementById("open-setup-link").addEventListener("click", () => {
      document.getElementById("picker-screen").classList.add("hidden");
      showSetupScreen(getSupabaseConfig(), getDeviceConfig());
    });
  }

  function openPinScreen(child) {
    pendingChild = child; pinBuffer = "";
    document.getElementById("picker-screen").classList.add("hidden");
    document.getElementById("pin-screen").classList.remove("hidden");
    document.getElementById("pin-emoji").textContent = child.emoji;
    document.getElementById("pin-title").textContent = `Hi ${child.name}!`;
    updatePinDots();
    document.querySelectorAll("[data-pin]").forEach((b) => {
      b.onclick = () => {
        if (pinBuffer.length < 8) pinBuffer += b.dataset.pin;
        updatePinDots();
        if (pinBuffer.length >= 6) attemptLogin();
      };
    });
    document.getElementById("pin-backspace").onclick = () => { pinBuffer = pinBuffer.slice(0, -1); updatePinDots(); };
    document.getElementById("pin-back-to-picker").onclick = () => showPickerScreen();
  }
  function updatePinDots() {
    const dots = document.querySelectorAll("#pin-dots .pin-dot");
    dots.forEach((d, i) => d.classList.toggle("filled", i < pinBuffer.length));
  }
  async function attemptLogin() {
    const { error } = await sb.auth.signInWithPassword({ email: pendingChild.email, password: pinBuffer });
    if (error) {
      document.getElementById("pin-error").textContent = "That's not quite right — try again";
      pinBuffer = ""; updatePinDots();
      setTimeout(() => { const e = document.getElementById("pin-error"); if (e) e.textContent = "\u00A0"; }, 1500);
      return;
    }
    document.getElementById("pin-screen").classList.add("hidden");
    const ok = await loadApp();
    if (!ok) showPickerScreen();
  }

  // ---------------------------------------------------------------
  // APP LOAD
  // ---------------------------------------------------------------
  async function loadApp() {
    const { data: userData } = await sb.auth.getUser();
    if (!userData.user) return false;
    const { data: me, error } = await sb.from("profiles").select("*").eq("id", userData.user.id).single();
    if (error || !me) { showToast("No profile found for this login yet.", "⚠️"); await sb.auth.signOut(); return false; }
    if (me.role !== "child") {
      showToast("This is a parent login — please use the Parent App.", "🚫");
      await sb.auth.signOut();
      return false;
    }
    state.me = me;
    await sb.rpc("ensure_today_tasks", { p_child_id: me.id });
    await refreshAll();
    document.getElementById("app-shell").classList.remove("hidden");
    document.getElementById("topbar-avatar").textContent = me.emoji;
    document.getElementById("topbar-avatar").style.background = me.color;
    document.getElementById("topbar-name").textContent = me.name;
    document.getElementById("topbar-points").textContent = me.points;
    bindNav();
    subscribeRealtime();
    renderView("home");
    return true;
  }

  async function refreshAll() {
    const famId = state.me.family_id;
    const today = todayISO();
    const [meFresh, family, tasks, rewards, redemptions, quranGoal, schoolEvents, homework, calendarEvents] = await Promise.all([
      sb.from("profiles").select("*").eq("id", state.me.id).single().then((r) => r.data),
      sb.from("families").select("*").eq("id", famId).single().then((r) => r.data),
      sb.from("tasks").select("*").eq("owner_id", state.me.id).gte("date", isoDaysAgo(13)).lte("date", today).then((r) => r.data || []),
      sb.from("rewards").select("*").eq("family_id", famId).eq("active", true).then((r) => r.data || []),
      sb.from("redemptions").select("*").eq("owner_id", state.me.id).order("requested_at", { ascending: false }).then((r) => r.data || []),
      sb.from("quran_goals").select("*").eq("child_id", state.me.id).maybeSingle().then((r) => r.data),
      sb.from("school_events").select("*").eq("owner_id", state.me.id).then((r) => r.data || []),
      sb.from("homework").select("*").eq("owner_id", state.me.id).then((r) => r.data || []),
      sb.from("calendar_events").select("*").eq("family_id", famId).then((r) => r.data || [])
    ]);
    state.me = meFresh || state.me; state.family = family; state.tasks = tasks; state.rewards = rewards;
    state.redemptions = redemptions; state.quranGoal = quranGoal || { target_pages: 3, target_minutes: 15 };
    state.schoolEvents = schoolEvents; state.homework = homework; state.calendarEvents = calendarEvents;
    document.getElementById("topbar-points").textContent = state.me.points;
  }

  function subscribeRealtime() {
    sb.channel("kid-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `owner_id=eq.${state.me.id}` }, () => refreshAndRerender())
      .on("postgres_changes", { event: "*", schema: "public", table: "redemptions", filter: `owner_id=eq.${state.me.id}` }, () => refreshAndRerender())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `id=eq.${state.me.id}` }, () => refreshAndRerender())
      .subscribe();
  }
  async function refreshAndRerender() { await refreshAll(); renderView(state.view); }

  let navBound = false;
  function bindNav() {
    if (navBound) return;
    navBound = true;
    document.querySelectorAll(".bottom-nav button").forEach((b) => b.addEventListener("click", () => renderView(b.dataset.view)));
    document.getElementById("switch-user-btn").addEventListener("click", async () => { await sb.auth.signOut(); showPickerScreen(); });
    // Delegated, bound once: safe against duplicate listeners even though
    // the same task/reward id can appear in more than one view (Home,
    // Tasks, Routine all show task cards) — re-rendering a view replaces
    // its own DOM nodes, but a global querySelectorAll+addEventListener
    // per render would keep stacking listeners onto nodes left over in
    // OTHER, currently-hidden views. Delegation sidesteps that entirely.
    // The navBound guard also stops this handler itself from doubling up
    // when a second child signs in on the same device (#app-shell is
    // never recreated — loadApp() just runs again on the same element).
    document.getElementById("app-shell").addEventListener("click", (e) => {
      const toggleBtn = e.target.closest("[data-toggle-task]");
      if (toggleBtn && toggleBtn.dataset.toggleTask) { toggleTask(toggleBtn.dataset.toggleTask); return; }
      const tabBtn = e.target.closest("[data-tab]");
      if (tabBtn) { taskTab = tabBtn.dataset.tab; renderTasks(); return; }
      const reqBtn = e.target.closest("[data-request]");
      if (reqBtn) { requestReward(reqBtn.dataset.request); return; }
      const quranBtn = e.target.closest("#quran-log-btn");
      if (quranBtn) { openQuranModal(); return; }
    });
  }
  function renderView(name) {
    state.view = name;
    document.querySelectorAll(".bottom-nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(`view-${name}`).classList.add("active");
    ({ home: renderHome, tasks: renderTasks, routine: renderRoutine, rewards: renderRewards }[name] || renderHome)();
  }

  // ---------------------------------------------------------------
  // helpers shared across views
  // ---------------------------------------------------------------
  function tasksToday() { return state.tasks.filter((t) => t.date === todayISO()); }
  function dayPct(dateISO) {
    const list = state.tasks.filter((t) => t.date === dateISO);
    if (!list.length) return 0;
    return Math.round((list.filter(isTaskSatisfied).length / list.length) * 100);
  }
  function computeStreak() {
    let streak = 0;
    const cursor = new Date();
    if (dayPct(cursor.toISOString().slice(0, 10)) < 100) cursor.setDate(cursor.getDate() - 1);
    for (;;) {
      const iso = cursor.toISOString().slice(0, 10);
      if (!state.tasks.some((t) => t.date === iso)) break;
      if (dayPct(iso) === 100) { streak++; cursor.setDate(cursor.getDate() - 1); } else break;
    }
    return streak;
  }
  function ringSVG(pct, color, size = 96, stroke = 11) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, offset = c - (pct / 100) * c;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#F1ECFF" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${offset}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="53%" text-anchor="middle" font-size="22" font-weight="800" fill="#2B2340">${pct}%</text></svg>`;
  }
  function nextPrayerInfo() {
    const times = state.family.prayer_times;
    const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const [key, icon, label] of PRAYER_ORDER) {
      const [h, m] = times[key].split(":").map(Number);
      if (h * 60 + m > nowMin) return { key, icon, label, time: times[key] };
    }
    return { key: "fajr", icon: "🌅", label: "Fajr", time: times.fajr, tomorrow: true };
  }

  // ---------------------------------------------------------------
  // HOME
  // ---------------------------------------------------------------
  function renderHome() {
    const pct = dayPct(todayISO());
    const streak = computeStreak();
    const np = nextPrayerInfo();
    const hwToday = state.homework.filter((h) => h.due_date === todayISO());
    const list = tasksToday().slice().sort((a, b) => Number(isTaskSatisfied(a)) - Number(isTaskSatisfied(b))).slice(0, 4);

    document.getElementById("view-home").innerHTML = `
      <div class="hero-banner">
        <div><h2>${greeting()}, ${escapeHtml(state.me.name)}! 🌈</h2><div class="sub">Let's make today shine</div></div>
        <div class="streak">${streak}🔥<span>day streak</span></div>
      </div>
      <div class="grid grid-2" style="margin-bottom:16px;">
        <div class="card" style="display:flex;flex-direction:column;align-items:center;gap:10px;">
          <div class="ring-wrap">${ringSVG(pct, "#8C6FE0")}</div><div class="tag">Today's progress</div>
        </div>
        <div class="card">
          <div class="card-title"><h3>🕌 Next prayer</h3></div>
          <div style="text-align:center;padding:10px 0;">
            <div style="font-size:34px;">${np.icon}</div>
            <div style="font-weight:800;font-size:18px;margin-top:6px;">${np.label}</div>
            <div class="tag">${np.time}${np.tomorrow ? " · tomorrow" : ""}</div>
          </div>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px;">
        <div class="card-title"><h3>📝 Homework today</h3><span class="tag">${hwToday.length}</span></div>
        ${hwToday.length ? hwToday.map((h) => `<div style="font-size:14px;font-weight:700;padding:6px 0;">${h.done ? "✅" : "⏳"} ${escapeHtml(h.title)}</div>`).join("") : `<div class="empty-state"><div class="icon">🎉</div>Nothing due today!</div>`}
      </div>
      <div class="card">
        <div class="card-title"><h3>Today's tasks</h3></div>
        ${list.map((t) => taskCardHtml(t)).join("") || `<div class="empty-state"><div class="icon">🌟</div>All done for today!</div>`}
      </div>`;
  }
  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }

  // ---------------------------------------------------------------
  // MY TASKS
  // ---------------------------------------------------------------
  let taskTab = "ALL";
  function renderTasks() {
    const cats = ["ALL", "LEARNING", "RESPONSIBILITY", "ACTIVITIES"];
    const tabs = cats.map((c) => `<button class="btn btn-sm ${taskTab === c ? "btn-primary" : "btn-secondary"}" data-tab="${c}" style="margin:0 6px 10px 0;">${c === "ALL" ? "🗂️ All" : `${CATEGORY_META[c].icon} ${CATEGORY_META[c].label}`}</button>`).join("");
    const list = tasksToday().filter((t) => t.category !== "FAITH" && (taskTab === "ALL" || t.category === taskTab))
      .sort((a, b) => Number(isTaskSatisfied(a)) - Number(isTaskSatisfied(b)));
    document.getElementById("view-tasks").innerHTML = `
      <h2 style="margin:16px 0 10px;">✅ My Tasks</h2>
      <div>${tabs}</div>
      ${list.map((t) => taskCardHtml(t)).join("") || `<div class="empty-state"><div class="icon">🎈</div>Nothing here — nice work!</div>`}`;
  }
  function taskCardHtml(t) {
    const satisfied = isTaskSatisfied(t);
    const pending = t.needs_approval && t.approval_status === "pending";
    return `<button class="task-card ${satisfied ? "done" : ""} ${pending ? "pending" : ""}" data-toggle-task="${t.id}" style="background:${satisfied ? "" : CATEGORY_META[t.category]?.tint || ""}">
      <span class="emoji">${t.icon || "⭐"}</span>
      <span class="body"><span class="t-name">${escapeHtml(t.name)}</span><span class="t-meta">${pending ? "Waiting for a parent to check ⏳" : satisfied ? "Great job! ✅" : "Tap when you're done"}</span></span>
      <span class="t-points">${pending ? "⏳" : satisfied ? "✓" : `+${t.points}`}</span>
    </button>`;
  }
  async function toggleTask(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    const mark = !t.done;
    const { data, error } = await sb.rpc("complete_task", { p_task_id: id, p_mark: mark });
    if (error) { showToast(error.message, "⚠️"); return; }
    if (mark && data && data.needs_approval && data.approval_status === "pending") {
      showToast("Sent to a parent to check!", "⏳");
    } else if (mark) {
      showToast(`+${t.points} points!`, "🎉");
      if (t.category !== "FAITH") burst();
    }
    await refreshAndRerender();
  }

  // ---------------------------------------------------------------
  // MY ROUTINE — calm prayers/Qur'an, school today
  // ---------------------------------------------------------------
  function renderRoutine() {
    const today = todayISO();
    const prayerTasks = tasksToday().filter((t) => t.category === "FAITH" && t.catalog_key !== "quran");
    const prayerRows = PRAYER_ORDER.map(([key, icon, label]) => {
      const t = prayerTasks.find((x) => x.catalog_key === key);
      const done = t && isTaskSatisfied(t);
      return `<button class="calm-row ${done ? "done" : ""}" data-toggle-task="${t ? t.id : ""}">
        <span class="calm-check">${done ? "✓" : ""}</span><span class="c-icon">${icon}</span><span class="c-name">${label}</span><span class="c-time">${state.family.prayer_times[key]}</span>
      </button>`;
    }).join("");
    const qTask = tasksToday().find((t) => t.catalog_key === "quran");
    const qDone = qTask && isTaskSatisfied(qTask);

    const dow = new Date().getDay();
    const classesToday = state.schoolEvents.filter((e) => e.day === dow).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const exam = state.calendarEvents.filter((e) => e.type === "exam" && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];

    document.getElementById("view-routine").innerHTML = `
      <h2 style="margin:16px 0 10px;">🕌 My Routine</h2>
      <div class="card" style="margin-bottom:16px;">
        <div class="card-title"><h3>Prayers</h3></div>
        <div class="calm-list">${prayerRows}</div>
      </div>
      <div class="card" style="margin-bottom:16px;">
        <div class="card-title"><h3>📖 Qur'an</h3></div>
        <div class="quran-card">
          <div class="qr-row"><span>Daily goal</span><span>${state.quranGoal.target_pages} pages · ${state.quranGoal.target_minutes} min</span></div>
          <div class="qr-row"><span>Today</span><span>${qDone ? `${qTask.pages_read || state.quranGoal.target_pages} pages ✓` : "Not yet"}</span></div>
        </div>
        <button class="btn btn-primary btn-block" id="quran-log-btn" style="margin-top:12px;">${qDone ? "Update my reading" : "📖 Log today's reading"}</button>
      </div>
      <div class="card">
        <div class="card-title"><h3>📚 School today</h3></div>
        ${classesToday.map((e) => `<div class="class-card"><div class="time">${e.start_time}</div><div><div class="subj">${escapeHtml(e.subject)}</div><div class="meta">${escapeHtml(e.teacher || "")} · ${escapeHtml(e.room || "")}</div></div></div>`).join("") || `<div class="empty-state"><div class="icon">🎉</div>No classes today!</div>`}
        ${exam ? `<div style="margin-top:10px;background:#FDE0E9;color:#B84761;border-radius:14px;padding:10px 14px;font-weight:800;font-size:13px;">📝 ${escapeHtml(exam.title)} · ${exam.date === today ? "today" : exam.date}</div>` : ""}
      </div>`;
  }

  function openQuranModal() {
    const qTask = tasksToday().find((t) => t.catalog_key === "quran");
    openModal(`
      <h3>📖 Log today's Qur'an reading</h3>
      <p style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">Goal: ${state.quranGoal.target_pages} pages · ${state.quranGoal.target_minutes} minutes</p>
      <div class="field"><label>Pages read</label><input id="ql-pages" type="number" min="0" value="${qTask?.pages_read || state.quranGoal.target_pages}" /></div>
      <div class="field"><label>Minutes spent</label><input id="ql-minutes" type="number" min="0" value="${qTask?.minutes_spent || state.quranGoal.target_minutes}" /></div>
      <div class="field"><label>What did you read?</label><input id="ql-notes" placeholder="e.g. Surah Al-Kahf" value="${escapeHtml(qTask?.notes || "")}" /></div>
      <div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="ql-save">Save</button></div>`);
    document.getElementById("ql-save").addEventListener("click", async () => {
      const pages = Math.max(0, parseInt(document.getElementById("ql-pages").value, 10) || 0);
      const minutes = Math.max(0, parseInt(document.getElementById("ql-minutes").value, 10) || 0);
      const notes = document.getElementById("ql-notes").value.trim();
      const { error } = await sb.rpc("log_quran_reading", { p_date: todayISO(), p_pages: pages, p_minutes: minutes, p_notes: notes });
      if (error) { showToast(error.message, "⚠️"); return; }
      closeModal(); showToast("Reading saved — well done!", "📖");
      await refreshAndRerender();
    });
  }

  // ---------------------------------------------------------------
  // REWARDS
  // ---------------------------------------------------------------
  function renderRewards() {
    const shop = state.rewards.map((r) => {
      const pending = state.redemptions.find((x) => x.reward_id === r.id && x.status === "pending");
      const canAfford = state.me.points >= r.cost;
      let btn;
      if (pending) btn = `<button class="btn btn-sm btn-secondary" disabled>⏳ Asked</button>`;
      else if (!canAfford) btn = `<button class="btn btn-sm btn-secondary" disabled>Need ${r.cost - state.me.points} more ⭐</button>`;
      else btn = `<button class="btn btn-sm btn-primary" data-request="${r.id}">${r.requires_approval ? "Ask for it!" : "Get it!"}</button>`;
      return `<div class="card reward-tile"><div class="icon">${r.icon}</div><div class="title">${escapeHtml(r.title)}</div><div class="cost">⭐ ${r.cost} points</div>${btn}</div>`;
    }).join("");
    const history = state.redemptions.slice(0, 12).map((r) => `<div class="hist-row"><span>${r.icon} ${escapeHtml(r.reward_title)}</span><span class="pill pill-${r.status}">${r.status}</span></div>`).join("") || `<div class="empty-state"><div class="icon">🎁</div>No rewards yet — go earn some stars!</div>`;

    document.getElementById("view-rewards").innerHTML = `
      <h2 style="margin:16px 0 10px;">⭐ Rewards Shop</h2>
      <div class="grid grid-3" style="margin-bottom:20px;">${shop || `<div class="empty-state"><div class="icon">🎁</div>No rewards yet.</div>`}</div>
      <div class="card"><div class="card-title"><h3>My requests</h3></div>${history}</div>`;
  }
  async function requestReward(id) {
    const { data, error } = await sb.rpc("request_reward", { p_reward_id: id });
    if (error) { showToast(error.message, "⚠️"); return; }
    showToast(data.status === "fulfilled" ? "Enjoy your reward!" : "Sent to a parent to approve!", data.status === "fulfilled" ? "🎉" : "📨");
    if (data.status === "fulfilled") burst();
    await refreshAndRerender();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
