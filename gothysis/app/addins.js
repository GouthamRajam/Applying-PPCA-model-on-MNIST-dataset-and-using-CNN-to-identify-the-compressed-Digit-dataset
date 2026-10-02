// Gothysis add-ins: the public API that add-in scripts call (window.Gothysis), the Add-Ins
// manager window, the loader for installed add-ins, and the Add-Ins tab that runs them.
// Loaded after the main page script, so it can use its helpers (card, statTable, charts, …).
// See docs/ADDINS.md for how to write an add-in.
"use strict";
(function () {
  const API_VERSION = 1;
  const analyses = [];   // {addin, id, name, description, roles, options, run}
  const commands = [];   // {addin, id, name, description, run}
  const loaded = {};     // addin id -> manifest
  const desktop = location.protocol.startsWith("http") && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  const addinState = { current: "", roles: {}, options: {} };

  function owner() {
    const s = document.currentScript;
    return (s && s.dataset && s.dataset.addin) || "local";
  }
  function check(def, kind) {
    if (!def || typeof def !== "object") throw new Error(`Gothysis.${kind}: pass an object`);
    if (!def.name) throw new Error(`Gothysis.${kind}: "name" is required`);
    if (typeof def.run !== "function") throw new Error(`Gothysis.${kind}: "run" must be a function`);
  }

  // ---------- public API ----------
  const Gothysis = {
    apiVersion: API_VERSION,
    version: null,
    /** Adds an analysis to the Add-Ins tab.
     *  roles:   [{key, label, type: "numeric" | "categorical" | "any", multiple, required}]
     *  options: [{key, label, type: "number" | "checkbox" | "select" | "text", default, choices, min, max, step}]
     *  run(ctx) draws the results; see docs/ADDINS.md for ctx. */
    addAnalysis(def) {
      check(def, "addAnalysis");
      const addin = owner();
      const id = addin + "/" + (def.id || def.name);
      const i = analyses.findIndex(a => a.id === id);
      const a = { addin, id, name: String(def.name), description: def.description || "", roles: def.roles || [], options: def.options || [], run: def.run };
      if (i >= 0) analyses[i] = a; else analyses.push(a);
      refreshTab();
      return id;
    },
    /** Adds a one-click tool (for example "Add a computed column") to the Add-Ins tab. */
    addCommand(def) {
      check(def, "addCommand");
      const addin = owner();
      const id = addin + "/" + (def.id || def.name);
      const i = commands.findIndex(c => c.id === id);
      const c = { addin, id, name: String(def.name), description: def.description || "", run: def.run };
      if (i >= 0) commands[i] = c; else commands.push(c);
      refreshTab();
      return id;
    },
    /** URL of a file inside an installed add-in (for extra scripts, data or images). */
    fileUrl(addinId, file) { return "/addins/" + encodeURIComponent(addinId) + "/" + String(file).split("/").map(encodeURIComponent).join("/"); },
    /** Loads another script file of the calling add-in, e.g. await Gothysis.loadScript(Gothysis.fileUrl(id, "lib.js")). */
    loadScript(url, addinId) {
      return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url;
        s.dataset.addin = addinId || owner();
        s.onload = resolve;
        s.onerror = () => reject(new Error("Could not load " + url));
        document.head.appendChild(s);
      });
    },
    stats: window.GStats,
    list() { return { analyses: analyses.map(a => ({ id: a.id, name: a.name, addin: a.addin })), commands: commands.map(c => ({ id: c.id, name: c.name, addin: c.addin })) }; },
  };
  window.Gothysis = Gothysis;

  // ---------- context passed to run(ctx) ----------
  function makeContext(item, host) {
    const roleValues = {};
    for (const r of item.roles || []) roleValues[r.key] = addinState.roles[item.id + ":" + r.key];
    const opts = {};
    for (const o of item.options || []) {
      const v = addinState.options[item.id + ":" + o.key];
      opts[o.key] = v === undefined ? o.default : v;
    }
    const colOf = name => table && table.columns.find(c => c.name === name);
    const ctx = {
      apiVersion: API_VERSION,
      addinId: item.addin,
      data: table ? { name: table.name, nrows: table.nrows, columns: table.columns.map(c => ({ name: c.name, type: c.type })) } : null,
      /** Column object {name, type, values} by name. */
      column: colOf,
      /** The column(s) chosen for a role: one object, or an array when the role is "multiple". */
      role(key) {
        const v = roleValues[key];
        if (Array.isArray(v)) return v.map(colOf).filter(Boolean);
        return v ? colOf(v) || null : null;
      },
      /** Values of the column(s) in a role (an array, or an array of arrays for "multiple"). */
      values(key) {
        const r = ctx.role(key);
        if (Array.isArray(r)) return r.map(c => c.values.slice());
        return r ? r.values.slice() : [];
      },
      options: opts,
      stats: window.GStats,
      fmt, fmtP,
      results: host,
      /** Adds a result card; body is an HTML string, a DOM node or an SVG chart. */
      card(title, body, o) { const c = card(title, body, o); host.appendChild(c); return c; },
      /** HTML for a statistics table. Cells may be strings, numbers or {v, cls, style}. */
      table: (head, rows, o) => statTable(head, rows, o),
      pCell,
      note(text) { host.insertAdjacentHTML("beforeend", `<div class="note">${esc(text)}</div>`); },
      chart: {
        histogram: (values, name, o) => histogramChart(values, name, o || { normal: true }),
        bar: (levels, name, o) => barChart(levels, name, o),
        scatter: (points, o) => scatterChart(points, o || {}),
        normalQuantile: (values, name) => normalQuantileChart(values, name),
        frame: o => frame(o), el, text: txt, curve, colors, legend,
      },
      /** Adds a numeric (or "categorical") column to the data table; returns its final name. */
      addColumn(name, values, type) {
        if (!table) throw new Error("No data table is open.");
        if (!Array.isArray(values) || values.length !== table.nrows) throw new Error(`addColumn: values must be an array of ${table.nrows} items`);
        const n = addColumn(name, values.map(v => (type === "categorical" ? v : (v === null || v === undefined || v === "" ? NaN : Number(v)))));
        const col = table.columns[table.columns.length - 1];
        if (type === "categorical") { col.type = "categorical"; col.values = values.map(v => (v === null || v === undefined || v === "" ? null : String(v))); col.raw = col.values.map(v => v ?? ""); }
        renderColumns();
        return n;
      },
      toast, download,
      escape: esc,
    };
    return ctx;
  }

  // ---------- Add-Ins tab ----------
  function refreshTab() {
    const tab = document.querySelector('#tabs button[data-view="addins"]');
    if (tab) tab.textContent = "Add-Ins" + (analyses.length + commands.length ? ` (${analyses.length + commands.length})` : "");
    if (typeof activeView !== "undefined" && activeView === "addins") renderView("addins");
  }

  function renderAddins(host) {
    host.innerHTML = "";
    if (!analyses.length && !commands.length) {
      host.innerHTML = `<div class="empty"><h2>No add-ins yet</h2><div>Add-ins add your company's own analyses and tools to Gothysis.</div>
        <div class="actions"><button class="btn primary" id="addinOpenMgr">Manage add-ins…</button></div>
        <div class="note" style="margin-top:14px">An add-in is a .gaddin file. See docs/ADDINS.md to write one.</div></div>`;
      host.querySelector("#addinOpenMgr").onclick = openManager;
      return;
    }
    if (commands.length) {
      const bar = document.createElement("div");
      bar.className = "roles";
      bar.innerHTML = `<div class="multipick"><span>Tools</span></div>`;
      for (const c of commands) {
        const b = Object.assign(document.createElement("button"), { className: "btn", textContent: c.name, title: c.description || c.name });
        b.onclick = async () => {
          try { await c.run(makeContext(c, host.querySelector(".results") || host)); renderView(activeView); }
          catch (e) { console.error(e); alert(`${c.name} (${c.addin}) failed:\n\n${e.message || e}`); }
        };
        bar.appendChild(b);
      }
      host.appendChild(bar);
    }
    if (!analyses.length) return;
    if (!analyses.some(a => a.id === addinState.current)) addinState.current = analyses[0].id;
    const a = analyses.find(x => x.id === addinState.current);
    const names = table ? table.columns.map(c => c.name) : [];
    const pick = selectField("Analysis", a.name, analyses.map(x => x.name), v => { addinState.current = analyses.find(x => x.name === v).id; renderAddins(host); });
    const fields = [pick];
    for (const r of a.roles) {
      const key = a.id + ":" + r.key;
      const allowed = table ? table.columns.filter(c => !r.type || r.type === "any" || c.type === r.type).map(c => c.name) : [];
      if (r.multiple) {
        if (addinState.roles[key] === undefined) addinState.roles[key] = allowed.slice(0, 4);
        fields.push(multiPick(r.label || r.key, allowed, addinState.roles[key], v => { addinState.roles[key] = v; renderAddins(host); }));
      } else {
        if (addinState.roles[key] === undefined || !names.includes(addinState.roles[key])) addinState.roles[key] = r.required === false ? "" : (allowed[0] || "");
        fields.push(selectField(r.label || r.key, addinState.roles[key], allowed, v => { addinState.roles[key] = v; renderAddins(host); }, r.required === false ? "(none)" : null));
      }
    }
    for (const o of a.options) {
      const key = a.id + ":" + o.key;
      const cur = addinState.options[key] === undefined ? o.default : addinState.options[key];
      const set = v => { addinState.options[key] = v; renderAddins(host); };
      if (o.type === "checkbox") fields.push(checkField(o.label || o.key, !!cur, set));
      else if (o.type === "select") fields.push(selectField(o.label || o.key, cur, (o.choices || []).map(String), set));
      else if (o.type === "text") {
        const l = document.createElement("label"); l.className = "field"; l.textContent = o.label || o.key;
        const i = Object.assign(document.createElement("input"), { type: "text", value: cur ?? "" });
        i.style.cssText = "padding:4px 6px;border:1px solid var(--line);border-radius:5px;background:var(--panel)";
        i.onchange = () => set(i.value); l.appendChild(i); fields.push(l);
      } else fields.push(numberField(o.label || o.key, cur ?? "", { min: o.min, max: o.max, step: o.step ?? "any" }, v => set(Number.isFinite(v) ? v : undefined)));
    }
    host.appendChild(rolesBar(...fields));
    const info = document.createElement("div");
    info.className = "note";
    info.textContent = `${a.description ? a.description + " · " : ""}From add-in: ${(loaded[a.addin] && loaded[a.addin].name) || a.addin}`;
    host.appendChild(info);
    const res = document.createElement("div");
    res.className = "results";
    host.appendChild(res);
    const missing = a.roles.filter(r => r.required !== false && !(Array.isArray(addinState.roles[a.id + ":" + r.key]) ? addinState.roles[a.id + ":" + r.key].length : addinState.roles[a.id + ":" + r.key]));
    if (missing.length) { res.innerHTML = `<div class="note">Choose a column for: ${esc(missing.map(r => r.label || r.key).join(", "))}.</div>`; return; }
    Promise.resolve().then(() => a.run(makeContext(a, res))).catch(e => {
      console.error(e);
      res.insertAdjacentHTML("beforeend", `<div class="card err">${esc(a.name)} (add-in ${esc(a.addin)}) failed: ${esc(e.message || e)}</div>`);
    });
  }
  window.renderAddins = renderAddins;

  // ---------- loader ----------
  function unregister(addinId) {
    for (const list of [analyses, commands]) for (let i = list.length - 1; i >= 0; i--) if (list[i].addin === addinId) list.splice(i, 1);
    delete loaded[addinId];
    refreshTab();
  }
  async function loadAddin(m) {
    unregister(m.id);
    loaded[m.id] = m;
    try { await Gothysis.loadScript(Gothysis.fileUrl(m.id, m.main) + "?v=" + encodeURIComponent(m.version) + "&t=" + Date.now(), m.id); }
    catch (e) { toast(`Add-in ${m.name} could not load`); console.error(e); }
  }
  async function api(method, path, body) {
    const r = await fetch(path, { method, body, headers: { "X-Gothysis": "1" } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { data: j });
    return j;
  }
  async function loadInstalled() {
    if (!desktop) return;
    try {
      const v = await fetch("/api/version").then(r => r.json());
      Gothysis.version = v.version;
      const { addins } = await api("GET", "/api/addins");
      for (const m of addins) if (m.enabled) await loadAddin(m);
    } catch (e) { console.error(e); }
  }

  // ---------- manager window ----------
  const dlg = document.createElement("dialog");
  dlg.id = "addinDlg";
  dlg.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><strong style="flex:1">Add-Ins</strong>
      <button class="btn primary" id="addinInstall">Install add-in…</button><button class="btn" id="addinClose">Close</button></div>
    <div class="note">Add-ins add analyses and tools to Gothysis. They run their own code with the same access as Gothysis, so install add-ins only from people you trust (for example your company's own).</div>
    <div id="addinList"></div>
    <input type="file" id="addinFile" accept=".gaddin,.jmpaddin,.zip" hidden>`;
  document.body.appendChild(dlg);
  dlg.querySelector("#addinClose").onclick = () => dlg.close();
  dlg.querySelector("#addinInstall").onclick = () => {
    if (!desktop) { alert("Installing add-ins needs Gothysis.exe (the add-ins are kept in your Gothysis folder)."); return; }
    dlg.querySelector("#addinFile").click();
  };
  dlg.querySelector("#addinFile").onchange = e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) installFile(f);
  };
  async function installFile(f) {
    if (!desktop) { alert("Installing add-ins needs Gothysis.exe (the add-ins are kept in your Gothysis folder)."); return; }
    const isJmp = /\.jmpaddin$/i.test(f.name);
    if (!isJmp && !confirm(`Install the add-in "${f.name}"?\n\nAdd-ins run their own code inside Gothysis. Only install add-ins from people you trust.`)) return;
    try {
      const m = await api("POST", "/api/addins", await f.arrayBuffer());
      await loadAddin(m);
      toast(`Installed ${m.name} ${m.version}`);
      if (dlg.open) await renderManager();
    } catch (err) {
      if (err.data && err.data.jmpAddin) showJmpReport(f.name, err.data.jmpAddin);
      else alert("Could not install " + f.name + "\n\n" + (err.message || err));
    }
  }
  window.installAddinFile = installFile;

  // Report for a JMP add-in (.jmpaddin): Gothysis cannot run JSL, so show what is inside it.
  const jdlg = document.createElement("dialog");
  jdlg.id = "jmpAddinDlg";
  document.body.appendChild(jdlg);
  function showJmpReport(fileName, j) {
    const kb = b => (b < 1024 ? b + " B" : (b / 1024).toFixed(1) + " KB");
    const totalLines = j.scripts.reduce((a, s) => a + (s.lines || 0), 0);
    const report = [
      `JMP add-in: ${fileName}`, `Name: ${j.name || "(none)"}`, `ID: ${j.id || "(none)"}`,
      ...Object.entries(j.settings).filter(([k]) => k !== "id" && k !== "name").map(([k, v]) => `${k}: ${v}`),
      "", "Menu items:", ...(j.menu.length ? j.menu.map(m => `  ${m.caption || "(no caption)"} -> ${m.action || ""}`) : ["  (none found)"]),
      "", `JSL scripts (${j.scripts.length}, ${totalLines} lines):`, ...j.scripts.map(s => `  ${s.path}  ${s.lines} lines, ${kb(s.bytes)}`),
      "", "Other files:", ...(j.otherFiles.length ? j.otherFiles.map(f => `  ${f.path}  ${kb(f.bytes)}`) : ["  (none)"]),
    ].join("\n");
    jdlg.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><strong style="flex:1">This is a JMP add-in</strong><button class="btn" id="jmpClose">Close</button></div>
      <div class="note">“${esc(j.name || fileName)}” is written in JMP's scripting language (JSL), which only JMP can run. To use it in Gothysis it has to be converted into a Gothysis add-in (.gaddin), which does the same analysis in JavaScript. Below is what it contains; share the .jmpaddin file (or this report) with whoever converts it.</div>
      <div class="results" style="margin-top:8px">
        <div class="card" style="flex:1 1 100%">${statTable(null, [["Name", j.name || "·"], ["ID", j.id || "·"], ["Menu items", j.menu.length], ["JSL scripts", `${j.scripts.length} (${totalLines} lines)`], ["Other files", j.otherFiles.length]])}</div>
        ${j.menu.length ? `<div class="card" style="flex:1 1 100%"><h4>Menu items</h4>${statTable(["Caption", "Runs"], j.menu.map(m => [m.caption || "·", { v: m.action || "", style: "text-align:left;white-space:normal;font-family:Consolas,monospace;font-size:12px" }]))}</div>` : ""}
        ${j.scripts.length ? `<div class="card"><h4>JSL scripts</h4>${statTable(["File", "Lines", "Size"], j.scripts.map(s => [s.path, s.lines, kb(s.bytes)]))}</div>` : ""}
        ${j.otherFiles.length ? `<div class="card"><h4>Other files</h4>${statTable(["File", "Size"], j.otherFiles.map(f => [f.path, kb(f.bytes)]))}</div>` : ""}
      </div>
      <div class="row" style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn" id="jmpSave">Save report (.txt)</button></div>`;
    jdlg.querySelector("#jmpClose").onclick = () => jdlg.close();
    jdlg.querySelector("#jmpSave").onclick = () => download((j.name || fileName.replace(/\.jmpaddin$/i, "")) + " - JMP add-in report.txt", report, "text/plain");
    if (!jdlg.open) jdlg.showModal();
  }
  async function renderManager() {
    const list = dlg.querySelector("#addinList");
    if (!desktop) { list.innerHTML = `<div class="note">Open Gothysis with Gothysis.exe to install and manage add-ins.</div>`; return; }
    let data;
    try { data = await api("GET", "/api/addins"); } catch (e) { list.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    if (!data.addins.length) { list.innerHTML = `<div class="note" style="padding:12px 0">No add-ins installed. Click <b>Install add-in…</b> and choose a .gaddin file.</div><div class="note">Folder: ${esc(data.dir)}</div>`; return; }
    list.innerHTML = statTable(["", "Add-in", "Version", "Author", ""], data.addins.map(m => [
      { v: "" }, { v: m.name }, { v: m.version }, { v: m.author || "" }, { v: "" },
    ])) + `<div class="note">Folder: ${esc(data.dir)}</div>`;
    const rows = list.querySelectorAll("tbody tr");
    data.addins.forEach((m, i) => {
      const tds = rows[i].querySelectorAll("td");
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: m.enabled, title: m.enabled ? "Enabled: click to turn off" : "Disabled: click to turn on" });
      cb.onchange = async () => {
        try {
          await api("PATCH", "/api/addins/" + encodeURIComponent(m.id), JSON.stringify({ enabled: cb.checked }));
          if (cb.checked) await loadAddin(m); else unregister(m.id);
          toast(`${m.name} ${cb.checked ? "turned on" : "turned off"}`);
        } catch (e) { alert(e.message); cb.checked = !cb.checked; }
      };
      tds[0].appendChild(cb);
      tds[1].title = `${m.id}${m.description ? "\n" + m.description : ""}`;
      if (m.description) tds[1].insertAdjacentHTML("beforeend", `<div class="note" style="margin:0;white-space:normal;max-width:300px">${esc(m.description)}</div>`);
      const rm = Object.assign(document.createElement("button"), { className: "btn small", textContent: "Remove" });
      rm.onclick = async () => {
        if (!confirm(`Remove the add-in "${m.name}"?`)) return;
        try { await api("DELETE", "/api/addins/" + encodeURIComponent(m.id)); unregister(m.id); toast(`Removed ${m.name}`); renderManager(); }
        catch (e) { alert(e.message); }
      };
      tds[4].appendChild(rm);
    });
  }
  function openManager() { renderManager(); dlg.showModal(); }
  window.openAddinManager = openManager;
  const btn = document.getElementById("addinsBtn");
  if (btn) btn.onclick = openManager;

  loadInstalled();
})();
