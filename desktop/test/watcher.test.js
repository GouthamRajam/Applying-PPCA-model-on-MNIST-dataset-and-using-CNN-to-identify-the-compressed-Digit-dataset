const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { FolderWatcher, foupLink } = require("../watcher");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "senson-"));
  fs.writeFileSync(path.join(dir, "old.csv"), "already here");
  const got = [];
  const w = new FolderWatcher(dir, { interval: 100, onFile: f => got.push(f.name) }).start();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  fs.writeFileSync(path.join(dir, "mission1.csv"), "Time,S1\n0,29.1\n");
  fs.writeFileSync(path.join(dir, "notes.docx"), "ignored");
  await wait(450);
  assert.deepStrictEqual(got, ["mission1.csv"], "new csv reported once; old file and other types ignored");
  // a file still being written is reported only after it stops growing
  const p = path.join(dir, "mission2.csv");
  fs.writeFileSync(p, "a");
  for (let i = 0; i < 4; i++) { await wait(60); fs.appendFileSync(p, "more"); }
  assert.ok(!got.includes("mission2.csv"), "not reported while growing");
  await wait(450);
  assert.ok(got.includes("mission2.csv"), "reported after it stopped growing");
  w.stop();
  // link check
  const fakeOs = up => ({ networkInterfaces: () => ({ "USB Ethernet": [{ family: "IPv4", internal: false, address: up ? "192.168.10.14" : "10.0.0.5" }] }) });
  assert.deepStrictEqual(foupLink(fakeOs(true)), { up: true, ifname: "USB Ethernet", address: "192.168.10.14" });
  assert.deepStrictEqual(foupLink(fakeOs(false)), { up: false });
  console.log("watcher tests passed");
})().catch(e => { console.error(e); process.exit(1); });
