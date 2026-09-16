// Family Hub — Parent App
(() => {
  "use strict";

  const { getSupabaseConfig, setSupabaseConfig, getClient, getIsolatedClient } = window.SupabaseBootstrap;
  let sb = null;
  let authMode = "signin"; // 'signin' | 'signup'

  const state = {
    view: "home", me: null, family: null,
    profiles: [], tasks: [], catalog: [], rewards: [], redemptions: [],
    quranGoals: [], schoolEvents: [], homework: [], calendarEvents: [],
    taskSubTab: "today", taskChild: null
  };

  const CATEGORY_META = {
    FAITH: { label: "Faith", icon: "🕌", color: "var(--sky-dark)" },
    LEARNING: { label: "Learning", icon: "📚", color: "var(--marigold-dark)" },
    RESPONSIBILITY: { label: "Responsibility", icon: "🧹", color: "var(--sage-dark)" },
    ACTIVITIES: { label: "Activities", icon: "⚽", color: "var(--berry-dark)" }
  };
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function escapeHtml(str) { return String(str ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
  function showToast(msg, icon = "✅") {
    const t = document.getElementById("toast");
    t.textContent = `${icon} ${msg}`;
    t.classList.add("show");
    clearTimeout(showToast._tm);
    showToast._tm = setTimeout(() => t.classList.remove("show"), 2400);
  }
  function openModal(html) { document.getElementById("modal-content").innerHTML = html; document.getElementById("modal-backdrop").classList.remove("hidden"); }
  function closeModal() { document.getElementById("modal-backdrop").classList.add("hidden"); }
  window.closeModal = closeModal;
  function profileById(id) { return state.profiles.find((p) => p.id === id); }
  function children() { return state.profiles.filter((p) => p.role === "child"); }
  function isTaskSatisfied(t) { if (!t.done) return false; if (t.needs_approval) return t.approval_status === "approved"; return true; }
  function barRow(label, sub, pct, color) {
    return `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(label)}</span><span>${escapeHtml(String(sub))}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div></div>`;
  }
  function emptyState(msg, icon = "🌿") { return `<div class="empty-state"><div class="icon">${icon}</div>${escapeHtml(msg)}</div>`; }

  // ---------------------------------------------------------------
  // BOOT
  // ---------------------------------------------------------------
  async function boot() {
    const cfg = getSupabaseConfig();
    if (!cfg) { showConnectScreen(); return; }
    sb = getClient();
    const { data } = await sb.auth.getSession();
    if (data.session) await loadApp();
    else showAuthScreen();
    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { document.getElementById("app-shell").classList.add("hidden"); showAuthScreen(); }
    });
  }

  function showConnectScreen() {
    document.getElementById("connect-screen").classList.remove("hidden");
    document.getElementById("cfg-save-btn").addEventListener("click", () => {
      const url = document.getElementById("cfg-url").value.trim();
      const key = document.getElementById("cfg-key").value.trim();
      if (!url || !key) return;
      setSupabaseConfig(url, key);
      document.getElementById("connect-screen").classList.add("hidden");
      sb = getClient();
      showAuthScreen();
    });
  }

  function showAuthScreen() {
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("auth-submit-btn").addEventListener("click", submitAuth);
    document.getElementById("auth-mode-toggle").addEventListener("click", toggleAuthMode);
    document.getElementById("auth-reset-config").addEventListener("click", () => {
      window.SupabaseBootstrap.clearSupabaseConfig();
      location.reload();
    });
  }

  function toggleAuthMode() {
    authMode = authMode === "signin" ? "signup" : "signin";
    document.getElementById("onboarding-fields").classList.toggle("hidden", authMode !== "signup");
    document.getElementById("auth-title").textContent = authMode === "signup" ? "Set up your family" : "Parent sign in";
    document.getElementById("auth-sub").textContent = authMode === "signup"
      ? "Create the first parent account. You can add the other parent and both children afterwards."
      : "Manage your family's tasks, points and rewards.";
    document.getElementById("auth-submit-btn").textContent = authMode === "signup" ? "Create account & family" : "Sign in";
    document.getElementById("auth-mode-toggle").textContent = authMode === "signup" ? "Already have an account? Sign in" : "New family? Set up your account";
  }

  async function submitAuth() {
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    const errEl = document.getElementById("auth-error");
    errEl.innerHTML = "";
    if (!email || !password) return;
    try {
      if (authMode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          errEl.innerHTML = `<div class="auth-note">Account created — check your email to confirm, then sign in.</div>`;
          return;
        }
        const familyName = document.getElementById("ob-family").value.trim() || "Our Family";
        const name = document.getElementById("ob-name").value.trim() || "Parent";
        const subtitle = document.getElementById("ob-subtitle").value;
        const emoji = document.getElementById("ob-emoji").value.trim() || "🙂";
        const color = subtitle === "Mom" ? "#B5578A" : "#3E6B8A";
        const { error: rpcErr } = await sb.rpc("setup_family", { p_family_name: familyName, p_parent_name: name, p_parent_subtitle: subtitle, p_color: color, p_emoji: emoji });
        if (rpcErr) throw rpcErr;
        await loadApp();
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await loadApp();
      }
    } catch (e) {
      errEl.innerHTML = `<div class="auth-error">${escapeHtml(e.message || "Something went wrong")}</div>`;
    }
  }

  // ---------------------------------------------------------------
  // APP LOAD
  // ---------------------------------------------------------------
  async function loadApp() {
    const { data: userData } = await sb.auth.getUser();
    const uid = userData.user.id;
    const { data: me, error } = await sb.from("profiles").select("*").eq("id", uid).single();
    if (error || !me) { showToast("No profile found for this login yet.", "⚠️"); return; }
    if (me.role !== "parent") {
      showToast("This login is a child account — please use the Kids App instead.", "🚫");
      await sb.auth.signOut();
      return;
    }
    state.me = me;
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("app-shell").classList.remove("hidden");
    document.getElementById("who-name").textContent = me.name;
    await refreshAll();
    bindNav();
    subscribeRealtime();
    renderView("home");
  }

  async function refreshAll() {
    const famId = state.me.family_id;
    const today = todayISO();
    const [family, profiles, tasks, catalog, rewards, redemptions, quranGoals, schoolEvents, homework, calendarEvents] = await Promise.all([
      sb.from("families").select("*").eq("id", famId).single().then((r) => r.data),
      sb.from("profiles").select("*").eq("family_id", famId).then((r) => r.data || []),
      sb.from("tasks").select("*").eq("family_id", famId).gte("date", isoDaysAgo(13)).lte("date", today).then((r) => r.data || []),
      sb.from("task_catalog").select("*").eq("family_id", famId).then((r) => r.data || []),
      sb.from("rewards").select("*").eq("family_id", famId).then((r) => r.data || []),
      sb.from("redemptions").select("*").eq("family_id", famId).order("requested_at", { ascending: false }).then((r) => r.data || []),
      sb.from("quran_goals").select("*").eq("family_id", famId).then((r) => r.data || []),
      sb.from("school_events").select("*").eq("family_id", famId).then((r) => r.data || []),
      sb.from("homework").select("*").eq("family_id", famId).then((r) => r.data || []),
      sb.from("calendar_events").select("*").eq("family_id", famId).then((r) => r.data || [])
    ]);
    state.family = family; state.profiles = profiles; state.tasks = tasks; state.catalog = catalog;
    state.rewards = rewards; state.redemptions = redemptions; state.quranGoals = quranGoals;
    state.schoolEvents = schoolEvents; state.homework = homework; state.calendarEvents = calendarEvents;
    if (!state.taskChild) state.taskChild = children()[0]?.id || null;
    updateBadges();
  }

  function isoDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

  function updateBadges() {
    const pendingTasks = state.tasks.filter((t) => t.needs_approval && t.approval_status === "pending").length;
    const pendingRewards = state.redemptions.filter((r) => r.status === "pending").length;
    const tb = document.getElementById("tasks-badge"), rb = document.getElementById("rewards-badge");
    tb.textContent = pendingTasks; tb.classList.toggle("hidden", pendingTasks === 0);
    rb.textContent = pendingRewards; rb.classList.toggle("hidden", pendingRewards === 0);
  }

  function subscribeRealtime() {
    sb.channel("family-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `family_id=eq.${state.me.family_id}` }, () => refreshAndRerender())
      .on("postgres_changes", { event: "*", schema: "public", table: "redemptions", filter: `family_id=eq.${state.me.family_id}` }, () => refreshAndRerender())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `family_id=eq.${state.me.family_id}` }, () => refreshAndRerender())
      .subscribe();
  }
  async function refreshAndRerender() { await refreshAll(); renderView(state.view); }

  // ---------------------------------------------------------------
  // NAV
  // ---------------------------------------------------------------
  let navBound = false;
  function bindNav() {
    if (navBound) return;
    navBound = true;
    document.querySelectorAll(".nav-btn[data-view]").forEach((b) => b.addEventListener("click", () => renderView(b.dataset.view)));
    document.getElementById("sign-out-btn").addEventListener("click", async () => { await sb.auth.signOut(); });
    // Delegated, bound once: Home, Tasks-Today and Rewards can all show
    // the SAME pending task/redemption id at once, so per-render global
    // querySelectorAll+addEventListener would stack duplicate listeners
    // on whichever view isn't currently being re-rendered. See the Kids
    // App's identical comment for the full explanation. The navBound
    // guard above additionally stops this from re-attaching on every
    // sign-in — #app-shell is a persistent element, not recreated per
    // login, so without the guard each re-login would double the
    // listener again.
    document.getElementById("app-shell").addEventListener("click", (e) => {
      const at = e.target.closest("[data-approve-task]"); if (at) { decideTask(at.dataset.approveTask, true); return; }
      const rt = e.target.closest("[data-reject-task]"); if (rt) { decideTask(rt.dataset.rejectTask, false); return; }
      const ar = e.target.closest("[data-approve-reward]"); if (ar) { decideRedemption(ar.dataset.approveReward, true); return; }
      const dr = e.target.closest("[data-deny-reward]"); if (dr) { decideRedemption(dr.dataset.denyReward, false); return; }
    });
  }
  function renderView(name) {
    state.view = name;
    document.querySelectorAll(".nav-btn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(`view-${name}`).classList.add("active");
    ({ home: renderHome, family: renderFamily, tasks: renderTasks, routine: renderRoutine, rewards: renderRewards, settings: renderSettings }[name] || renderHome)();
  }

  // ---------------------------------------------------------------
  // HOME
  // ---------------------------------------------------------------
  function renderHome() {
    const today = todayISO();
    const kids = children();
    const pendingTasks = state.tasks.filter((t) => t.needs_approval && t.approval_status === "pending");
    const pendingRewards = state.redemptions.filter((r) => r.status === "pending");
    const kidCards = kids.map((k) => {
      const list = state.tasks.filter((t) => t.owner_id === k.id && t.date === today);
      const pct = list.length ? Math.round((list.filter(isTaskSatisfied).length / list.length) * 100) : 0;
      return `<div class="card profile-card">
        <span class="avatar" style="background:${k.color}">${k.emoji}</span>
        <div><div class="name">${escapeHtml(k.name)}</div><div class="role">${pct}% done today · ${k.points} pts</div></div>
      </div>`;
    }).join("");

    document.getElementById("view-home").innerHTML = `
      <div class="view-header"><div><h1>Good day, ${escapeHtml(state.me.name)}</h1><p>${escapeHtml(state.family.name)} — here's today at a glance.</p></div></div>
      <div class="grid grid-4" style="margin-bottom:20px;">${kidCards || emptyState("No children yet — add one in Family")}</div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title"><h3>Tasks awaiting your approval</h3><span class="tag">${pendingTasks.length}</span></div>
          ${pendingTasks.length ? `<div class="row-list">${pendingTasks.map((t) => taskRowHtml(t, true)).join("")}</div>` : emptyState("Nothing waiting on you", "✅")}
        </div>
        <div class="card">
          <div class="card-title"><h3>Reward requests</h3><span class="tag">${pendingRewards.length}</span></div>
          ${pendingRewards.length ? `<div class="row-list">${pendingRewards.map((r) => redemptionRowHtml(r)).join("")}</div>` : emptyState("No pending requests", "🎁")}
        </div>
      </div>`;
  }

  function taskRowHtml(t, showApprove) {
    const meta = CATEGORY_META[t.category];
    return `<div class="item-row">
      <div class="info"><div class="title">${t.icon || ""} ${escapeHtml(t.name)} <span class="cat-dot" style="background:${meta.color}"></span></div>
      <div class="meta">${escapeHtml(profileById(t.owner_id)?.name || "")} · ${meta.label} · +${t.points} pts</div></div>
      ${showApprove ? `<button class="btn btn-sm btn-secondary" data-approve-task="${t.id}">Approve</button><button class="btn btn-sm btn-danger" data-reject-task="${t.id}">Reject</button>` : ""}
    </div>`;
  }
  function redemptionRowHtml(r) {
    return `<div class="item-row">
      <div class="info"><div class="title">${r.icon} ${escapeHtml(r.reward_title)}</div><div class="meta">${escapeHtml(profileById(r.owner_id)?.name || "")} · ${r.cost} pts</div></div>
      <button class="btn btn-sm btn-secondary" data-approve-reward="${r.id}">Approve</button><button class="btn btn-sm btn-danger" data-deny-reward="${r.id}">Deny</button>
    </div>`;
  }
  async function decideTask(id, approve) {
    const { error } = await sb.rpc("decide_task_approval", { p_task_id: id, p_approve: approve });
    if (error) { showToast(error.message, "⚠️"); return; }
    showToast(approve ? "Approved" : "Rejected", approve ? "✅" : "❌");
    await refreshAndRerender();
  }
  async function decideRedemption(id, approve) {
    const { error } = await sb.rpc("decide_redemption", { p_redemption_id: id, p_approve: approve });
    if (error) { showToast(error.message, "⚠️"); return; }
    showToast(approve ? "Reward approved" : "Reward denied", approve ? "🎁" : "🚫");
    await refreshAndRerender();
  }

  // ---------------------------------------------------------------
  // FAMILY
  // ---------------------------------------------------------------
  function renderFamily() {
    const cards = state.profiles.map((p) => `
      <div class="card profile-card">
        <span class="avatar" style="background:${p.color}">${p.emoji}</span>
        <div style="flex:1;"><div class="name">${escapeHtml(p.name)}</div><div class="role">${escapeHtml(p.subtitle || "")} · ${p.role === "child" ? `${p.points} points` : "Parent"}</div></div>
        ${p.role === "child" ? `<button class="btn btn-sm btn-secondary" data-edit-goal="${p.id}">Qur'an goal</button>` : ""}
      </div>`).join("");
    document.getElementById("view-family").innerHTML = `
      <div class="view-header"><div><h1>Family</h1><p>${escapeHtml(state.family.name)}</p></div>
        <button class="btn btn-primary" id="add-child-btn">+ Add child login</button></div>
      <div class="grid grid-2">${cards}</div>`;
    document.getElementById("add-child-btn").addEventListener("click", openAddChildModal);
    document.querySelectorAll("[data-edit-goal]").forEach((b) => b.addEventListener("click", () => openQuranGoalModal(b.dataset.editGoal)));
  }

  async function openAddChildModal() {
    openModal(`
      <h3>Add a child login</h3>
      <p style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">This creates a real login the child uses in the Kids App. Choose a simple email and a short numeric PIN as their password (min 6 characters — e.g. add a couple of extra digits).</p>
      <div id="child-modal-error"></div>
      <div class="field"><label>Child's name</label><input id="child-name" placeholder="e.g. Aleef" /></div>
      <div class="field-row">
        <div class="field"><label>Emoji</label><input id="child-emoji" value="🧒" /></div>
        <div class="field"><label>Color</label><input id="child-color" value="#E8925C" /></div>
      </div>
      <div class="field"><label>Login email</label><input id="child-email" placeholder="aleef@yourfamily.com" /></div>
      <div class="field"><label>PIN / password (min 6 characters)</label><input id="child-pin" placeholder="e.g. 482913" /></div>
      <div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="child-save-btn">Create login</button></div>
    `);
    document.getElementById("child-save-btn").addEventListener("click", async () => {
      const name = document.getElementById("child-name").value.trim();
      const emoji = document.getElementById("child-emoji").value.trim() || "🧒";
      const color = document.getElementById("child-color").value.trim() || "#E8925C";
      const email = document.getElementById("child-email").value.trim();
      const pin = document.getElementById("child-pin").value;
      const errEl = document.getElementById("child-modal-error");
      if (!name || !email || pin.length < 6) { errEl.innerHTML = `<div class="auth-error">Fill in every field — the PIN needs at least 6 characters.</div>`; return; }
      try {
        // Use an isolated client so this signUp doesn't replace the parent's own session.
        const iso = getIsolatedClient();
        const { data, error } = await iso.auth.signUp({ email, password: pin });
        if (error) throw error;
        const childId = data.user?.id;
        if (!childId) throw new Error("Could not create the login — check your Supabase project's email settings.");
        await iso.auth.signOut();
        const { error: rpcErr } = await sb.rpc("add_family_member", { p_new_user_id: childId, p_role: "child", p_name: name, p_subtitle: "Child", p_color: color, p_emoji: emoji });
        if (rpcErr) throw rpcErr;
        closeModal();
        showToast(`${name}'s login is ready`, "🎉");
        await refreshAndRerender();
      } catch (e) {
        errEl.innerHTML = `<div class="auth-error">${escapeHtml(e.message)}</div>`;
      }
    });
  }

  function openQuranGoalModal(childId) {
    const goal = state.quranGoals.find((g) => g.child_id === childId) || { target_pages: 3, target_minutes: 15 };
    const child = profileById(childId);
    openModal(`
      <h3>${escapeHtml(child.name)}'s Qur'an goal</h3>
      <div class="field"><label>Target pages / day</label><input id="qg-pages" type="number" min="1" value="${goal.target_pages}" /></div>
      <div class="field"><label>Target minutes / day</label><input id="qg-min" type="number" min="1" value="${goal.target_minutes}" /></div>
      <div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="qg-save">Save</button></div>
    `);
    document.getElementById("qg-save").addEventListener("click", async () => {
      const target_pages = Math.max(1, parseInt(document.getElementById("qg-pages").value, 10) || 1);
      const target_minutes = Math.max(1, parseInt(document.getElementById("qg-min").value, 10) || 1);
      const { error } = await sb.from("quran_goals").upsert({ family_id: state.me.family_id, child_id: childId, target_pages, target_minutes }, { onConflict: "child_id" });
      if (error) { showToast(error.message, "⚠️"); return; }
      closeModal(); showToast("Qur'an goal updated");
      await refreshAndRerender();
    });
  }

  // ---------------------------------------------------------------
  // TASKS — Today / Catalog
  // ---------------------------------------------------------------
  function renderTasks() {
    const kids = children();
    if (!state.taskChild) state.taskChild = kids[0]?.id;
    document.getElementById("view-tasks").innerHTML = `
      <div class="view-header"><div><h1>Tasks</h1><p>Approve completions and manage the recurring task catalog.</p></div></div>
      <div class="tabs">
        <button class="tab-btn ${state.taskSubTab === "today" ? "active" : ""}" data-subtab="today">Today's tasks</button>
        <button class="tab-btn ${state.taskSubTab === "catalog" ? "active" : ""}" data-subtab="catalog">Recurring catalog</button>
      </div>
      <div id="tasks-subview"></div>`;
    document.querySelectorAll("[data-subtab]").forEach((b) => b.addEventListener("click", () => { state.taskSubTab = b.dataset.subtab; renderTasks(); }));
    if (state.taskSubTab === "today") renderTasksToday(); else renderTasksCatalog();
  }

  function renderTasksToday() {
    const kids = children();
    const today = todayISO();
    const tabs = kids.map((k) => `<button class="tab-btn ${state.taskChild === k.id ? "active" : ""}" data-tchild="${k.id}">${escapeHtml(k.name)}</button>`).join("");
    const list = state.tasks.filter((t) => t.owner_id === state.taskChild && t.date === today)
      .sort((a, b) => Number(isTaskSatisfied(a)) - Number(isTaskSatisfied(b)));
    const rows = list.map((t) => {
      const pending = t.needs_approval && t.approval_status === "pending";
      const satisfied = isTaskSatisfied(t);
      const meta = CATEGORY_META[t.category];
      return `<div class="item-row">
        <div class="info"><div class="title">${t.icon || ""} ${escapeHtml(t.name)} <span class="cat-dot" style="background:${meta.color}"></span></div>
          <div class="meta">${meta.label} · +${t.points} pts ${t.notes ? "· " + escapeHtml(t.notes) : ""}</div></div>
        ${pending ? `<span class="pill pill-pending">Pending</span><button class="btn btn-sm btn-secondary" data-approve-task="${t.id}">Approve</button><button class="btn btn-sm btn-danger" data-reject-task="${t.id}">Reject</button>`
          : `<span class="pill ${satisfied ? "pill-approved" : ""}">${satisfied ? "Done" : "Not yet"}</span>`}
      </div>`;
    }).join("") || emptyState("No tasks generated for today yet — the Kids App creates them automatically each morning.");
    document.getElementById("tasks-subview").innerHTML = `<div class="tabs">${tabs}</div><div class="row-list">${rows}</div>`;
    document.querySelectorAll("[data-tchild]").forEach((b) => b.addEventListener("click", () => { state.taskChild = b.dataset.tchild; renderTasksToday(); }));
  }

  function renderTasksCatalog() {
    const rows = state.catalog.map((c) => {
      const meta = CATEGORY_META[c.category];
      const days = (c.weekdays || []).map((d) => DAY_NAMES[d]).join(" ");
      return `<div class="item-row">
        <div class="info"><div class="title">${c.icon} ${escapeHtml(c.name)} <span class="cat-dot" style="background:${meta.color}"></span></div>
          <div class="meta">${meta.label} · +${c.points} pts · ${days}${c.needs_approval ? " · needs approval" : ""}${c.family_required ? " · family required" : ""}</div></div>
        <button class="btn btn-sm btn-secondary" data-edit-catalog="${c.id}">Edit</button>
        <button class="btn btn-sm btn-danger" data-del-catalog="${c.id}">Delete</button>
      </div>`;
    }).join("") || emptyState("No catalog items yet");
    document.getElementById("tasks-subview").innerHTML = `
      <div class="row-list">${rows}</div>
      <button class="btn btn-primary" id="add-catalog-btn" style="margin-top:16px;">+ Add recurring task</button>`;
    document.getElementById("add-catalog-btn").addEventListener("click", () => openCatalogModal(null));
    document.querySelectorAll("[data-edit-catalog]").forEach((b) => b.addEventListener("click", () => openCatalogModal(b.dataset.editCatalog)));
    document.querySelectorAll("[data-del-catalog]").forEach((b) => b.addEventListener("click", () => deleteCatalogItem(b.dataset.delCatalog)));
  }

  function openCatalogModal(id) {
    const existing = id ? state.catalog.find((c) => c.id === id) : null;
    const days = existing?.weekdays || [0, 1, 2, 3, 4, 5, 6];
    openModal(`
      <h3>${existing ? "Edit" : "New"} recurring task</h3>
      <div class="field"><label>Name</label><input id="cat-name" value="${existing ? escapeHtml(existing.name) : ""}" /></div>
      <div class="field-row">
        <div class="field"><label>Category</label><select id="cat-category">${Object.keys(CATEGORY_META).map((k) => `<option value="${k}" ${existing?.category === k ? "selected" : ""}>${CATEGORY_META[k].label}</option>`).join("")}</select></div>
        <div class="field"><label>Icon</label><input id="cat-icon" value="${existing?.icon || "⭐"}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Points</label><input id="cat-points" type="number" min="1" value="${existing?.points || 10}" /></div>
      </div>
      <div class="field"><label>Days scheduled</label><div class="week-badge">${DAY_NAMES.map((d, i) => `<button data-day="${i}" class="${days.includes(i) ? "on" : ""}">${d}</button>`).join("")}</div></div>
      <div class="field"><label><input type="checkbox" id="cat-approval" ${existing?.needs_approval ? "checked" : ""} /> Needs parent approval</label></div>
      <div class="field"><label><input type="checkbox" id="cat-family" ${existing?.family_required ? "checked" : ""} /> Counts toward Family Weekly Reward</label></div>
      <div class="modal-actions">
        ${existing ? `<button class="btn btn-danger" id="cat-del">Delete</button>` : ""}
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="cat-save">Save</button>
      </div>
    `);
    let selectedDays = new Set(days);
    document.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => {
      const d = parseInt(b.dataset.day, 10);
      if (selectedDays.has(d)) selectedDays.delete(d); else selectedDays.add(d);
      b.classList.toggle("on");
    }));
    document.getElementById("cat-save").addEventListener("click", async () => {
      const name = document.getElementById("cat-name").value.trim();
      if (!name) return;
      const payload = {
        family_id: state.me.family_id,
        key: existing ? existing.key : `custom_${Date.now()}`,
        category: document.getElementById("cat-category").value,
        name, icon: document.getElementById("cat-icon").value.trim() || "⭐",
        points: Math.max(1, parseInt(document.getElementById("cat-points").value, 10) || 10),
        needs_approval: document.getElementById("cat-approval").checked,
        family_required: document.getElementById("cat-family").checked,
        weekdays: Array.from(selectedDays)
      };
      const { error } = existing ? await sb.from("task_catalog").update(payload).eq("id", existing.id) : await sb.from("task_catalog").insert(payload);
      if (error) { showToast(error.message, "⚠️"); return; }
      closeModal(); showToast(existing ? "Task updated" : "Task added");
      await refreshAndRerender();
    });
    if (existing) document.getElementById("cat-del").addEventListener("click", () => deleteCatalogItem(existing.id));
  }
  async function deleteCatalogItem(id) {
    const { error } = await sb.from("task_catalog").delete().eq("id", id);
    if (error) { showToast(error.message, "⚠️"); return; }
    closeModal(); showToast("Removed");
    await refreshAndRerender();
  }

  // ---------------------------------------------------------------
  // ROUTINE — prayer times/points, school timetable, calendar
  // ---------------------------------------------------------------
  function renderRoutine() {
    const times = state.family.prayer_times, pts = state.family.task_points;
    const PRAYERS = [["fajr", "🌅", "Fajr"], ["dhuhr", "☀️", "Dhuhr"], ["asr", "🌤️", "Asr"], ["maghrib", "🌇", "Maghrib"], ["isha", "🌙", "Isha"]];
    const schoolRows = state.schoolEvents.slice().sort((a, b) => a.day - b.day || a.start_time.localeCompare(b.start_time)).map((e) => `
      <div class="item-row"><div class="info"><div class="title">${escapeHtml(e.subject)}</div>
        <div class="meta">${escapeHtml(profileById(e.owner_id)?.name || "")} · ${DAY_NAMES_FULL[e.day]} ${e.start_time}–${e.end_time || ""} · ${escapeHtml(e.teacher || "")} · ${escapeHtml(e.room || "")}</div></div>
        <button class="btn btn-sm btn-danger" data-del-class="${e.id}">Delete</button></div>`).join("") || emptyState("No classes yet");
    const events = state.calendarEvents.slice().sort((a, b) => a.date.localeCompare(b.date)).map((e) => `
      <div class="item-row"><div class="info"><div class="title">${e.type === "holiday" ? "🏖️" : e.type === "exam" ? "📝" : "🎉"} ${escapeHtml(e.title)}</div>
        <div class="meta">${e.date} · ${escapeHtml(profileById(e.owner_id)?.name || "Whole family")}</div></div>
        <button class="btn btn-sm btn-danger" data-del-event="${e.id}">Delete</button></div>`).join("") || emptyState("No events or holidays yet");
    const kids = children();

    document.getElementById("view-routine").innerHTML = `
      <div class="view-header"><div><h1>Routine</h1><p>Prayer times, points, timetable and calendar for the whole family.</p></div></div>
      <div class="grid grid-2" style="margin-bottom:20px;">
        <div class="card"><div class="card-title"><h3>Prayer times &amp; points</h3></div>
          ${PRAYERS.map(([k, icon, label]) => `<div class="field-row"><div class="field"><label>${icon} ${label} time</label><input id="pt-time-${k}" type="time" value="${times[k]}" /></div><div class="field" style="max-width:110px;"><label>Points</label><input id="pt-pts-${k}" type="number" min="1" value="${pts[k]}" /></div></div>`).join("")}
          <div class="field-row"><div class="field"><label>📖 Qur'an points</label><input id="pt-pts-quran" type="number" min="1" value="${pts.quran}" /></div></div>
          <button class="btn btn-primary btn-block" id="save-prayer-btn">Save</button>
        </div>
        <div class="card"><div class="card-title"><h3>Qur'an daily goals</h3></div>
          ${kids.map((k) => {
            const g = state.quranGoals.find((x) => x.child_id === k.id) || { target_pages: 3, target_minutes: 15 };
            return `<div class="field-row"><div class="field"><label>${escapeHtml(k.name)} — pages</label><input id="qg-pages-${k.id}" type="number" min="1" value="${g.target_pages}" /></div><div class="field"><label>Minutes</label><input id="qg-min-${k.id}" type="number" min="1" value="${g.target_minutes}" /></div></div>`;
          }).join("")}
          <button class="btn btn-primary btn-block" id="save-quran-btn">Save</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px;">
        <div class="card-title"><h3>Weekly school timetable</h3></div>
        <div class="row-list">${schoolRows}</div>
        <div class="add-form">
          <select id="sc-child">${kids.map((k) => `<option value="${k.id}">${escapeHtml(k.name)}</option>`).join("")}</select>
          <select id="sc-day">${DAY_NAMES_FULL.map((d, i) => `<option value="${i}">${d}</option>`).join("")}</select>
          <input id="sc-subject" placeholder="Subject" />
          <input id="sc-teacher" placeholder="Teacher" />
          <input id="sc-room" placeholder="Room" />
          <input id="sc-start" type="time" value="09:00" />
          <input id="sc-end" type="time" value="09:45" />
          <button class="btn btn-sm btn-primary" id="add-class-btn">+ Add class</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><h3>Special events, exams &amp; holidays</h3></div>
        <div class="row-list">${events}</div>
        <div class="add-form">
          <select id="ce-type"><option value="event">School event</option><option value="exam">Exam / test</option><option value="holiday">Holiday</option></select>
          <select id="ce-child"><option value="">Whole family</option>${kids.map((k) => `<option value="${k.id}">${escapeHtml(k.name)}</option>`).join("")}</select>
          <input id="ce-title" placeholder="Title" />
          <input id="ce-date" type="date" value="${todayISO()}" />
          <button class="btn btn-sm btn-primary" id="add-event-btn">+ Add</button>
        </div>
      </div>`;

    document.getElementById("save-prayer-btn").addEventListener("click", async () => {
      const newTimes = {}, newPts = {};
      PRAYERS.forEach(([k]) => { newTimes[k] = document.getElementById(`pt-time-${k}`).value; newPts[k] = Math.max(1, parseInt(document.getElementById(`pt-pts-${k}`).value, 10) || 5); });
      newPts.quran = Math.max(1, parseInt(document.getElementById("pt-pts-quran").value, 10) || 10);
      const { error } = await sb.from("families").update({ prayer_times: newTimes, task_points: newPts }).eq("id", state.me.family_id);
      if (error) { showToast(error.message, "⚠️"); return; }
      showToast("Prayer settings saved"); await refreshAndRerender();
    });
    document.getElementById("save-quran-btn").addEventListener("click", async () => {
      for (const k of kids) {
        const target_pages = Math.max(1, parseInt(document.getElementById(`qg-pages-${k.id}`).value, 10) || 1);
        const target_minutes = Math.max(1, parseInt(document.getElementById(`qg-min-${k.id}`).value, 10) || 1);
        await sb.from("quran_goals").upsert({ family_id: state.me.family_id, child_id: k.id, target_pages, target_minutes }, { onConflict: "child_id" });
      }
      showToast("Qur'an goals saved"); await refreshAndRerender();
    });
    document.getElementById("add-class-btn").addEventListener("click", async () => {
      const subject = document.getElementById("sc-subject").value.trim();
      if (!subject) return;
      const payload = { family_id: state.me.family_id, owner_id: document.getElementById("sc-child").value, day: parseInt(document.getElementById("sc-day").value, 10), start_time: document.getElementById("sc-start").value, end_time: document.getElementById("sc-end").value, subject, teacher: document.getElementById("sc-teacher").value.trim(), room: document.getElementById("sc-room").value.trim() };
      const { error } = await sb.from("school_events").insert(payload);
      if (error) { showToast(error.message, "⚠️"); return; }
      showToast("Class added"); await refreshAndRerender();
    });
    document.querySelectorAll("[data-del-class]").forEach((b) => b.addEventListener("click", async () => { await sb.from("school_events").delete().eq("id", b.dataset.delClass); await refreshAndRerender(); }));
    document.getElementById("add-event-btn").addEventListener("click", async () => {
      const title = document.getElementById("ce-title").value.trim();
      if (!title) return;
      const payload = { family_id: state.me.family_id, owner_id: document.getElementById("ce-child").value || null, type: document.getElementById("ce-type").value, title, date: document.getElementById("ce-date").value || todayISO() };
      const { error } = await sb.from("calendar_events").insert(payload);
      if (error) { showToast(error.message, "⚠️"); return; }
      showToast("Added to calendar"); await refreshAndRerender();
    });
    document.querySelectorAll("[data-del-event]").forEach((b) => b.addEventListener("click", async () => { await sb.from("calendar_events").delete().eq("id", b.dataset.delEvent); await refreshAndRerender(); }));
  }

  // ---------------------------------------------------------------
  // REWARDS
  // ---------------------------------------------------------------
  function renderRewards() {
    const pending = state.redemptions.filter((r) => r.status === "pending");
    const history = state.redemptions.filter((r) => r.status !== "pending").slice(0, 20);
    const shop = state.rewards.map((r) => `
      <div class="item-row"><div class="info"><div class="title">${r.icon} ${escapeHtml(r.title)}</div><div class="meta">${r.cost} pts${r.requires_approval ? " · needs approval" : ""}</div></div>
        <button class="btn btn-sm btn-secondary" data-edit-reward="${r.id}">Edit</button><button class="btn btn-sm btn-danger" data-del-reward="${r.id}">Delete</button></div>`).join("") || emptyState("No rewards yet");

    document.getElementById("view-rewards").innerHTML = `
      <div class="view-header"><div><h1>Rewards</h1><p>Manage the shop and approve requests.</p></div>
        <button class="btn btn-primary" id="add-reward-btn">+ Add reward</button></div>
      <div class="card" style="margin-bottom:20px;"><div class="card-title"><h3>Pending requests</h3><span class="tag">${pending.length}</span></div>
        <div class="row-list">${pending.map(redemptionRowHtml).join("") || emptyState("Nothing pending", "🎁")}</div></div>
      <div class="card" style="margin-bottom:20px;"><div class="card-title"><h3>Reward shop</h3></div><div class="row-list">${shop}</div></div>
      <div class="card"><div class="card-title"><h3>Recent history</h3></div>
        <div class="row-list">${history.map((r) => `<div class="item-row"><div class="info"><div class="title">${r.icon} ${escapeHtml(r.reward_title)}</div><div class="meta">${escapeHtml(profileById(r.owner_id)?.name || "")} · ${r.decided_at ? r.decided_at.slice(0, 10) : ""}</div></div><span class="pill ${r.status === "fulfilled" ? "pill-approved" : "pill-rejected"}">${r.status}</span></div>`).join("") || emptyState("No history yet")}</div></div>`;

    document.getElementById("add-reward-btn").addEventListener("click", () => openRewardModal(null));
    document.querySelectorAll("[data-edit-reward]").forEach((b) => b.addEventListener("click", () => openRewardModal(b.dataset.editReward)));
    document.querySelectorAll("[data-del-reward]").forEach((b) => b.addEventListener("click", async () => { await sb.from("rewards").delete().eq("id", b.dataset.delReward); await refreshAndRerender(); }));
  }

  function openRewardModal(id) {
    const existing = id ? state.rewards.find((r) => r.id === id) : null;
    openModal(`
      <h3>${existing ? "Edit" : "New"} reward</h3>
      <div class="field"><label>Title</label><input id="rw-title" value="${existing ? escapeHtml(existing.title) : ""}" /></div>
      <div class="field-row">
        <div class="field"><label>Icon</label><input id="rw-icon" value="${existing?.icon || "🎁"}" /></div>
        <div class="field"><label>Point cost</label><input id="rw-cost" type="number" min="1" value="${existing?.cost || 50}" /></div>
      </div>
      <div class="field"><label><input type="checkbox" id="rw-approval" ${existing?.requires_approval ? "checked" : ""} /> Requires parent approval</label></div>
      <div class="modal-actions">
        ${existing ? `<button class="btn btn-danger" id="rw-del">Delete</button>` : ""}
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="rw-save">Save</button>
      </div>`);
    document.getElementById("rw-save").addEventListener("click", async () => {
      const title = document.getElementById("rw-title").value.trim();
      if (!title) return;
      const payload = { family_id: state.me.family_id, title, icon: document.getElementById("rw-icon").value.trim() || "🎁", cost: Math.max(1, parseInt(document.getElementById("rw-cost").value, 10) || 50), requires_approval: document.getElementById("rw-approval").checked };
      const { error } = existing ? await sb.from("rewards").update(payload).eq("id", existing.id) : await sb.from("rewards").insert(payload);
      if (error) { showToast(error.message, "⚠️"); return; }
      closeModal(); showToast(existing ? "Reward updated" : "Reward added");
      await refreshAndRerender();
    });
    if (existing) document.getElementById("rw-del").addEventListener("click", async () => { await sb.from("rewards").delete().eq("id", existing.id); closeModal(); await refreshAndRerender(); });
  }

  // ---------------------------------------------------------------
  // SETTINGS
  // ---------------------------------------------------------------
  function renderSettings() {
    document.getElementById("view-settings").innerHTML = `
      <div class="view-header"><div><h1>Settings</h1><p>Family details and family weekly reward.</p></div></div>
      <div class="grid grid-2">
        <div class="card"><div class="card-title"><h3>Family name</h3></div>
          <div class="field"><input id="set-family-name" value="${escapeHtml(state.family.name)}" /></div>
          <button class="btn btn-primary" id="set-family-save">Save</button></div>
        <div class="card"><div class="card-title"><h3>Family weekly reward</h3></div>
          <div class="field"><label>Options (pick which one is active this week)</label>
          ${state.family.family_goal.rewardOptions.map((r, i) => `<label style="display:block;margin-bottom:8px;"><input type="radio" name="fw" value="${i}" ${i === state.family.family_goal.selectedIndex ? "checked" : ""} /> ${r.icon} ${escapeHtml(r.title)}</label>`).join("")}</div>
          <button class="btn btn-primary" id="set-fw-save">Save</button></div>
      </div>`;
    document.getElementById("set-family-save").addEventListener("click", async () => {
      const name = document.getElementById("set-family-name").value.trim() || "Our Family";
      await sb.from("families").update({ name }).eq("id", state.me.family_id);
      showToast("Family name updated"); await refreshAndRerender();
    });
    document.getElementById("set-fw-save").addEventListener("click", async () => {
      const idx = parseInt(document.querySelector('input[name="fw"]:checked')?.value || "0", 10);
      const goal = { ...state.family.family_goal, selectedIndex: idx };
      await sb.from("families").update({ family_goal: goal }).eq("id", state.me.family_id);
      showToast("Family reward updated"); await refreshAndRerender();
    });
  }

  // Register the service worker, and auto-reload once when a new version
  // takes over. Without this, a cached old build can stick around on a
  // device indefinitely and the user sees stale CSS/JS after an update.
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then((reg) => {
        // Check for a newer build whenever the app is opened/refocused.
        reg.update().catch(() => {});
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) reg.update().catch(() => {});
        });
      }).catch(() => {});
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
    });
  }
  registerServiceWorker();

  document.addEventListener("DOMContentLoaded", boot);
})();
