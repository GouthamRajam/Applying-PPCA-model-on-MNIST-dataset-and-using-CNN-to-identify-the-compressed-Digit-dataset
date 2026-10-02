// Process Capability add-in for Gothysis (example add-in; see docs/ADDINS.md).
// Within-process sigma = average moving range / d2 (d2 = 1.128 for ranges of 2 consecutive rows);
// overall sigma = sample standard deviation. Cp/Cpk use within sigma, Pp/Ppk use overall sigma.
(function () {
  "use strict";

  function capability(values, lsl, usl, target, S) {
    const x = values.filter(v => typeof v === "number" && Number.isFinite(v));
    const n = x.length;
    if (n < 3) throw new Error("Need at least 3 values.");
    const hasL = Number.isFinite(lsl), hasU = Number.isFinite(usl);
    if (!hasL && !hasU) throw new Error("Enter a lower and/or upper spec limit (LSL, USL).");
    if (hasL && hasU && !(usl > lsl)) throw new Error("USL must be greater than LSL.");
    const s = S.summarize(x);
    let mr = 0;
    for (let i = 1; i < n; i++) mr += Math.abs(x[i] - x[i - 1]);
    const sigmaWithin = mr / (n - 1) / 1.128, sigmaOverall = s.sd;
    const idx = sigma => {
      if (!(sigma > 0)) return { cp: NaN, cpl: NaN, cpu: NaN, cpk: NaN };
      const cpl = hasL ? (s.mean - lsl) / (3 * sigma) : NaN;
      const cpu = hasU ? (usl - s.mean) / (3 * sigma) : NaN;
      return { cp: hasL && hasU ? (usl - lsl) / (6 * sigma) : NaN, cpl, cpu, cpk: Math.min(hasL ? cpl : Infinity, hasU ? cpu : Infinity) };
    };
    const within = idx(sigmaWithin), overall = idx(sigmaOverall);
    // 95% confidence intervals: Cp/Pp chi-square based, Cpk/Ppk Bissell's normal approximation.
    const z = S.normInv(0.975), df = n - 1;
    const chiQ = p => { let lo = 0, hi = df + 50 * Math.sqrt(2 * df) + 50; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (1 - S.chi2Survival(m, df) < p) lo = m; else hi = m; } return (lo + hi) / 2; };
    const cpCI = c => [c * Math.sqrt(chiQ(0.025) / df), c * Math.sqrt(chiQ(0.975) / df)];
    const cpkCI = c => { const h = z * Math.sqrt(1 / (9 * n) + c * c / (2 * (n - 1))); return [c - h, c + h]; };
    const below = hasL ? x.filter(v => v < lsl).length : 0, above = hasU ? x.filter(v => v > usl).length : 0;
    const expBelow = sigma => (hasL && sigma > 0 ? S.normCdf((lsl - s.mean) / sigma) : 0);
    const expAbove = sigma => (hasU && sigma > 0 ? 1 - S.normCdf((usl - s.mean) / sigma) : 0);
    const cpm = hasL && hasU && Number.isFinite(target) ? (usl - lsl) / (6 * Math.sqrt(s.variance * (n - 1) / n + (s.mean - target) ** 2)) : NaN;
    return {
      n, mean: s.mean, sigmaWithin, sigmaOverall, within, overall, cpm,
      ci: { cp: cpCI(within.cp), cpk: cpkCI(within.cpk), pp: cpCI(overall.cp), ppk: cpkCI(overall.cpk) },
      observed: { below: below / n, above: above / n, total: (below + above) / n },
      expectedWithin: { below: expBelow(sigmaWithin), above: expAbove(sigmaWithin), total: expBelow(sigmaWithin) + expAbove(sigmaWithin) },
      expectedOverall: { below: expBelow(sigmaOverall), above: expAbove(sigmaOverall), total: expBelow(sigmaOverall) + expAbove(sigmaOverall) },
    };
  }

  if (typeof module !== "undefined" && module.exports) { module.exports = { capability }; return; }

  const G = window.Gothysis;
  const pct = v => (Number.isFinite(v) ? (100 * v).toFixed(4) + "%" : "·");
  const ppm = v => (Number.isFinite(v) ? Math.round(v * 1e6).toLocaleString() : "·");

  G.addAnalysis({
    id: "capability",
    name: "Process Capability",
    description: "Cp, Cpk, Pp, Ppk for one measurement column (rows in time order)",
    roles: [{ key: "y", label: "Y, measurement", type: "numeric", required: true }],
    options: [
      { key: "lsl", label: "LSL", type: "number" },
      { key: "usl", label: "USL", type: "number" },
      { key: "target", label: "Target (optional)", type: "number" },
    ],
    run(ctx) {
      const col = ctx.role("y"), o = ctx.options, S = ctx.stats, fmt = ctx.fmt;
      if (!Number.isFinite(o.lsl) && !Number.isFinite(o.usl)) {
        const s = S.summarize(col.values);
        ctx.note(`Enter LSL and/or USL above. For reference, ${col.name} has mean ${fmt(s.mean)} and standard deviation ${fmt(s.sd)}.`);
        return;
      }
      const r = capability(col.values, o.lsl, o.usl, o.target, S);

      // Histogram with spec limits, target and the two fitted normal curves.
      const C = ctx.chart.colors();
      const h = S.histogram(col.values);
      const lo = Math.min(h.bins[0].lo, Number.isFinite(o.lsl) ? o.lsl : Infinity), hi = Math.max(h.bins[h.bins.length - 1].hi, Number.isFinite(o.usl) ? o.usl : -Infinity);
      const xdom = [lo - (hi - lo) * 0.05, hi + (hi - lo) * 0.05];
      const maxC = Math.max(...h.bins.map(b => b.count), r.n * h.width / (Math.min(r.sigmaWithin, r.sigmaOverall) * Math.sqrt(2 * Math.PI)));
      const f = ctx.chart.frame({ width: 520, height: 320, xdom, ydom: [0, maxC * 1.12], xlabel: col.name, ylabel: "Count", margin: { t: 26 } });
      for (const b of h.bins) { const y = f.sy(b.count); ctx.chart.el("rect", { x: f.sx(b.lo) + 0.5, y, width: Math.max(0, f.sx(b.hi) - f.sx(b.lo) - 1), height: f.sy(0) - y, fill: C.fill, "data-tip": `${fmt(b.lo)} – ${fmt(b.hi)}\nCount ${b.count}` }, f.plot); }
      const dens = (sig, color, dash) => ctx.chart.curve(f, x => r.n * h.width * Math.exp(-0.5 * ((x - r.mean) / sig) ** 2) / (sig * Math.sqrt(2 * Math.PI)), xdom, { stroke: color, "stroke-width": 2, "stroke-dasharray": dash });
      dens(r.sigmaOverall, C.line);
      dens(r.sigmaWithin, C.cat[2], "5 4");
      const vline = (x, label, color) => { if (!Number.isFinite(x)) return; ctx.chart.el("line", { x1: f.sx(x), x2: f.sx(x), y1: f.y0, y2: f.y0 + f.h, stroke: color, "stroke-width": 2 }, f.svg); ctx.chart.text(f.svg, f.sx(x), f.y0 - 8, `${label} ${fmt(x)}`, { "text-anchor": "middle", "font-size": 11, fill: color, "font-weight": 600 }); };
      vline(o.lsl, "LSL", C.cat[7]); vline(o.usl, "USL", C.cat[7]); vline(o.target, "Target", C.cat[0]);
      const leg = document.createElement("div");
      leg.className = "legend";
      leg.innerHTML = `<span style="--sw:${C.line}">Overall fit</span><span style="--sw:${C.cat[2]}">Within fit</span><span style="--sw:${C.cat[7]}">Spec limits</span>`;
      const wrapDiv = document.createElement("div"); wrapDiv.append(f.svg, leg);
      ctx.card(`Process Capability of ${col.name}`, wrapDiv);

      const ci = a => (Number.isFinite(a[0]) ? `${fmt(a[0], 3)} – ${fmt(a[1], 3)}` : "·");
      const flag = v => ({ v: fmt(v, 4), style: Number.isFinite(v) ? (v < 1 ? "color:var(--warn);font-weight:600" : v >= 1.33 ? "color:var(--good);font-weight:600" : "") : "" });
      ctx.card("Capability Indices", ctx.table(["Index", "Estimate", "95% CI", "Sigma"], [
        ["Cp", flag(r.within.cp), ci(r.ci.cp), "within"],
        ["Cpk", flag(r.within.cpk), ci(r.ci.cpk), "within"],
        ["Cpl", fmt(r.within.cpl, 4), "", "within"],
        ["Cpu", fmt(r.within.cpu, 4), "", "within"],
        ["Pp", flag(r.overall.cp), ci(r.ci.pp), "overall"],
        ["Ppk", flag(r.overall.cpk), ci(r.ci.ppk), "overall"],
        ["Ppl", fmt(r.overall.cpl, 4), "", "overall"],
        ["Ppu", fmt(r.overall.cpu, 4), "", "overall"],
        ["Cpm", fmt(r.cpm, 4), "", "target"],
      ]), { sub: "Green ≥ 1.33, orange < 1. Within sigma assumes rows are in time order." });
      ctx.card("Summary", ctx.table(null, [
        ["N", r.n], ["Mean", fmt(r.mean)], ["Within sigma (MR̄/1.128)", fmt(r.sigmaWithin)], ["Overall sigma (std dev)", fmt(r.sigmaOverall)],
        ["LSL", fmt(o.lsl)], ["Target", fmt(o.target)], ["USL", fmt(o.usl)],
      ]));
      ctx.card("Nonconformance", ctx.table(["", "Observed", "Expected (within)", "Expected (overall)", "PPM overall"], [
        ["Below LSL", pct(r.observed.below), pct(r.expectedWithin.below), pct(r.expectedOverall.below), ppm(r.expectedOverall.below)],
        ["Above USL", pct(r.observed.above), pct(r.expectedWithin.above), pct(r.expectedOverall.above), ppm(r.expectedOverall.above)],
        [{ v: "Total", style: "font-weight:600" }, pct(r.observed.total), pct(r.expectedWithin.total), pct(r.expectedOverall.total), ppm(r.expectedOverall.total)],
      ]), { csv: () => ctx.stats.toCsv(["Index", "Value"], [["Cp", "Cpk", "Pp", "Ppk", "Cpm", "Mean", "Within sigma", "Overall sigma", "N"], [r.within.cp, r.within.cpk, r.overall.cp, r.overall.cpk, r.cpm, r.mean, r.sigmaWithin, r.sigmaOverall, r.n]]) });
    },
  });

  G.addCommand({
    id: "row-number",
    name: "Add row number column",
    description: "Adds a column 'Row' with 1, 2, 3, … (handy as an X for run charts)",
    run(ctx) {
      if (!ctx.data) throw new Error("Open a data table first.");
      const name = ctx.addColumn("Row", Array.from({ length: ctx.data.nrows }, (_, i) => i + 1));
      ctx.toast(`Added column ${name}`);
    },
  });
})();
