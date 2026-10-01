// Copies the Senson page into the desktop app, removing the online font links so the app
// starts instantly on offline lab laptops (it falls back to the system fonts).
const fs = require("fs"), path = require("path");
const out = process.argv[2] || path.join(__dirname, "app", "index.html");
let html = fs.readFileSync(path.join(__dirname, "..", "demo", "mission-controller-demo.html"), "utf8");
html = html.replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, "");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("app page written:", out, html.includes("fonts.googleapis") ? "(fonts still linked!)" : "(offline-ready)");
