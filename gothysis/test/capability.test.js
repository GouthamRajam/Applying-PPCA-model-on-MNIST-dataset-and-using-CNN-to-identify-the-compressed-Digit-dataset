// Checks the example Process Capability add-in against values computed with NumPy/SciPy.
const test = require("node:test");
const assert = require("node:assert");
const S = require("../app/stats.js");
const { capability } = require("../addins/process-capability/main.js");
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);

const x = [10.2, 9.8, 10.1, 10.4, 9.9, 10.0, 10.3, 9.7, 10.2, 10.1, 9.6, 10.5, 10.0, 9.9, 10.2, 10.3, 9.8, 10.1, 10.0, 10.4];

test("capability indices and intervals", () => {
  const r = capability(x, 9, 11, 10, S);
  close(r.sigmaWithin, 0.3172825681224337);
  close(r.within.cp, 1.0505882352941178); close(r.within.cpk, 0.9717941176470597);
  close(r.overall.cp, 1.3623222291080237); close(r.overall.cpk, 1.2601480619249228);
  close(r.cpm, 1.3333333333333341);
  close(r.ci.cp[0], 0.7192993546592216, 1e-5); close(r.ci.cp[1], 1.3814615452439352, 1e-5);
  close(r.ci.cpk[0], 0.6300191013985255); close(r.ci.cpk[1], 1.313569133895594);
  close(r.expectedOverall.total, 8.385169325871719e-05, 1e-4);
  assert.strictEqual(r.observed.total, 0);
});

test("one-sided spec and input checks", () => {
  const r = capability(x, NaN, 11, NaN, S);
  assert.ok(Number.isNaN(r.within.cp));
  close(r.within.cpk, r.within.cpu);
  assert.throws(() => capability(x, NaN, NaN, NaN, S), /spec limit/);
  assert.throws(() => capability(x, 11, 9, NaN, S), /USL must be greater/);
  assert.throws(() => capability([1, 2], 0, 3, NaN, S), /at least 3/);
});
