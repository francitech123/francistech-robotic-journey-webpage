// Connects the Idevrx UI to the real API. Loaded after the main script in index.html.
// It replaces the browser-storage data layer (sample projects, mock login, localStorage drafts).
(async () => {
  let TOKEN = "", SESSION = null, nav = 0, tm, q = Promise.resolve(), UNREAD = 0, NOTES = [], SAVED = [], FEED = { items: [], following: [] };
  const FW = {};
  let LEARN = [], PATH = null, LESSON = null, VERIFY = null, SET = null, CONFIRM = null;
  try { TOKEN = localStorage.getItem("idevrx_token") || ""; } catch (e) {}
  P.length = 0; MINE = [];

  const PS = { DRAFT: "Draft", READY_FOR_REVIEW: "Ready for review", PUBLISHED: "Published", UNPUBLISHED: "Unpublished", ARCHIVED: "Archived" };
  const dash = (s) => s || "—";
  const sess = (u) => ({ name: u.username, displayName: u.displayName, role: u.role, creator: u.role !== "user", emailVerified: u.emailVerified !== false });
  const LOAD = '<div class="wrap"><div class="sec"><div class="empty">Loading…</div></div></div>';

  async function api(path, o = {}) {
    const h = {};
    if (TOKEN) h.Authorization = "Bearer " + TOKEN;
    if (o.body !== undefined) h["Content-Type"] = "application/json";
    const r = await fetch("/api" + path, { method: o.method || "GET", headers: h, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 && TOKEN) { setUser(null); acct(); }
      const e = new Error(d.error || "Request failed");
      e.status = r.status; e.details = d.details;
      throw e;
    }
    return d;
  }

  // Session
  user = () => SESSION;
  setUser = (u) => {
    if (u) return;
    TOKEN = ""; SESSION = null;
    try { localStorage.removeItem("idevrx_token"); } catch (e) {}
  };
  async function loadMe() {
    if (!TOKEN) return;
    try { SESSION = sess((await api("/auth/me")).user); } catch (e) { setUser(null); return; }
    try { UNREAD = (await api("/notifications")).unread; } catch (e) {}
  }

  // Shape mapping: API -> the field names the UI already uses
  const mapCard = (x) => {
    if (!U[x.creator]) U[x.creator] = { name: x.creator, bio: "", fol: 0 };
    return { n: x.number, t: x.title, c: x.category, sub: x.category, d: x.difficulty, time: x.buildTime || "—", cost: x.cost || "—", tags: x.tags || [], by: x.creator, img: x.cover || "", ver: x.version, h: 22 };
  };
  const mapDetail = (d) => Object.assign(mapCard(d), {
    about: d.description, st: d.buildStatus, mcu: dash(d.controller), lang: dash(d.language), sens: dash(d.sensors), act: dash(d.actuators), pw: dash(d.power), com: dash(d.communication),
    bom: (d.components || []).map((c) => [c.name, c.qty, c.spec]), why: d.why, steps: d.steps || [], prob: d.problems, next: d.nextVersion,
    files: (d.files || []).map((f) => f.filename), fileIds: (d.files || []).map((f) => f.id), vid: d.youtubeId,
    hist: (d.history || []).map((h) => ({ v: h.version, note: h.note })),
    likes: d.likes || 0, saves: d.saves || 0, viewer: d.viewer || { liked: false, saved: false }, paths: d.paths || [],
    forkOfNumber: d.forkOfNumber || "", forkOfCreator: d.forkOfCreator || "", forkCount: d.forkCount || 0, allowForks: d.allowForks !== false,
  });
  const mapWiz = (d) => ({
    id: d.id, apiId: d.id, n: d.number || "", t: d.title, about: d.description, c: d.category, d: d.difficulty, time: d.buildTime || "", cost: d.cost || "", st: d.buildStatus,
    mcu: d.controller || "", lang: d.language || "", sens: d.sensors || "—", act: d.actuators || "—", pw: d.power || "—", com: d.communication || "—", tags: d.tags || [], img: d.cover || "",
    bom: d.components && d.components.length ? d.components.map((c) => [c.name, String(c.qty), c.spec]) : [["", "1", ""]],
    why: d.why || "", steps: d.steps || [], prob: d.problems || "", next: d.nextVersion || "",
    files: (d.files || []).map((f) => f.filename + " · " + Math.ceil(f.size / 1024) + " KB"), fileIds: (d.files || []).map((f) => f.id),
    vurl: d.youtubeUrl || "", vid: d.youtubeId || "", ver: d.version, hist: [], ps: PS[d.status] || d.status, by: slug(SESSION.name), note: "",
  });
  const up = (m) => { const i = P.findIndex((x) => x.n === m.n); i < 0 ? P.push(m) : (P[i] = m); };

  // Load what each page needs before it renders
  async function preload(r, id) {
    if (r === "home" || r === "projects") {
      const d = await api("/projects?limit=50");
      P.length = 0;
      d.items.forEach((x) => P.push(mapCard(x)));
      if (r === "home" && P[0]) P[0] = mapDetail(await api("/projects/" + P[0].n));
      if (r === "home") window.FEATURED = (await api("/projects?featured=1&limit=3")).items.map(mapCard);
    } else if (r === "project") {
      try { up(mapDetail(await api("/projects/" + id))); }
      catch (e) { if (e.status === 404) { const i = P.findIndex((x) => x.n === id); if (i >= 0) P.splice(i, 1); } throw e; }
    } else if (r === "creator") {
      const d = await api("/users/" + id);
      U[d.username] = { name: d.displayName, bio: d.bio || "", fol: d.followers || 0 };
      FW[d.username] = !!(d.viewer && d.viewer.following);
      d.projects.forEach((x) => up(mapCard(x)));
    } else if (r === "dashboard" && SESSION && SESSION.creator) {
      const me = slug(SESSION.name);
      MINE = (await api("/projects/mine")).items.map((x) => ({ id: x._id, n: x.number || "", t: x.title, ps: PS[x.status] || x.status, ver: x.version, by: me }));
    } else if (r === "edit" && SESSION && SESSION.creator) {
      MINE = [mapWiz(await api("/projects/" + id))];
    } else if (r === "settings" && SESSION) {
      SET = await api("/users/me");
      SET.keys = (await api("/keys")).items;
      SET.hooks = SESSION.creator ? (await api("/webhooks")).items : null;
    } else if (r === "confirm") {
      try { await api("/auth/confirm-email-change", { method: "POST", body: { token: id } }); CONFIRM = { ok: true }; await loadMe(); acct(); }
      catch (e) { CONFIRM = { error: e.message }; }
    } else if (r === "verify") {
      try { await api("/auth/verify-email", { method: "POST", body: { token: id } }); VERIFY = { ok: true }; await loadMe(); acct(); }
      catch (e) { VERIFY = { error: e.message }; }
    } else if (r === "admin" && isAdmin()) {
      const tab = ADMIN_TABS.some((t) => t[0] === id) ? id : "reports";
      const path = { reports: "/admin/reports", projects: "/admin/projects", users: "/admin/users", learning: "/admin/learning" }[tab];
      ADM = { tab, items: (await api(path)).items };
    } else if (r === "learning") {
      LEARN = (await api("/learning")).items;
    } else if (r === "learn") {
      PATH = await api("/learning/" + id);
    } else if (r === "lesson") {
      const [ps, ls] = id.split("~");
      LESSON = await api("/learning/" + encodeURIComponent(ps) + "/lessons/" + encodeURIComponent(ls || ""));
    } else if (r === "saved" && SESSION) {
      SAVED = (await api("/me/saved")).items.map(mapCard);
    } else if (r === "following" && SESSION) {
      const d = await api("/feed");
      FEED = { items: d.items.map(mapCard), following: d.following };
    } else if (r === "notifications" && SESSION) {
      const d = await api("/notifications");
      NOTES = d.items;
      if (d.unread) { await api("/notifications/read", { method: "POST" }); UNREAD = 0; acct(); }
    }
  }

  const r0 = route;
  route = async function () {
    const mine = ++nav, h = (location.hash || "#home").slice(1);
    let r = h, id = "";
    if (h.startsWith("project-")) { r = "project"; id = h.slice(8); }
    else if (h.startsWith("creator-")) { r = "creator"; id = h.slice(8); }
    else if (h.startsWith("edit-")) { r = "edit"; id = h.slice(5); }
    else if (h.startsWith("learn-")) { r = "learn"; id = h.slice(6); }
    else if (h === "admin" || h.startsWith("admin-")) { r = "admin"; id = h.slice(6); }
    else if (h.startsWith("verify-")) { r = "verify"; id = h.slice(7); }
    else if (h.startsWith("reset-")) { r = "reset"; id = h.slice(6); }
    else if (h.startsWith("confirm-email-")) { r = "confirm"; id = h.slice(14); }
    else if (h.startsWith("lesson-")) { r = "lesson"; id = h.slice(7); }
    const t = setTimeout(() => { if (mine === nav) app.innerHTML = LOAD; }, 200);
    try { await preload(r, id); }
    catch (e) {
      clearTimeout(t);
      if (mine !== nav) return;
      if (e.status !== 404) { app.innerHTML = '<div class="wrap"><div class="sec"><div class="empty">Couldn’t load this page: ' + E(e.message) + ". Reload to try again.</div></div></div>"; return; }
    }
    clearTimeout(t);
    if (mine === nav) { r0(); banner(); }
  };

  // Wizard: autosave to the API
  const toApi = () => ({
    title: W.t, description: W.about, category: W.c, difficulty: +W.d, buildTime: W.time, cost: W.cost, buildStatus: W.st, tags: W.tags,
    controller: W.mcu, language: W.lang,
    components: W.bom.filter((r) => r[0].trim()).map((r) => ({ name: r[0], qty: Math.max(1, parseInt(r[1]) || 1), spec: r[2] })),
    why: W.why, steps: W.steps.filter((s) => s.trim()), problems: W.prob, nextVersion: W.next, youtubeUrl: W.vid ? W.vurl : "",
  });
  const note = (m) => { const s = $("#sa"); if (s) s.textContent = m; };
  async function save() {
    if (!W.apiId) W.apiId = (await api("/projects", { method: "POST", body: toApi() })).id;
    else await api("/projects/" + W.apiId, { method: "PATCH", body: toApi() });
  }
  function flush() {
    clearTimeout(tm);
    q = q.catch(() => {}).then(save).then(() => note("Saved")).catch((e) => note("Not saved: " + e.message));
    return q;
  }
  as = function () { clearTimeout(tm); note("Saving…"); tm = setTimeout(flush, 600); };

  pub = async function () {
    const b = $("#pb");
    if (b) b.disabled = true;
    await flush();
    if (!W.apiId) return;
    try {
      const d = await api("/projects/" + W.apiId + "/publish", { method: "POST", body: W.note ? { note: W.note } : {} });
      location.hash = "project-" + d.number;
    } catch (e) {
      if (!b) return;
      b.disabled = false;
      if (!$("#pe")) b.insertAdjacentHTML("afterend", '<p class="msg" id="pe"></p>');
      $("#pe").textContent = e.details && e.details.missing ? "Missing: " + e.details.missing.join(", ") : e.message;
    }
  };

  // Real uploads: presign -> PUT to storage -> confirm
  async function putFile(f, kind) {
    await flush();
    if (!W.apiId) throw new Error("Couldn’t create the draft");
    const p = await api("/projects/" + W.apiId + "/files/presign", { method: "POST", body: { filename: f.name, size: f.size, contentType: f.type || "application/octet-stream", kind } });
    const r = await fetch(p.uploadUrl, { method: "PUT", headers: p.headers, body: f });
    if (!r.ok) throw new Error("Upload to storage failed");
    await api("/files/" + p.fileId + "/confirm", { method: "POST" });
    return p.fileId;
  }
  const dw0 = dw;
  dw = function () {
    dw0();
    const el = $("#wz");
    if (!el) return;
    const oc = el.onclick;
    el.onclick = async (e) => {
      const b = e.target.closest("button");
      if (b && b.dataset.rf !== undefined) {
        const i = +b.dataset.rf, id = (W.fileIds || [])[i];
        if (id) { try { await api("/files/" + id, { method: "DELETE" }); } catch (x) { return note(x.message); } W.fileIds.splice(i, 1); }
      } else if (b && b.id === "ri" && W.coverFileId) {
        try { await api("/files/" + W.coverFileId, { method: "DELETE" }); } catch (x) { return note(x.message); }
        W.coverFileId = "";
      }
      oc(e);
    };
    const och = el.onchange;
    el.onchange = async (e) => {
      const t = e.target;
      if (t.id === "fc" && t.files[0]) {
        const f = t.files[0];
        try { W.coverFileId = await putFile(f, "cover"); } catch (x) { return note(x.message); }
        img(f, (d) => { W.img = d || URL.createObjectURL(f); dw(); });
      } else if (t.id === "ff") {
        let m = "";
        W.fileIds = W.fileIds || [];
        for (const f of [...t.files]) {
          try { const id = await putFile(f, "file"); W.files.push(f.name + " · " + Math.ceil(f.size / 1024) + " KB"); W.fileIds.push(id); }
          catch (x) { m += f.name + ": " + x.message + ". "; }
        }
        dw();
        $("#fm").textContent = m;
      } else och(e);
    };
  };

  // Community: views, likes, saves, comments, follows
  const needSignIn = () => gate("Sign in to continue.");
  const noteRow = (n) => {
    const title = E(n.projectTitle || "a project");
    const t = { follow: E(n.actor) + " started following you", reply: E(n.actor) + " replied to your comment on " + title, comment: E(n.actor) + " commented on " + title,
      featured: "Your project " + title + " was featured", moderation: "Your project " + title + " was unpublished by a moderator: " + E(n.message || "No reason given.") }[n.type] || "New activity";
    const to = n.type === "follow" ? "#creator-" + n.actor : n.type === "moderation" ? "#dashboard" : "#project-" + n.projectNumber;
    return '<a class="dl" href="' + E(to) + '"><span' + (n.read ? "" : ' style="font-weight:600"') + ">" + t + '</span><span class="num">' + new Date(n.createdAt).toLocaleDateString() + "</span></a>";
  };
  const grid = (items, empty) => (items.length ? '<div class="grid">' + items.map(card).join("") + "</div>" : '<div class="empty">' + empty + "</div>");
  V.saved = () => !SESSION ? needSignIn() : shell("saved", '<h1 style="font-size:2rem">Saved</h1>' + grid(SAVED, "Nothing saved yet. Use Save on a project page."));
  V.following = () => !SESSION ? needSignIn() : shell("following", '<h1 style="font-size:2rem">Following</h1>' +
    (FEED.following.length ? '<p class="lead" style="font-size:1rem">' + FEED.following.map((f) => '<a href="#creator-' + E(f.username) + '" style="color:var(--p)">' + E(f.displayName) + "</a>").join(", ") + "</p>" : "") +
    grid(FEED.items, "Follow creators from their profile page to see their latest projects here."));
  V.notifications = () => !SESSION ? needSignIn() : shell("notifications", '<h1 style="font-size:2rem">Notifications</h1>' +
    (NOTES.length ? NOTES.map(noteRow).join("") : '<div class="empty">Nothing yet. Comments, replies and new followers show up here.</div>'));

  // Learning: paths, lessons, progress
  const lvl = (l) => '<span class="tag">' + E(l) + "</span>";
  const bar = (a, b) => '<div class="pb" role="progressbar" aria-valuenow="' + a + '" aria-valuemin="0" aria-valuemax="' + b + '"><i style="width:' + (b ? Math.round((a / b) * 100) : 0) + '%"></i></div>';
  V.learning = () => '<div class="wrap"><div class="sec"><h1 style="font-size:2.4rem">Learning</h1><p class="lead">Learn by building. Each path pairs lessons with real projects.</p><div class="paths" style="margin-top:20px">' +
    LEARN.map((p) => '<a class="path" href="#learn-' + E(p.slug) + '"><span class="num">Path ' + String(p.order).padStart(2, "0") + "</span><b>" + E(p.title) + "</b>" + lvl(p.level) +
      '<div style="color:var(--mute);font-size:.9rem;margin-top:6px">' + E(p.summary) + '</div><div class="mono" style="color:var(--mute);margin-top:8px">' + (p.lessons ? p.lessons + " lessons" : "Lessons coming soon") + " · " + p.projects + (p.projects === 1 ? " project" : " projects") + "</div>" +
      (p.signedIn && p.lessons ? bar(p.done, p.lessons) : "") + "</a>").join("") + "</div></div></div>";
  V.learn = () => {
    if (!PATH) return nf();
    const p = PATH, g = p.progress;
    return '<div class="wrap"><div class="sec"><a href="#learning" style="color:var(--mute)">Learning</a><h1 style="font-size:2.4rem;margin-top:8px">' + E(p.title) + '</h1><p class="lead">' + E(p.summary) + "</p>" + lvl(p.level) +
      (p.signedIn && g.lessonsTotal ? '<div style="max-width:420px;margin-top:16px"><div class="mono">' + g.lessonsDone + " / " + g.lessonsTotal + " lessons · " + g.projectsDone + " / " + g.projectsTotal + " projects built</div>" + bar(g.lessonsDone, g.lessonsTotal) + "</div>" : "") +
      '<h2 style="margin-top:32px">Lessons</h2>' +
      (p.lessons.length ? p.lessons.map((l, i) => '<a class="dl" href="#lesson-' + E(p.slug + "~" + l.slug) + '"><span><span class="num">' + String(i + 1).padStart(2, "0") + "</span> " + E(l.title) + ' <small style="color:var(--mute)">' + l.minutes + " min</small></span>" + (l.done ? '<span class="tag">Done</span>' : "") + "</a>").join("") : '<div class="empty">Lessons for this path are coming soon.</div>') +
      '<h2 style="margin-top:32px">Projects</h2>' +
      (p.projects.length ? '<div class="grid">' + p.projects.map((x) => '<div style="display:flex;flex-direction:column;gap:8px">' + card(mapCard(x)) + (p.signedIn ? '<button class="btn sm" data-pc="' + E(x.number) + '" data-done="' + x.done + '">' + (x.done ? "Built. Undo" : "Mark as built") + "</button>" : "") + "</div>").join("") + "</div>" : '<div class="empty">No projects are linked to this path yet.</div>') +
      "</div></div>";
  };
  V.lesson = () => {
    if (!LESSON) return nf();
    const l = LESSON, p = l.path, go = (x) => "#lesson-" + E(p.slug + "~" + x.slug);
    return '<div class="wrap"><div class="sec" style="max-width:760px"><a href="#learn-' + E(p.slug) + '" style="color:var(--mute)">' + E(p.title) + '</a><span class="num" style="display:block;margin-top:14px">Lesson ' + l.index + " of " + l.total + " · " + l.minutes + ' min</span><h1 style="font-size:2.2rem">' + E(l.title) + "</h1>" +
      l.body.split(/\n\s*\n/).map((t) => '<p style="max-width:68ch">' + E(t) + "</p>").join("") +
      '<div class="row" style="margin:24px 0"><button class="btn' + (l.done ? "" : " pri") + '" id="lc">' + (l.done ? "Completed. Undo" : "Mark complete") + "</button></div>" +
      '<div class="row">' + (l.prev ? '<a class="btn" href="' + go(l.prev) + '">Previous: ' + E(l.prev.title) + "</a>" : "") + (l.next ? '<a class="btn" href="' + go(l.next) + '">Next: ' + E(l.next.title) + "</a>" : "") + "</div></div></div>";
  };

  // Account emails: verification banner, forgot and reset password, verify link
  function banner() {
    if (!SESSION || SESSION.emailVerified !== false) return;
    app.insertAdjacentHTML("afterbegin", '<div class="wrap" id="vbar"><div class="cm">Your email address isn’t verified yet. Check your inbox for the link. <button class="btn sm" id="vresend">Resend email</button> <span id="vmsg" role="status"></span></div></div>');
    $("#vresend").onclick = async () => {
      try {
        const d = await api("/auth/resend-verification", { method: "POST" });
        $("#vmsg").textContent = d.verified ? "Already verified." : "Sent.";
        if (d.verified) { await loadMe(); acct(); }
      } catch (x) { $("#vmsg").textContent = x.message; }
    };
  }
  const card1 = (inner) => '<div class="wrap"><div class="auth">' + inner + "</div></div>";
  const wide = ' style="width:100%;justify-content:center"';
  V.forgot = () => card1('<h2>Reset your password</h2><p>Enter the email address for your account. If it has an account, a reset link is on its way.</p><div class="field"><label for="fe">Email</label><input id="fe" type="email" autocomplete="email"></div><p class="msg" id="fmsg" role="status"></p><button class="btn pri" id="fgo"' + wide + ">Send reset link</button>");
  V.reset = () => card1('<h2>Choose a new password</h2><div class="field"><label for="np">New password</label><input id="np" type="password" autocomplete="new-password"></div><div class="field"><label for="np2">Repeat password</label><input id="np2" type="password" autocomplete="new-password"></div><p class="msg" id="rmsg" role="alert"></p><button class="btn pri" id="rgo"' + wide + ">Save new password</button>");
  V.verify = () => card1(VERIFY && VERIFY.ok ? '<h2>Email verified</h2><p>Your email address is confirmed.</p><a class="btn pri" href="#home">Continue</a>' : "<h2>Link not valid</h2><p>" + E((VERIFY && VERIFY.error) || "This link is invalid or has expired.") + '</p><a class="btn" href="#home">Back to home</a>');

  // Settings: profile, password, email
  const EVLABEL = { "project.published": "Project published", "comment.created": "Comment on my project", "user.followed": "New follower" };
  const keyRows = () => SET.keys.length ? SET.keys.map((k) => '<div class="dl"><span>' + E(k.name) + ' <small style="color:var(--mute)">' + E(k.prefix) + "… · " + (k.scope === "write" ? "read and write" : "read only") + " · " + (k.lastUsedAt ? "used " + when(k.lastUsedAt) : "never used") + '</small></span><button class="btn sm" data-s="key-revoke" data-i="' + k.id + '">Revoke</button></div>').join("") : '<div class="empty">No keys yet.</div>';
  const hookRows = () => SET.hooks.length ? SET.hooks.map((h) => '<div class="dl" style="flex-wrap:wrap"><span style="min-width:0;overflow-wrap:anywhere">' + E(h.url) + '<br><small style="color:var(--mute)">' + h.events.map((e) => E(EVLABEL[e] || e)).join(", ") + " · " + (h.active ? "active" : "paused") + (h.lastStatus ? " · last: " + E(h.lastStatus) : "") + '</small></span><span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-s="wh-test" data-i="' + h.id + '">Send test</button><button class="btn sm" data-s="wh-toggle" data-i="' + h.id + '" data-on="' + !h.active + '">' + (h.active ? "Pause" : "Resume") + '</button><button class="btn sm" data-s="wh-del" data-i="' + h.id + '">Delete</button></span></div>').join("") : '<div class="empty">No webhooks yet.</div>';
  const secretBox = (title, value) => '<div class="cm"><b>' + title + '</b><p class="code" style="padding:10px;overflow-wrap:anywhere;font-size:.85rem">' + E(value) + "</p></div>";
  function devSections() {
    return '<h2 style="margin-top:32px">API keys</h2><div data-sec style="max-width:520px"><p style="color:var(--mute)">Keys let scripts act as you. A key is shown once, so copy it when you make it.</p><div id="keylist">' + keyRows() + "</div>" + fld("name", "Key name", "") +
      '<div class="field"><label>Access<select data-f="scope"><option value="read">Read only</option><option value="write">Read and write</option></select></label></div><button class="btn pri" data-s="key">Create key</button> <span data-m role="status"></span><div id="newkey"></div></div>' +
      (SET.hooks ? '<h2 style="margin-top:32px">Webhooks</h2><div data-sec style="max-width:520px"><p style="color:var(--mute)">Idevrx calls your server when something happens. Public https addresses only. Verify the signature on every delivery.</p><div id="hooklist">' + hookRows() + "</div>" + fld("url", "Address", "", "url") +
        '<fieldset style="border:0;padding:0;margin:0 0 14px"><legend style="font-weight:600;font-size:.9rem">Events</legend>' + Object.keys(EVLABEL).map((e) => '<label style="display:block"><input type="checkbox" data-ev="' + e + '" checked style="width:auto"> ' + E(EVLABEL[e]) + "</label>").join("") + '</fieldset><button class="btn pri" data-s="wh-add">Add webhook</button> <span data-m role="status"></span><div id="newhook"></div></div>' : "");
  }
  V.confirm = () => card1(CONFIRM && CONFIRM.ok ? '<h2>Email updated</h2><p>Your new email address is confirmed. Sign in with it from now on.</p><a class="btn pri" href="#settings">Back to settings</a>' : "<h2>Link not valid</h2><p>" + E((CONFIRM && CONFIRM.error) || "This link is invalid or has expired.") + '</p><a class="btn" href="#settings">Back to settings</a>');
  V.settings = () => !SESSION || !SET ? needSignIn() : shell("settings", '<h1 style="font-size:2rem">Settings</h1>' +
    '<h2>Profile</h2><div data-sec style="max-width:520px"><p class="num">Username: ' + E(SET.username) + "</p>" + fld("displayName", "Display name", SET.displayName) +
    '<div class="field"><label>Bio<textarea data-f="bio" rows="3" maxlength="500">' + E(SET.bio) + '</textarea></label></div><button class="btn pri" data-s="profile">Save profile</button> <span data-m role="status"></span></div>' +
    '<h2 style="margin-top:32px">Password</h2><div data-sec style="max-width:520px">' + fld("currentPassword", "Current password", "", "password") + fld("newPassword", "New password", "", "password") + fld("repeat", "Repeat new password", "", "password") +
    '<button class="btn pri" data-s="password">Change password</button> <span data-m role="status"></span><p style="color:var(--mute);font-size:.9rem">Changing your password signs you out on every other device.</p></div>' +
    '<h2 style="margin-top:32px">Email</h2><div data-sec style="max-width:520px"><p>Current address: <b>' + E(SET.email) + "</b> (" + (SET.emailVerified ? "verified" : "not verified") + ")</p>" + fld("email", "New email address", "", "email") + fld("password", "Your password", "", "password") +
    '<button class="btn pri" data-s="email">Send confirmation link</button> <span data-m role="status"></span></div>' + devSections());
  async function settingsClick(e) {
    const b = e.target.closest("[data-s]");
    if (!b) return;
    const sec = b.closest("[data-sec]"), v = vals(sec), msg = sec.querySelector("[data-m]");
    const say = (t, good) => { msg.style.color = good ? "var(--s)" : "#A32B22"; msg.textContent = t; };
    try {
      if (b.dataset.s === "profile") {
        await api("/users/me", { method: "PATCH", body: { displayName: v.displayName, bio: v.bio } });
        say("Saved.", true);
      } else if (b.dataset.s === "password") {
        if (v.newPassword.length < 8) return say("Use at least 8 characters.");
        if (v.newPassword !== v.repeat) return say("The two passwords don’t match.");
        const d = await api("/auth/change-password", { method: "POST", body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
        TOKEN = d.token;
        try { localStorage.setItem("idevrx_token", TOKEN); } catch (x) {}
        sec.querySelectorAll("input").forEach((i) => (i.value = ""));
        say("Password changed. Other devices were signed out.", true);
      } else if (b.dataset.s === "key") {
        const d = await api("/keys", { method: "POST", body: { name: v.name, scope: v.scope } });
        SET.keys = (await api("/keys")).items;
        $("#keylist").innerHTML = keyRows();
        sec.querySelector("[data-f=name]").value = "";
        $("#newkey").innerHTML = secretBox("Copy this key now. It won’t be shown again.", d.key);
        say("Key created.", true);
      } else if (b.dataset.s === "key-revoke") {
        await api("/keys/" + b.dataset.i, { method: "DELETE" });
        SET.keys = (await api("/keys")).items;
        $("#keylist").innerHTML = keyRows();
      } else if (b.dataset.s === "wh-add") {
        const events = [...sec.querySelectorAll("[data-ev]:checked")].map((i) => i.dataset.ev);
        const d = await api("/webhooks", { method: "POST", body: { url: v.url, events } });
        SET.hooks = (await api("/webhooks")).items;
        $("#hooklist").innerHTML = hookRows();
        sec.querySelector("[data-f=url]").value = "";
        $("#newhook").innerHTML = secretBox("Signing secret. Copy it now, it won’t be shown again.", d.secret);
        say("Webhook added.", true);
      } else if (b.dataset.s === "wh-test") {
        const d = await api("/webhooks/" + b.dataset.i + "/test", { method: "POST" });
        say(d.ok ? "Test delivered (" + d.status + ")." : "Test failed: " + d.status, d.ok);
        SET.hooks = (await api("/webhooks")).items;
        $("#hooklist").innerHTML = hookRows();
      } else if (b.dataset.s === "wh-toggle") {
        await api("/webhooks/" + b.dataset.i, { method: "PATCH", body: { active: b.dataset.on === "true" } });
        SET.hooks = (await api("/webhooks")).items;
        $("#hooklist").innerHTML = hookRows();
      } else if (b.dataset.s === "wh-del") {
        if (!confirm("Delete this webhook?")) return;
        await api("/webhooks/" + b.dataset.i, { method: "DELETE" });
        SET.hooks = (await api("/webhooks")).items;
        $("#hooklist").innerHTML = hookRows();
      } else {
        await api("/auth/change-email", { method: "POST", body: { email: v.email, password: v.password } });
        sec.querySelectorAll("input").forEach((i) => (i.value = ""));
        say("If that address is available, a confirmation link is on its way. Your email changes after you click it.", true);
      }
    } catch (x) { say(x.message); }
  }

  // Reports: a small inline form under the project buttons or a comment
  function reportForm(type, target, anchor) {
    const old = $("#rform");
    if (old) old.remove();
    anchor.insertAdjacentHTML("afterend", '<div id="rform" class="cm"><div class="field"><label for="rr">Reason</label><select id="rr"><option value="spam">Spam</option><option value="unsafe">Unsafe or dangerous instructions</option><option value="copyright">Copyright</option><option value="harassment">Harassment</option><option value="other">Something else</option></select></div><div class="field"><label for="rd">Details (optional)</label><textarea id="rd" rows="2" maxlength="500"></textarea></div><button class="btn pri" id="rs">Send report</button> <button class="btn" id="rx">Cancel</button><p class="msg" id="rm"></p></div>');
    $("#rx").onclick = () => $("#rform").remove();
    $("#rs").onclick = async () => {
      try { await api("/reports", { method: "POST", body: { type, target, reason: $("#rr").value, details: $("#rd").value.trim() } }); $("#rform").innerHTML = "<p>Thanks. A moderator will review this.</p>"; }
      catch (x) { $("#rm").textContent = x.message; }
    };
  }

  // Admin screens: reports, projects, users, learning content
  const ADMIN_TABS = [["reports", "Reports"], ["projects", "Projects"], ["users", "Users"], ["learning", "Learning"]], LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"];
  let ADM = { tab: "reports", items: [] };
  function isAdmin() { return !!SESSION && SESSION.role === "admin"; }
  const when = (d) => new Date(d).toLocaleDateString();
  const fld = (f, label, val, type) => '<div class="field"><label>' + label + '<input data-f="' + f + '"' + (type ? ' type="' + type + '"' : "") + ' value="' + E(val) + '"></label></div>';
  const lvlSel = (v) => '<div class="field"><label>Level<select data-f="level">' + LEVELS.map((l) => "<option" + (l === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label></div>";
  const reportRows = (items) => items.length ? items.map((x) => '<div class="cm"><b>' + (x.type === "comment" ? "Comment" : "Project") + "</b> · " + E(x.reason) + " · by " + E(x.reporter) + " · " + when(x.createdAt) +
    '<p style="margin:4px 0">' + E(x.snapshot) + (x.details ? "<br><small>“" + E(x.details) + "”</small>" : "") + '</p><a class="btn sm" href="#project-' + E(x.projectNumber || "") + '">Open project</a> ' +
    (x.type === "project" ? '<button class="btn sm" data-a="r-unpub" data-i="' + x.id + '" data-p="' + x.projectId + '">Unpublish</button> ' : '<button class="btn sm" data-a="r-delc" data-i="' + x.id + '" data-c="' + x.commentId + '">Delete comment</button> ') +
    '<button class="btn sm" data-a="r-ok" data-i="' + x.id + '">Mark resolved</button> <button class="btn sm" data-a="r-no" data-i="' + x.id + '">Dismiss</button></div>').join("") : '<div class="empty">No open reports.</div>';
  const projRows = (items) => items.length ? '<div style="overflow-x:auto"><table class="tbl"><tr><th>Project</th><th>Creator</th><th>Status</th><th></th></tr>' + items.map((p) => "<tr><td>" + (p.number ? '<a href="#project-' + E(p.number) + '" style="color:var(--p)">' + E(p.number) + "</a> " : "") + E(p.title || "Untitled") + "</td><td>" + E(p.creator) + '</td><td><span class="tag">' + E(p.status) + (p.featured ? " · featured" : "") + '</span></td><td style="text-align:right;white-space:nowrap">' +
    (p.status === "PUBLISHED" ? '<button class="btn sm" data-a="p-feat" data-i="' + p.id + '" data-on="' + !p.featured + '">' + (p.featured ? "Unfeature" : "Feature") + '</button> <button class="btn sm" data-a="p-unpub" data-i="' + p.id + '">Unpublish</button>' : "") + "</td></tr>").join("") + "</table></div>" : '<div class="empty">No projects found.</div>';
  const userRows = (items) => items.length ? '<div style="overflow-x:auto"><table class="tbl"><tr><th>User</th><th>Role</th><th>Status</th><th></th></tr>' + items.map((u) => "<tr><td><b>" + E(u.username) + "</b><br><small>" + E(u.email) + '</small></td><td><select data-a="u-role" data-i="' + u.id + '" aria-label="Role for ' + E(u.username) + '">' + ["user", "creator", "admin"].map((r) => "<option" + (r === u.role ? " selected" : "") + ">" + r + "</option>").join("") + '</select></td><td><span class="tag">' + (u.suspended ? "suspended" : "active") + '</span></td><td style="text-align:right">' +
    (u.role === "admin" ? "" : '<button class="btn sm" data-a="u-susp" data-i="' + u.id + '" data-on="' + !u.suspended + '">' + (u.suspended ? "Restore" : "Suspend") + "</button>") + "</td></tr>").join("") + "</table></div>" : '<div class="empty">No users found.</div>';
  const lessonBox = (l) => '<details style="margin-left:16px"><summary>' + E(l.title) + '</summary><div data-box data-i="' + l.id + '" class="cm">' + fld("title", "Title", l.title) + '<div class="g2">' + fld("minutes", "Minutes", l.minutes, "number") + fld("order", "Order", l.order, "number") + '</div><div class="field"><label>Body (blank line between paragraphs)<textarea data-f="body" rows="6">' + E(l.body) + '</textarea></label></div><button class="btn pri" data-a="ls-save">Save lesson</button> <button class="btn" data-a="ls-del">Delete</button></div></details>';
  const learnAdmin = (items) => '<details><summary><b>New learning path</b></summary><div data-box class="cm">' + fld("title", "Title", "") + fld("summary", "Summary", "") + lvlSel("Beginner") + '<button class="btn pri" data-a="lp-new">Create path</button></div></details>' +
    items.map((p) => '<details class="cm"><summary><b>' + E(p.title) + "</b> · " + E(p.level) + (p.published ? "" : " · hidden") + " · " + p.lessons.length + ' lessons</summary><div data-box data-s="' + E(p.slug) + '">' + fld("title", "Title", p.title) + fld("summary", "Summary", p.summary) + '<div class="g2">' + lvlSel(p.level) + fld("order", "Order", p.order, "number") + "</div>" +
      fld("projectNumbers", "Linked project numbers, comma separated", p.projectNumbers.join(", ")) + '<label><input type="checkbox" data-f="published" style="width:auto"' + (p.published ? " checked" : "") + '> Published</label><p><button class="btn pri" data-a="lp-save">Save path</button></p></div>' +
      p.lessons.map(lessonBox).join("") + '<div data-box data-s="' + E(p.slug) + '" class="cm"><b>Add a lesson</b>' + fld("title", "Title", "") + '<div class="field"><label>Body<textarea data-f="body" rows="4"></textarea></label></div><button class="btn" data-a="ls-new">Add lesson</button></div></details>').join("");
  const adminBody = () => ADM.tab === "reports" ? reportRows(ADM.items) : ADM.tab === "projects" ? projRows(ADM.items) : ADM.tab === "users" ? userRows(ADM.items) : learnAdmin(ADM.items);
  V.admin = () => !isAdmin() ? '<div class="wrap"><div class="sec"><div class="empty">Admin access only.</div></div></div>' : shell("admin", '<h1 style="font-size:2rem">Admin</h1><div class="chips">' +
    ADMIN_TABS.map((t) => '<a class="chip" href="#admin-' + t[0] + '" aria-pressed="' + (ADM.tab === t[0]) + '">' + t[1] + "</a>").join("") + "</div>" +
    (ADM.tab === "projects" || ADM.tab === "users" ? '<div class="field"><label for="aq">Search</label><input id="aq" type="search"></div>' : "") + '<div id="abody">' + adminBody() + "</div>");
  function vals(box) {
    const o = {};
    box.querySelectorAll("[data-f]").forEach((el) => {
      const f = el.dataset.f;
      o[f] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : f === "projectNumbers" ? el.value.split(/[\s,]+/).filter(Boolean) : el.value;
    });
    return o;
  }
  async function adminClick(e) {
    const b = e.target.closest("[data-a]");
    if (!b || b.tagName === "SELECT") return;
    const a = b.dataset.a, id = b.dataset.i, box = b.closest("[data-box]"), resolve = () => api("/admin/reports/" + id, { method: "PATCH", body: { status: "resolved" } });
    try {
      if (a === "r-ok" || a === "r-no") await api("/admin/reports/" + id, { method: "PATCH", body: { status: a === "r-ok" ? "resolved" : "dismissed" } });
      else if (a === "r-unpub") { const note = prompt("Note to the creator (optional):"); if (note === null) return; await api("/admin/projects/" + b.dataset.p + "/unpublish", { method: "POST", body: { note } }); await resolve(); }
      else if (a === "r-delc") { if (!confirm("Delete this comment and its replies?")) return; await api("/comments/" + b.dataset.c, { method: "DELETE" }); await resolve(); }
      else if (a === "p-feat") await api("/admin/projects/" + id + "/feature", { method: b.dataset.on === "true" ? "PUT" : "DELETE" });
      else if (a === "p-unpub") { const note = prompt("Note to the creator (optional):"); if (note === null) return; await api("/admin/projects/" + id + "/unpublish", { method: "POST", body: { note } }); }
      else if (a === "u-susp") await api("/admin/users/" + id + "/suspend", { method: "PATCH", body: { suspended: b.dataset.on === "true" } });
      else if (a === "lp-new") await api("/learning", { method: "POST", body: vals(box) });
      else if (a === "lp-save") await api("/learning/" + box.dataset.s, { method: "PATCH", body: vals(box) });
      else if (a === "ls-new") await api("/learning/" + box.dataset.s + "/lessons", { method: "POST", body: vals(box) });
      else if (a === "ls-save") await api("/learning/lessons/" + box.dataset.i, { method: "PATCH", body: vals(box) });
      else if (a === "ls-del") { if (!confirm("Delete this lesson and its progress?")) return; await api("/learning/lessons/" + box.dataset.i, { method: "DELETE" }); }
      else return;
    } catch (x) { alert(x.message); return; }
    route();
  }
  async function adminChange(e) {
    const s = e.target.closest('[data-a="u-role"]');
    if (!s) return;
    try { await api("/users/" + s.dataset.i + "/role", { method: "PATCH", body: { role: s.value } }); } catch (x) { alert(x.message); }
    route();
  }

  // Phase 5: file viewers, fork attribution, version comparison
  const VIEW_TEXT = ["ino", "py", "cpp", "c", "h", "md", "txt", "csv", "json"], PLAIN = ["md", "txt", "csv", "json"];
  const FL = { title: "Title", description: "Description", category: "Category", difficulty: "Difficulty", buildTime: "Build time", cost: "Cost", buildStatus: "Build status", controller: "Controller", language: "Language", sensors: "Sensors", actuators: "Actuators", power: "Power", communication: "Communication", why: "Why I built it", problems: "Problems", nextVersion: "Next version", youtubeUrl: "Video" };
  async function raw(path) {
    const r = await fetch("/api" + path, { headers: TOKEN ? { Authorization: "Bearer " + TOKEN } : {} });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "Couldn’t load the file"); }
    return r;
  }
  const dlist = (title, items) => (items.length ? "<h4>" + title + "</h4><ul>" + items.map((t) => "<li>" + t + "</li>").join("") + "</ul>" : "");
  const cdesc = (c) => E(c.qty + " × " + c.name) + (c.spec ? " (" + E(c.spec) + ")" : "");
  function diffHtml(d) {
    if (d.identical) return '<div class="empty">No differences between v' + E(d.from) + " and v" + E(d.to) + ".</div>";
    return (d.changes.length ? '<div style="overflow-x:auto"><table class="tbl"><tr><th>Field</th><th>v' + E(d.from) + "</th><th>v" + E(d.to) + "</th></tr>" + d.changes.map((c) => "<tr><td>" + E(FL[c.field] || c.field) + "</td><td>" + E(c.from) + "</td><td>" + E(c.to) + "</td></tr>").join("") + "</table></div>" : "") +
      dlist("Tags", d.tags.added.map((t) => "+ " + E(t)).concat(d.tags.removed.map((t) => "− " + E(t)))) +
      dlist("Components", d.components.added.map((c) => "+ " + cdesc(c)).concat(d.components.removed.map((c) => "− " + cdesc(c)), d.components.changed.map((c) => "~ " + cdesc(c.from) + " → " + cdesc(c.to)))) +
      dlist("Build steps", d.steps.added.map((s) => "+ " + E(s)).concat(d.steps.removed.map((s) => "− " + E(s))));
  }
  function extras(p) {
    const eng = $("#eng");
    if (eng && p.forkCount) eng.insertAdjacentHTML("afterend", '<p style="color:var(--mute)">' + p.forkCount + (p.forkCount === 1 ? " fork" : " forks") + "</p>");
    if (eng && p.forkOfNumber) eng.insertAdjacentHTML("afterend", '<p style="color:var(--mute)">Fork of <a href="#project-' + E(p.forkOfNumber) + '" style="color:var(--p)">Project ' + E(p.forkOfNumber) + "</a> by " + E(p.forkOfCreator) + "</p>");

    const dm = $("#dm");
    if (dm) dm.insertAdjacentHTML("afterend", '<div id="vw"></div>');
    document.querySelectorAll("#s6 .dl").forEach((row, i) => {
      const name = p.files[i] || "", ext = name.split(".").pop().toLowerCase();
      if (!VIEW_TEXT.includes(ext) && ext !== "stl") return;
      const dl = row.querySelector("[data-dl]"), view = document.createElement("button"), wrap = document.createElement("span");
      view.className = "btn sm"; view.textContent = "View";
      wrap.style.cssText = "display:flex;gap:8px";
      dl.replaceWith(wrap); wrap.append(view, dl);
      view.onclick = async () => {
        const box = $("#vw");
        box.innerHTML = '<div class="empty">Loading…</div>';
        try {
          const resp = await raw("/files/" + p.fileIds[i] + "/content");
          if (ext === "stl") {
            const tris = Viewers.parseStl(await resp.arrayBuffer());
            if (!tris) throw new Error("This STL file couldn’t be read");
            box.innerHTML = '<h3 style="margin:16px 0 8px">' + E(name) + '</h3><canvas class="stl" tabindex="0" aria-label="3D preview of ' + E(name) + '. Drag or use the arrow keys to rotate."></canvas><p class="mono" id="stlinfo" style="color:var(--mute)"></p><button class="btn sm" id="stlreset">Reset view</button>';
            const v = Viewers.mountStl(box.querySelector("canvas"), tris);
            $("#stlinfo").textContent = v.total + " triangles" + (v.shown < v.total ? " (preview shows " + v.shown + ")" : "") + ". Drag to rotate, scroll to zoom.";
            $("#stlreset").onclick = v.reset;
          } else {
            const text = await resp.text();
            box.innerHTML = '<h3 style="margin:16px 0 8px">' + E(name) + '</h3><pre class="code" tabindex="0"><code>' + (PLAIN.includes(ext) ? E(text) : Viewers.hl(text, ext)) + "</code></pre>";
          }
        } catch (x) { box.innerHTML = '<div class="empty">' + E(x.message) + "</div>"; }
      };
    });

    const sec = $("#s8");
    if (sec && p.hist.length >= 2) {
      const opts = p.hist.map((h) => '<option value="' + E(h.v) + '">v' + E(h.v) + "</option>").join("");
      sec.insertAdjacentHTML("beforeend", '<h3 style="margin-top:16px">Compare versions</h3><div class="row" style="align-items:end"><div class="field" style="margin:0"><label for="cf">From</label><select id="cf">' + opts + '</select></div><div class="field" style="margin:0"><label for="ct">To</label><select id="ct">' + opts + '</select></div><button class="btn" id="cgo">Compare</button></div><div id="cout" style="margin-top:12px"></div>');
      $("#cf").selectedIndex = p.hist.length - 2;
      $("#ct").selectedIndex = p.hist.length - 1;
      $("#cgo").onclick = async () => {
        try { $("#cout").innerHTML = diffHtml(await api("/projects/" + p.n + "/compare?from=" + encodeURIComponent($("#cf").value) + "&to=" + encodeURIComponent($("#ct").value))); }
        catch (x) { $("#cout").innerHTML = '<div class="empty">' + E(x.message) + "</div>"; }
      };
    }
  }

  function engage(p) {
    const el = $("#eng");
    if (!el) return;
    const draw = () => {
      el.innerHTML = '<button class="btn" id="lk" aria-pressed="' + p.viewer.liked + '">' + (p.viewer.liked ? "Liked" : "Like") + " · " + p.likes + '</button><button class="btn" id="sv" aria-pressed="' + p.viewer.saved + '">' + (p.viewer.saved ? "Saved" : "Save") + " · " + p.saves + '</button><button class="btn" id="cp">Copy link</button>' + (SESSION && SESSION.creator && p.allowForks ? '<button class="btn" id="fk">Fork project</button>' : "") + (SESSION && p.by !== slug(SESSION.name) ? '<button class="btn" id="rp">Report</button>' : "");
    };
    draw();
    el.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.id === "cp") {
        try { await navigator.clipboard.writeText(location.href); b.textContent = "Link copied"; } catch (x) { b.textContent = "Copy failed"; }
        return;
      }
      if (!SESSION) { location.hash = "login"; return; }
      if (b.id === "rp") { reportForm("project", p.n, el); return; }
      if (b.id === "fk") {
        try { location.hash = "edit-" + (await api("/projects/" + p.n + "/fork", { method: "POST" })).id; } catch (x) { alert(x.message); }
        return;
      }
      const k = b.id === "lk" ? ["like", "liked", "likes"] : ["save", "saved", "saves"];
      try {
        const d = await api("/projects/" + p.n + "/" + k[0], { method: p.viewer[k[1]] ? "DELETE" : "PUT" });
        p.viewer[k[1]] = d[k[1]]; p[k[2]] = d.count; draw();
      } catch (x) { alert(x.message); }
    };
  }

  function comments(p) {
    const box = $("#cm");
    if (!box) return;
    let items = [], replyTo = "";
    const row = (c, reply) => '<div class="cm' + (reply ? " r" : "") + '"><b><a href="#creator-' + E(c.author) + '">' + E(c.author) + "</a></b> <small>" + new Date(c.createdAt).toLocaleDateString() + '</small><p style="margin:4px 0">' + E(c.body).replace(/\n/g, "<br>") + "</p>" +
      (SESSION && !reply ? '<button class="btn sm" data-rp="' + c.id + '">Reply</button> ' : "") + (SESSION && c.author !== SESSION.name ? '<button class="btn sm" data-rc="' + c.id + '">Report</button> ' : "") + (c.canDelete ? '<button class="btn sm" data-dc="' + c.id + '">Delete</button>' : "") + "</div>";
    const draw = () => {
      const top = items.filter((c) => !c.parent);
      box.innerHTML = (top.length ? top.map((c) => row(c, false) + items.filter((x) => x.parent === c.id).map((x) => row(x, true)).join("")).join("") : '<div class="empty">No comments yet. Ask a technical question or share a result.</div>') +
        (SESSION ? '<div class="field" style="margin-top:16px"><label for="cb">' + (replyTo ? "Reply" : "Add a comment") + '</label><textarea id="cb" rows="3" maxlength="2000"></textarea></div><button class="btn pri" id="cpost">Post</button> ' + (replyTo ? '<button class="btn" id="ccancel">Cancel reply</button>' : "") + '<p class="msg" id="cerr"></p>' : '<p><a href="#login" style="color:var(--p)">Sign in</a> to comment.</p>');
    };
    const load = async () => {
      try { items = (await api("/projects/" + p.n + "/comments")).items; } catch (x) { box.textContent = x.message; return; }
      draw();
    };
    box.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.rp) { replyTo = b.dataset.rp; draw(); $("#cb").focus(); }
      else if (b.id === "ccancel") { replyTo = ""; draw(); }
      else if (b.dataset.rc) { reportForm("comment", b.dataset.rc, b.closest(".cm")); }
      else if (b.dataset.dc) { try { await api("/comments/" + b.dataset.dc, { method: "DELETE" }); await load(); } catch (x) { alert(x.message); } }
      else if (b.id === "cpost") {
        const t = $("#cb").value.trim();
        if (!t) return;
        try { await api("/projects/" + p.n + "/comments", { method: "POST", body: replyTo ? { body: t, parent: replyTo } : { body: t } }); replyTo = ""; await load(); }
        catch (x) { $("#cerr").textContent = x.message; }
      }
    };
    load();
  }

  // Page wiring
  const w1 = wire;
  wire = function (r, id) {
    w1(r, id);
    const g = $("#gc");
    if (g) {
      if (g.nextElementSibling) g.nextElementSibling.remove();
      g.onclick = async () => {
        try { const d = await api("/users/me/become-creator", { method: "POST" }); await loadMe(); if (d.message) alert(d.message); route(); }
        catch (x) { alert(x.message); }
      };
    }
    if (r === "login") {
      const n = document.querySelector(".auth p.mono"); if (n) n.remove();
      $("#go").insertAdjacentHTML("afterend", '<p style="margin:12px 0 0"><a href="#forgot" style="color:var(--p)">Forgot your password?</a></p>');
      $("#go").onclick = async () => {
        const signup = !$("#fn").hidden, er = $("#er"), em = $("#em").value.trim(), pw = $("#pw").value, nm = $("#nm").value.trim();
        er.textContent = "";
        try {
          const d = await api(signup ? "/auth/register" : "/auth/login", { method: "POST", body: signup ? { username: nm, email: em, password: pw } : { identifier: em, password: pw } });
          TOKEN = d.token;
          try { localStorage.setItem("idevrx_token", TOKEN); } catch (e) {}
          SESSION = sess(d.user); await loadMe(); acct(); location.hash = "home";
        } catch (e) {
          const f = e.details && e.details.fieldErrors ? Object.values(e.details.fieldErrors)[0] : null;
          er.textContent = (f && f[0]) || e.message;
        }
      };
    }
    if (r === "project") {
      const p = P.find((x) => x.n === id);
      document.querySelectorAll("[data-dl]").forEach((b, i) => (b.onclick = async () => {
        try { location.href = (await api("/files/" + p.fileIds[i] + "/download")).url; } catch (x) { $("#dm").textContent = x.message; }
      }));
    }
    if (r === "project") { const p = P.find((x) => x.n === id); if (p && p.viewer) { engage(p); comments(p); if (p.paths && p.paths.length) $("#eng").insertAdjacentHTML("afterend", '<p style="color:var(--mute)">Part of: ' + p.paths.map((x) => '<a href="#learn-' + E(x.slug) + '" style="color:var(--p)">' + E(x.title) + "</a>").join(", ") + "</p>"); } }
    if (r === "creator") {
      const fw = $("#fw"), key = id.toLowerCase();
      if (fw && !(SESSION && SESSION.name === key)) {
        fw.innerHTML = '<button class="btn pri" id="fb">' + (FW[key] ? "Following" : "Follow") + "</button>";
        fw.onclick = async () => {
          if (!SESSION) { location.hash = "login"; return; }
          try { await api("/users/" + key + "/follow", { method: FW[key] ? "DELETE" : "PUT" }); route(); } catch (x) { alert(x.message); }
        };
      }
    }
    if (r === "project") { const p = P.find((x) => x.n === id); if (p && p.viewer) extras(p); }
    if (r === "admin" && isAdmin()) {
      app.onclick = adminClick;
      app.onchange = adminChange;
      const q = $("#aq");
      if (q) {
        let st;
        q.oninput = () => {
          clearTimeout(st);
          st = setTimeout(async () => {
            try { ADM.items = (await api("/admin/" + ADM.tab + "?q=" + encodeURIComponent(q.value.trim()))).items; $("#abody").innerHTML = adminBody(); } catch (x) { $("#abody").innerHTML = '<div class="empty">' + E(x.message) + "</div>"; }
          }, 250);
        };
      }
    }
    if (r === "settings" && SESSION && SET) app.onclick = settingsClick;
    if (r === "forgot") {
      $("#fgo").onclick = async () => {
        const m = $("#fmsg");
        m.style.color = "";
        try {
          await api("/auth/forgot-password", { method: "POST", body: { email: $("#fe").value.trim() } });
          m.style.color = "var(--s)"; m.textContent = "If that email has an account, a reset link is on its way.";
        } catch (x) { m.textContent = x.message; }
      };
    }
    if (r === "reset") {
      $("#rgo").onclick = async () => {
        const m = $("#rmsg"), a = $("#np").value;
        if (a.length < 8) { m.textContent = "Use at least 8 characters."; return; }
        if (a !== $("#np2").value) { m.textContent = "The two passwords don’t match."; return; }
        try {
          await api("/auth/reset-password", { method: "POST", body: { token: id, password: a } });
          setUser(null); acct();
          app.innerHTML = card1('<h2>Password changed</h2><p>Sign in with your new password.</p><a class="btn pri" href="#login">Sign in</a>');
        } catch (x) { m.textContent = x.message; }
      };
    }
    if (r === "lesson") {
      const b = $("#lc");
      if (b) b.onclick = async () => {
        if (!SESSION) { location.hash = "login"; return; }
        try { await api("/learning/lessons/" + LESSON.id + "/complete", { method: LESSON.done ? "DELETE" : "PUT" }); route(); } catch (x) { alert(x.message); }
      };
    }
    if (r === "learn") {
      app.onclick = async (e) => {
        const b = e.target.closest("[data-pc]");
        if (!b) return;
        try { await api("/learning/" + PATH.slug + "/projects/" + b.dataset.pc + "/complete", { method: b.dataset.done === "true" ? "DELETE" : "PUT" }); route(); } catch (x) { alert(x.message); }
      };
    }
    if (r === "dashboard") {
      app.onclick = async (e) => {
        const b = e.target.closest("[data-a]");
        if (!b) return;
        const un = b.dataset.a === "un";
        try { await api("/projects/" + b.dataset.i + (un ? "/unpublish" : ""), { method: un ? "POST" : "DELETE" }); } catch (x) { alert(x.message); return; }
        route();
      };
    }
    if (r === "search") {
      let st;
      const run = async () => {
        try {
          const u = new URLSearchParams(), s = $("#q").value.trim(), lv = +$("#lv").value;
          if (s) u.set("q", s);
          if (lv) u.set("difficulty", lv);
          const d = await api("/search?" + u);
          $("#cnt").innerHTML = E(d.total + (d.total === 1 ? " project" : " projects")) + (d.learning && d.learning.length ? " · Learning: " + d.learning.map((l) => '<a href="#learn-' + E(l.slug) + '" style="color:var(--p)">' + E(l.title) + "</a>").join(", ") : "");
          $("#sr").innerHTML = d.items.length ? d.items.map((x) => card(mapCard(x))).join("") : '<div class="empty" style="grid-column:1/-1">No projects match. Remove a word or set difficulty to Any.</div>';
        } catch (e) { $("#cnt").textContent = "Search failed: " + e.message; }
      };
      $("#q").oninput = () => { clearTimeout(st); st = setTimeout(run, 250); };
      $("#lv").onchange = run;
      run();
    }
  };

  const acct0 = acct;
  acct = function () {
    acct0();
    const ai = NAV.findIndex((n) => n[0] === "admin");
    if (isAdmin() && ai < 0) NAV.push(["admin", "Admin"]); else if (!isAdmin() && ai >= 0) NAV.splice(ai, 1);
    if (SESSION) $("#acct").insertAdjacentHTML("afterbegin", '<a class="btn sm hide" href="#settings">Settings</a> ' + (isAdmin() ? '<a class="btn sm hide" href="#admin">Admin</a> ' : "") + '<a class="btn sm hide" href="#notifications">Alerts' + (UNREAD ? " (" + UNREAD + ")" : "") + "</a> ");
  };

  // Retire the old local-storage layer
  put = function () {};
  sync = function () {};

  await loadMe();
  addEventListener("hashchange", () => route());
  acct();
  route();
})();
