// Polls a folder for new or changed mission files and reports each one once its size has stopped
// changing (the vendor software may still be writing it). Polling also works on network/USB drives.
const fs = require("fs");
const path = require("path");

class FolderWatcher {
  constructor(dir, { interval = 2000, exts = [".csv", ".txt"], onFile = () => {}, onError = () => {} } = {}) {
    this.dir = dir; this.interval = interval; this.exts = exts.map(e => e.toLowerCase());
    this.onFile = onFile; this.onError = onError;
    this.seen = new Map();     // name -> "mtime:size" already reported (or present at start)
    this.pending = new Map();  // name -> "mtime:size" seen once, waiting to be stable
    this.timer = null;
  }
  list() {
    let names;
    try { names = fs.readdirSync(this.dir); } catch (e) { this.onError(e); return []; }
    const out = [];
    for (const name of names) {
      if (!this.exts.includes(path.extname(name).toLowerCase())) continue;
      try {
        const st = fs.statSync(path.join(this.dir, name));
        if (st.isFile()) out.push([name, `${Math.round(st.mtimeMs)}:${st.size}`]);
      } catch (_) { /* file vanished between readdir and stat */ }
    }
    return out;
  }
  start() {
    // files already in the folder are history, not new missions
    for (const [name, key] of this.list()) this.seen.set(name, key);
    this.timer = setInterval(() => this.poll(), this.interval);
    return this;
  }
  poll() {
    for (const [name, key] of this.list()) {
      if (this.seen.get(name) === key) continue;
      if (this.pending.get(name) === key) {           // unchanged since last poll: finished writing
        this.pending.delete(name); this.seen.set(name, key);
        this.onFile({ name, dir: this.dir, path: path.join(this.dir, name) });
      } else this.pending.set(name, key);
    }
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}

// USB link check: the FOUP shows up as a network adapter with an address in its subnet.
function foupLink(os, prefix = "192.168.10.") {
  for (const [ifname, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal && a.address.startsWith(prefix)) return { up: true, ifname, address: a.address };
    }
  }
  return { up: false };
}

module.exports = { FolderWatcher, foupLink };
