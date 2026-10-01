// window.senson for the lightweight Senson.exe: the same calls as the Electron preload, over
// a local HTTP API that only this page knows the token for.
(function () {
  const T = "__TOKEN__";
  const call = (p, body) => fetch(p, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-Senson": T, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(r => r.json().then(j => { if (!r.ok) throw new Error(j.error || r.statusText); return j; }));
  // Events can arrive before the page registers its handlers, so keep them until it does.
  const subs = { mission: [], link: [], log: [] }, queue = { mission: [], link: [], log: [] };
  const deliver = (k, d) => subs[k].length ? subs[k].forEach(cb => cb(d)) : queue[k].push(d);
  const on = k => cb => { subs[k].push(cb); queue[k].splice(0).forEach(d => cb(d)); };
  const es = new EventSource("/api/events?t=" + T);
  for (const k of Object.keys(subs)) es.addEventListener(k, e => deliver(k, JSON.parse(e.data)));
  window.senson = {
    desktop: true,
    getSettings: () => call("/api/settings"),
    setSettings: s => call("/api/settings", s),
    pickFolder: current => call("/api/pick-folder", { current: current || "" }).then(r => r.path || null),
    saveFile: (dir, name, text) => call("/api/save", { dir, name, text }).then(r => r.path),
    version: () => call("/api/version").then(r => r.version),
    onMission: on("mission"), onLink: on("link"), onLog: on("log"),
  };
})();
