// Gothysis statistics engine: data import, summaries, distributions, regression, ANOVA,
// contingency tables, correlations, PCA and probabilistic PCA (Tipping & Bishop, 1999).
// Plain JavaScript with no dependencies; runs in the browser (window.GStats) and in node (require).
(function (root) {
  "use strict";

  // ---------- data import ----------
  const MISSING = new Set(["", "na", "n/a", "nan", ".", "null", "?"]);

  function detectDelimiter(text) {
    const line = text.split(/\r?\n/).find(l => l.trim() !== "") || "";
    let best = ",", bestN = -1;
    for (const d of [",", "\t", ";", "|"]) {
      const n = line.split(d).length - 1;
      if (n > bestN) { best = d; bestN = n; }
    }
    return best;
  }

  // RFC 4180 style parser: quoted fields, doubled quotes, CRLF or LF.
  function parseDelimited(text, delim) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    delim = delim || detectDelimiter(text);
    const rows = [];
    let row = [], field = "", q = false, i = 0;
    while (i < text.length) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === "") { q = true; i++; continue; }
      if (c === delim) { row.push(field); field = ""; i++; continue; }
      if (c === "\r" || c === "\n") {
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
        i += (c === "\r" && text[i + 1] === "\n") ? 2 : 1;
        continue;
      }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); if (row.length > 1 || row[0] !== "") rows.push(row); }
    return rows;
  }

  function toNumber(s) {
    if (typeof s === "number") return s;
    s = String(s).trim();
    if (MISSING.has(s.toLowerCase())) return NaN;
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return undefined; // not numeric
    return Number(s);
  }

  // rows: array of arrays of strings, first row = header. Returns a data table.
  function tableFromRows(rows, name) {
    if (!rows.length) throw new Error("The file has no rows.");
    const width = Math.max(...rows.map(r => r.length));
    const header = rows[0].slice();
    const seen = {};
    for (let j = 0; j < width; j++) {
      let h = (header[j] == null ? "" : String(header[j])).trim() || "Column " + (j + 1);
      if (seen[h]) { let k = 2; while (seen[h + " " + k]) k++; h = h + " " + k; }
      seen[h] = true; header[j] = h;
    }
    const body = rows.slice(1);
    const columns = header.map((h, j) => {
      const raw = body.map(r => (r[j] == null ? "" : String(r[j]).trim()));
      let numeric = true, nonMissing = 0;
      const nums = raw.map(s => {
        const v = toNumber(s);
        if (v === undefined) numeric = false;
        else if (!Number.isNaN(v)) nonMissing++;
        return v;
      });
      if (numeric && nonMissing > 0) return { name: h, type: "numeric", values: nums.map(v => (v === undefined ? NaN : v)), raw };
      return { name: h, type: "categorical", values: raw.map(s => (MISSING.has(s.toLowerCase()) ? null : s)), raw };
    });
    return { name: name || "Data", nrows: body.length, columns };
  }

  function setColumnType(col, type) {
    if (type === col.type) return col;
    if (type === "numeric") {
      col.values = col.raw.map(s => { const v = toNumber(s); return v === undefined ? NaN : v; });
    } else {
      col.values = col.raw.map(s => (MISSING.has(s.toLowerCase()) ? null : s));
    }
    col.type = type;
    return col;
  }

  function isMissing(v) { return v === null || v === undefined || (typeof v === "number" && Number.isNaN(v)); }

  // Minimal .xlsx reader (first worksheet): unzip with the browser's DecompressionStream,
  // then read sharedStrings.xml and the sheet XML. Dates stay as their serial numbers.
  async function readXlsx(buf, parseXml) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Not an .xlsx file (zip directory not found).");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    const dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      entries[dec.decode(u8.subarray(p + 46, p + 46 + nlen))] = { method, csize, off };
      p += 46 + nlen + xlen + clen;
    }
    async function file(name) {
      const e = entries[name];
      if (!e) return null;
      const lo = e.off, start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return dec.decode(data);
      const ds = new DecompressionStream("deflate-raw");
      const out = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
      return dec.decode(out);
    }
    const strings = [];
    const ss = await file("xl/sharedStrings.xml");
    if (ss) for (const si of parseXml(ss).getElementsByTagName("si")) {
      strings.push(Array.from(si.getElementsByTagName("t")).map(t => t.textContent).join(""));
    }
    let sheetPath = "xl/worksheets/sheet1.xml";
    const wb = await file("xl/workbook.xml"), rels = await file("xl/_rels/workbook.xml.rels");
    if (wb && rels) {
      const first = parseXml(wb).getElementsByTagName("sheet")[0];
      const rid = first && (first.getAttribute("r:id") || first.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"));
      for (const r of parseXml(rels).getElementsByTagName("Relationship")) {
        if (r.getAttribute("Id") === rid) {
          const t = r.getAttribute("Target");
          sheetPath = t.startsWith("/") ? t.slice(1) : "xl/" + t;
        }
      }
    }
    const sheet = await file(sheetPath);
    if (!sheet) throw new Error("Could not find the first worksheet.");
    const rows = [];
    const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    for (const r of parseXml(sheet).getElementsByTagName("row")) {
      const row = [];
      let next = 0;
      for (const c of r.getElementsByTagName("c")) {
        const ref = c.getAttribute("r"), j = ref ? colIndex(ref) : next;
        next = j + 1;
        const t = c.getAttribute("t"), vEl = c.getElementsByTagName("v")[0];
        let v = vEl ? vEl.textContent : "";
        if (t === "s") v = strings[+v] || "";
        else if (t === "inlineStr") v = Array.from(c.getElementsByTagName("t")).map(x => x.textContent).join("");
        else if (t === "b") v = v === "1" ? "TRUE" : "FALSE";
        while (row.length < j) row.push("");
        row[j] = v;
      }
      const ri = +r.getAttribute("r") - 1;
      while (rows.length < ri) rows.push([]);
      rows.push(row);
    }
    while (rows.length && rows[0].every(v => v === "")) rows.shift();
    return rows.filter((r, i) => i === 0 || r.some(v => v !== ""));
  }

  function toCsv(names, cols) {
    const esc = v => {
      if (isMissing(v)) return "";
      const s = String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const n = cols.length ? cols[0].length : 0;
    const lines = [names.map(esc).join(",")];
    for (let i = 0; i < n; i++) lines.push(cols.map(c => esc(c[i])).join(","));
    return lines.join("\r\n") + "\r\n";
  }

  // ---------- special functions and distributions ----------
  function lnGamma(x) {
    const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
      12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
    x -= 1;
    let a = 0.99999999999980993;
    const t = x + 7.5;
    for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  function betacf(a, b, x) {
    const FPMIN = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return h;
  }

  // Regularized incomplete beta I_x(a, b).
  function betaInc(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  // Regularized lower incomplete gamma P(a, x).
  function gammaInc(a, x) {
    if (x <= 0) return 0;
    const gln = lnGamma(a);
    if (x < a + 1) {
      let ap = a, sum = 1 / a, del = sum;
      for (let n = 0; n < 1000; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
      return sum * Math.exp(-x + a * Math.log(x) - gln);
    }
    const FPMIN = 1e-300;
    let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (let i = 1; i < 1000; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - gln) * h;
  }

  function normCdf(z) {
    // erfc via the complementary incomplete gamma: Phi(z) = 0.5 * erfc(-z / sqrt 2)
    const x = z / Math.SQRT2;
    const erf = x >= 0 ? gammaInc(0.5, x * x) : -gammaInc(0.5, x * x);
    return 0.5 * (1 + erf);
  }

  // Acklam's rational approximation, refined with one Newton step.
  function normInv(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    let x;
    if (p < 0.02425) {
      const q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p > 1 - 0.02425) {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else {
      const q = p - 0.5, r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    const e = normCdf(x) - p;
    return x - e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
  }

  function tCdf(t, df) {
    const x = df / (df + t * t);
    const tail = 0.5 * betaInc(x, df / 2, 0.5);
    return t >= 0 ? 1 - tail : tail;
  }
  function tTwoSidedP(t, df) { return betaInc(df / (df + t * t), df / 2, 0.5); }
  function tInv(p, df) {
    if (p === 0.5) return 0;
    let lo = -1, hi = 1;
    while (tCdf(lo, df) > p) lo *= 2;
    while (tCdf(hi, df) < p) hi *= 2;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (tCdf(mid, df) < p) lo = mid; else hi = mid;
      if (hi - lo < 1e-12 * Math.max(1, Math.abs(mid))) break;
    }
    return (lo + hi) / 2;
  }
  function fSurvival(f, d1, d2) { return f <= 0 ? 1 : betaInc(d2 / (d2 + d1 * f), d2 / 2, d1 / 2); }
  function chi2Survival(x, df) { return x <= 0 ? 1 : 1 - gammaInc(df / 2, x / 2); }

  // ---------- univariate ----------
  function clean(xs) { return xs.filter(v => typeof v === "number" && Number.isFinite(v)); }

  // Quantile with the (n + 1)p rule (the definition most statistics packages report).
  function quantileSorted(s, p) {
    const n = s.length;
    if (!n) return NaN;
    const pos = p * (n + 1);
    if (pos <= 1) return s[0];
    if (pos >= n) return s[n - 1];
    const k = Math.floor(pos), f = pos - k;
    return s[k - 1] + f * (s[k] - s[k - 1]);
  }

  function summarize(xs) {
    const x = clean(xs), n = x.length;
    const out = { n, nMissing: xs.length - n };
    if (!n) return out;
    const s = x.slice().sort((a, b) => a - b);
    let sum = 0; for (const v of x) sum += v;
    const mean = sum / n;
    let m2 = 0, m3 = 0, m4 = 0;
    for (const v of x) { const d = v - mean; m2 += d * d; m3 += d * d * d; m4 += d * d * d * d; }
    const variance = n > 1 ? m2 / (n - 1) : NaN, sd = Math.sqrt(variance);
    Object.assign(out, {
      sum, mean, variance, sd, se: sd / Math.sqrt(n),
      min: s[0], q1: quantileSorted(s, 0.25), median: quantileSorted(s, 0.5), q3: quantileSorted(s, 0.75), max: s[n - 1],
      sorted: s,
    });
    if (n > 1) {
      const tq = tInv(0.975, n - 1);
      out.ciLow = mean - tq * out.se; out.ciHigh = mean + tq * out.se;
    }
    // Sample-adjusted skewness and excess kurtosis (same formulas as Excel SKEW / KURT).
    if (n > 2 && sd > 0) out.skewness = n / ((n - 1) * (n - 2)) * (m3 / Math.pow(sd, 3));
    if (n > 3 && sd > 0) out.kurtosis = n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * (m4 / Math.pow(sd, 4)) - 3 * (n - 1) * (n - 1) / ((n - 2) * (n - 3));
    return out;
  }

  function frequencies(vals) {
    const map = new Map();
    let missing = 0;
    for (const v of vals) {
      if (isMissing(v)) { missing++; continue; }
      const k = String(v);
      map.set(k, (map.get(k) || 0) + 1);
    }
    const total = vals.length - missing;
    const levels = Array.from(map.keys()).sort(naturalCompare);
    return { levels: levels.map(l => ({ level: l, count: map.get(l), prob: map.get(l) / total })), total, missing };
  }

  function naturalCompare(a, b) {
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  // Histogram bins with "nice" widths (Sturges' rule for the bin count).
  function niceNumber(x, round) {
    const e = Math.floor(Math.log10(x)), f = x / Math.pow(10, e);
    let nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, e);
  }
  function histogram(xs, nbins) {
    const x = clean(xs);
    if (!x.length) return { bins: [], width: 0 };
    let min = Math.min(...x), max = Math.max(...x);
    if (min === max) { min -= 0.5; max += 0.5; }
    const k = nbins || Math.max(5, Math.ceil(Math.log2(x.length) + 1));
    const width = niceNumber((max - min) / k, true);
    const start = Math.floor(min / width) * width;
    const count = Math.max(1, Math.ceil((max - start) / width + 1e-9));
    const bins = Array.from({ length: count }, (_, i) => ({ lo: start + i * width, hi: start + (i + 1) * width, count: 0 }));
    for (const v of x) {
      let i = Math.floor((v - start) / width + 1e-9);
      if (i >= count) i = count - 1;
      if (i < 0) i = 0;
      bins[i].count++;
    }
    return { bins, width };
  }

  // Shapiro-Wilk W test (Royston 1995 approximation, AS R94), for 3 <= n <= 5000.
  function shapiroWilk(xs) {
    const x = clean(xs).sort((a, b) => a - b), n = x.length;
    if (n < 3 || n > 5000) return null;
    if (x[n - 1] - x[0] < 1e-12) return null;
    const m = [];
    for (let i = 1; i <= n; i++) m.push(normInv((i - 0.375) / (n + 0.25)));
    let summ2 = 0; for (const v of m) summ2 += v * v;
    const ssumm2 = Math.sqrt(summ2), rsn = 1 / Math.sqrt(n);
    const a = new Array(n).fill(0);
    const poly = (c, z) => { let r = 0; for (let i = c.length - 1; i >= 0; i--) r = r * z + c[i]; return r; };
    const c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
    const c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
    if (n === 3) { a[0] = Math.SQRT1_2; a[n - 1] = -a[0]; }
    else {
      const a1 = poly(c1, rsn) - m[0] / ssumm2;
      let i1, fac;
      if (n > 5) {
        i1 = 2;
        const a2 = -m[1] / ssumm2 + poly(c2, rsn);
        fac = Math.sqrt((summ2 - 2 * m[0] * m[0] - 2 * m[1] * m[1]) / (1 - 2 * a1 * a1 - 2 * a2 * a2));
        a[1] = a2; a[n - 2] = -a2;
      } else {
        i1 = 1;
        fac = Math.sqrt((summ2 - 2 * m[0] * m[0]) / (1 - 2 * a1 * a1));
      }
      a[0] = a1; a[n - 1] = -a1;
      for (let i = i1; i < n - i1; i++) a[i] = -m[i] / fac;
    }
    // a is defined with a[0] > 0 for the smallest value; W uses sum a_i x_(i) with sign handled by squaring.
    let mean = 0; for (const v of x) mean += v; mean /= n;
    let ssq = 0, num = 0;
    for (let i = 0; i < n; i++) { ssq += (x[i] - mean) * (x[i] - mean); num += a[n - 1 - i] * x[i]; }
    const w = Math.min(1, num * num / ssq);
    let p;
    if (n === 3) {
      p = Math.max(0, 6 / Math.PI * (Math.asin(Math.sqrt(w)) - Math.asin(Math.sqrt(0.75))));
    } else if (n <= 11) {
      const gamma = poly([-2.273, 0.459], n);
      const y = -Math.log(gamma - Math.log(1 - w));
      const mu = poly([0.544, -0.39978, 0.025054, -6.714e-4], n);
      const sigma = Math.exp(poly([1.3822, -0.77857, 0.062767, -0.0020322], n));
      p = 1 - normCdf((y - mu) / sigma);
    } else {
      const ln = Math.log(n);
      const y = Math.log(1 - w);
      const mu = poly([-1.5861, -0.31082, -0.083751, 0.0038915], ln);
      const sigma = Math.exp(poly([-0.4803, -0.082676, 0.0030302], ln));
      p = 1 - normCdf((y - mu) / sigma);
    }
    return { w, p };
  }

  // One-sample t test of H0: mean = mu0.
  function oneSampleT(xs, mu0) {
    const s = summarize(xs);
    if (s.n < 2) return null;
    const t = (s.mean - mu0) / s.se, df = s.n - 1;
    return { t, df, p: tTwoSidedP(t, df), pUpper: 1 - tCdf(t, df), pLower: tCdf(t, df) };
  }

  // ---------- bivariate ----------
  function pairs(xs, ys) {
    const x = [], y = [];
    for (let i = 0; i < xs.length; i++) {
      if (typeof xs[i] === "number" && Number.isFinite(xs[i]) && typeof ys[i] === "number" && Number.isFinite(ys[i])) { x.push(xs[i]); y.push(ys[i]); }
    }
    return { x, y };
  }

  function linearFit(xs, ys) {
    const { x, y } = pairs(xs, ys), n = x.length;
    if (n < 3) return null;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n; my /= n;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    if (sxx === 0) return null;
    const slope = sxy / sxx, intercept = my - slope * mx;
    const sse = Math.max(0, syy - slope * sxy), ssr = syy - sse, dfe = n - 2;
    const mse = sse / dfe, rmse = Math.sqrt(mse);
    const seSlope = rmse / Math.sqrt(sxx), seInt = rmse * Math.sqrt(1 / n + mx * mx / sxx);
    const tSlope = slope / seSlope, tInt = intercept / seInt;
    const F = ssr / mse;
    const r = syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
    const tq = tInv(0.975, dfe);
    return {
      n, x, y, slope, intercept, r, rsq: syy > 0 ? ssr / syy : NaN, adjRsq: syy > 0 ? 1 - (sse / dfe) / (syy / (n - 1)) : NaN,
      rmse, meanY: my, seSlope, seInt, tSlope, tInt, pSlope: tTwoSidedP(tSlope, dfe), pInt: tTwoSidedP(tInt, dfe),
      anova: { ssModel: ssr, ssError: sse, ssTotal: syy, dfModel: 1, dfError: dfe, dfTotal: n - 1, msModel: ssr, msError: mse, F, p: fSurvival(F, 1, dfe) },
      // 95% confidence band for the mean response at x0
      band: x0 => { const h = tq * rmse * Math.sqrt(1 / n + (x0 - mx) * (x0 - mx) / sxx); const yh = intercept + slope * x0; return [yh - h, yh + h]; },
      predict: x0 => intercept + slope * x0,
    };
  }

  // Least squares polynomial fit of the given degree (via normal equations on centred x).
  function polyFit(xs, ys, degree) {
    const { x, y } = pairs(xs, ys), n = x.length, k = degree + 1;
    if (n <= k) return null;
    let mx = 0; for (const v of x) mx += v; mx /= n;
    const X = x.map(v => { const r = []; let p = 1; for (let j = 0; j < k; j++) { r.push(p); p *= (v - mx); } return r; });
    const XtX = Array.from({ length: k }, () => new Array(k).fill(0)), Xty = new Array(k).fill(0);
    for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]; }
    const inv = invert(XtX);
    if (!inv) return null;
    const beta = inv.map(row => row.reduce((s, v, j) => s + v * Xty[j], 0));
    const predict = x0 => { let s = 0, p = 1; for (let j = 0; j < k; j++) { s += beta[j] * p; p *= (x0 - mx); } return s; };
    let my = 0; for (const v of y) my += v; my /= n;
    let sse = 0, sst = 0;
    for (let i = 0; i < n; i++) { const e = y[i] - predict(x[i]); sse += e * e; sst += (y[i] - my) * (y[i] - my); }
    const dfe = n - k, F = ((sst - sse) / degree) / (sse / dfe);
    return { degree, n, predict, rsq: 1 - sse / sst, adjRsq: 1 - (sse / dfe) / (sst / (n - 1)), rmse: Math.sqrt(sse / dfe), F, p: fSurvival(F, degree, dfe), center: mx, beta };
  }

  function groupBy(xs, ys) {
    const map = new Map();
    for (let i = 0; i < xs.length; i++) {
      const g = xs[i], v = ys[i];
      if (isMissing(g) || !(typeof v === "number" && Number.isFinite(v))) continue;
      const k = String(g);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(v);
    }
    return Array.from(map.keys()).sort(naturalCompare).map(k => ({ level: k, values: map.get(k) }));
  }

  // One-way ANOVA of numeric ys by the levels of xs, with Welch's test and Tukey-free summaries.
  function oneway(xs, ys) {
    const groups = groupBy(xs, ys).filter(g => g.values.length > 0);
    const k = groups.length;
    let N = 0, grand = 0;
    for (const g of groups) { g.summary = summarize(g.values); N += g.values.length; grand += g.summary.sum; }
    if (k < 2 || N <= k) return { groups, k, N, ok: false };
    grand /= N;
    let ssb = 0, ssw = 0;
    for (const g of groups) {
      ssb += g.values.length * (g.summary.mean - grand) * (g.summary.mean - grand);
      for (const v of g.values) ssw += (v - g.summary.mean) * (v - g.summary.mean);
    }
    const dfb = k - 1, dfw = N - k, msb = ssb / dfb, msw = ssw / dfw, F = msb / msw;
    const tq = tInv(0.975, dfw);
    for (const g of groups) {
      const se = Math.sqrt(msw / g.values.length);
      g.pooledSe = se; g.ciLow = g.summary.mean - tq * se; g.ciHigh = g.summary.mean + tq * se;
    }
    // Welch's ANOVA (unequal variances)
    let welch = null;
    if (groups.every(g => g.values.length > 1 && g.summary.variance > 0)) {
      let sw = 0, swm = 0;
      for (const g of groups) { g.w = g.values.length / g.summary.variance; sw += g.w; swm += g.w * g.summary.mean; }
      const mw = swm / sw;
      let A = 0, B = 0;
      for (const g of groups) { A += g.w * (g.summary.mean - mw) ** 2; B += (1 - g.w / sw) ** 2 / (g.values.length - 1); }
      const Fw = (A / (k - 1)) / (1 + 2 * (k - 2) * B / (k * k - 1));
      const df2 = (k * k - 1) / (3 * B);
      welch = { F: Fw, df1: k - 1, df2, p: fSurvival(Fw, k - 1, df2) };
    }
    return {
      ok: true, groups, k, N, grandMean: grand, rsq: ssb / (ssb + ssw), rmse: Math.sqrt(msw),
      anova: { ssModel: ssb, ssError: ssw, ssTotal: ssb + ssw, dfModel: dfb, dfError: dfw, dfTotal: N - 1, msModel: msb, msError: msw, F, p: fSurvival(F, dfb, dfw) },
      welch,
    };
  }

  function contingency(xs, ys) {
    const rowsSet = new Set(), colsSet = new Set(), counts = new Map();
    let n = 0;
    for (let i = 0; i < xs.length; i++) {
      if (isMissing(xs[i]) || isMissing(ys[i])) continue;
      const r = String(xs[i]), c = String(ys[i]);
      rowsSet.add(r); colsSet.add(c);
      const key = r + "\u0000" + c;
      counts.set(key, (counts.get(key) || 0) + 1);
      n++;
    }
    const rows = Array.from(rowsSet).sort(naturalCompare), cols = Array.from(colsSet).sort(naturalCompare);
    const table = rows.map(r => cols.map(c => counts.get(r + "\u0000" + c) || 0));
    const rowTot = table.map(r => r.reduce((a, b) => a + b, 0));
    const colTot = cols.map((_, j) => table.reduce((a, r) => a + r[j], 0));
    let chi2 = 0, g2 = 0, lowExpected = 0;
    for (let i = 0; i < rows.length; i++) for (let j = 0; j < cols.length; j++) {
      const e = rowTot[i] * colTot[j] / n, o = table[i][j];
      if (e < 5) lowExpected++;
      if (e > 0) chi2 += (o - e) * (o - e) / e;
      if (o > 0) g2 += 2 * o * Math.log(o / e);
    }
    const df = (rows.length - 1) * (cols.length - 1);
    return { rows, cols, table, rowTot, colTot, n, chi2, g2, df, p: df > 0 ? chi2Survival(chi2, df) : NaN, pG2: df > 0 ? chi2Survival(g2, df) : NaN, lowExpected };
  }

  // ---------- matrices ----------
  function invert(A) {
    const n = A.length, M = A.map((r, i) => r.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-14) return null;
      [M[c], M[piv]] = [M[piv], M[c]];
      const d = M[c][c];
      for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c) {
        const f = M[r][c];
        if (f !== 0) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
      }
    }
    return M.map(r => r.slice(n));
  }

  // Symmetric eigendecomposition (Householder tridiagonalisation + implicit QL, as in JAMA).
  // Returns eigenvalues in descending order and the matching unit eigenvectors as columns of vectors.
  function eigSym(A) {
    const n = A.length;
    const V = A.map(r => Float64Array.from(r));
    const d = new Float64Array(n), e = new Float64Array(n);
    for (let j = 0; j < n; j++) d[j] = V[n - 1][j];
    for (let i = n - 1; i > 0; i--) {
      let scale = 0, h = 0;
      for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
      if (scale === 0) {
        e[i] = d[i - 1];
        for (let j = 0; j < i; j++) { d[j] = V[i - 1][j]; V[i][j] = 0; V[j][i] = 0; }
      } else {
        for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
        let f = d[i - 1], g = Math.sqrt(h);
        if (f > 0) g = -g;
        e[i] = scale * g; h -= f * g; d[i - 1] = f - g;
        for (let j = 0; j < i; j++) e[j] = 0;
        for (let j = 0; j < i; j++) {
          f = d[j]; V[j][i] = f; g = e[j] + V[j][j] * f;
          for (let k = j + 1; k <= i - 1; k++) { g += V[k][j] * d[k]; e[k] += V[k][j] * f; }
          e[j] = g;
        }
        f = 0;
        for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
        const hh = f / (h + h);
        for (let j = 0; j < i; j++) e[j] -= hh * d[j];
        for (let j = 0; j < i; j++) {
          f = d[j]; g = e[j];
          for (let k = j; k <= i - 1; k++) V[k][j] -= (f * e[k] + g * d[k]);
          d[j] = V[i - 1][j]; V[i][j] = 0;
        }
      }
      d[i] = h;
    }
    for (let i = 0; i < n - 1; i++) {
      V[n - 1][i] = V[i][i]; V[i][i] = 1;
      const h = d[i + 1];
      if (h !== 0) {
        for (let k = 0; k <= i; k++) d[k] = V[k][i + 1] / h;
        for (let j = 0; j <= i; j++) {
          let g = 0;
          for (let k = 0; k <= i; k++) g += V[k][i + 1] * V[k][j];
          for (let k = 0; k <= i; k++) V[k][j] -= g * d[k];
        }
      }
      for (let k = 0; k <= i; k++) V[k][i + 1] = 0;
    }
    for (let j = 0; j < n; j++) { d[j] = V[n - 1][j]; V[n - 1][j] = 0; }
    V[n - 1][n - 1] = 1; e[0] = 0;

    for (let i = 1; i < n; i++) e[i - 1] = e[i];
    e[n - 1] = 0;
    let f = 0, tst1 = 0;
    const eps = Math.pow(2, -52);
    for (let l = 0; l < n; l++) {
      tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
      let m = l;
      while (m < n) { if (Math.abs(e[m]) <= eps * tst1) break; m++; }
      if (m > l) {
        let iter = 0;
        do {
          if (++iter > 200) throw new Error("Eigen decomposition did not converge.");
          let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.hypot(p, 1);
          if (p < 0) r = -r;
          d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r);
          const dl1 = d[l + 1];
          let h = g - d[l];
          for (let i = l + 2; i < n; i++) d[i] -= h;
          f += h;
          p = d[m];
          let c = 1, c2 = c, c3 = c, s = 0, s2 = 0;
          const el1 = e[l + 1];
          for (let i = m - 1; i >= l; i--) {
            c3 = c2; c2 = c; s2 = s;
            g = c * e[i]; h = c * p; r = Math.hypot(p, e[i]);
            e[i + 1] = s * r; s = e[i] / r; c = p / r; p = c * d[i] - s * g;
            d[i + 1] = h + s * (c * g + s * d[i]);
            for (let k = 0; k < n; k++) {
              h = V[k][i + 1];
              V[k][i + 1] = s * V[k][i] + c * h;
              V[k][i] = c * V[k][i] - s * h;
            }
          }
          p = -s * s2 * c3 * el1 * e[l] / dl1; e[l] = s * p; d[l] = c * p;
        } while (Math.abs(e[l]) > eps * tst1);
      }
      d[l] += f; e[l] = 0;
    }
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => d[b] - d[a]);
    const values = order.map(i => d[i]);
    const vectors = order.map(i => {
      const v = Array.from({ length: n }, (_, k) => V[k][i]);
      // Sign convention: make the largest-magnitude element positive, so results are reproducible.
      let big = 0; for (let k = 1; k < n; k++) if (Math.abs(v[k]) > Math.abs(v[big])) big = k;
      return v[big] < 0 ? v.map(x => -x) : v;
    });
    return { values, vectors }; // vectors[i] is the eigenvector for values[i]
  }

  // Complete-case numeric matrix from a list of column value arrays.
  function completeCases(cols) {
    const n = cols.length ? cols[0].length : 0, rows = [], index = [];
    for (let i = 0; i < n; i++) {
      let ok = true;
      for (const c of cols) if (!(typeof c[i] === "number" && Number.isFinite(c[i]))) { ok = false; break; }
      if (ok) { rows.push(cols.map(c => c[i])); index.push(i); }
    }
    return { rows, index };
  }

  function covariance(rows, divisor) {
    const n = rows.length, d = rows[0].length;
    const mean = new Array(d).fill(0);
    for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j];
    for (let j = 0; j < d; j++) mean[j] /= n;
    const S = Array.from({ length: d }, () => new Float64Array(d));
    const c = new Float64Array(d);
    for (const r of rows) {
      for (let j = 0; j < d; j++) c[j] = r[j] - mean[j];
      for (let a = 0; a < d; a++) { const ca = c[a]; if (ca === 0) continue; const Sa = S[a]; for (let b = a; b < d; b++) Sa[b] += ca * c[b]; }
    }
    const div = divisor === "n" ? n : n - 1;
    const out = S.map(r => Array.from(r));
    for (let a = 0; a < d; a++) for (let b = a; b < d; b++) { out[a][b] /= div; out[b][a] = out[a][b]; }
    return { mean, cov: out };
  }

  function correlations(cols) {
    const { rows } = completeCases(cols), n = rows.length, d = cols.length;
    if (n < 3) return null;
    const { mean, cov } = covariance(rows);
    const sd = cov.map((r, i) => Math.sqrt(r[i]));
    const r = cov.map((row, i) => row.map((v, j) => (sd[i] > 0 && sd[j] > 0 ? v / (sd[i] * sd[j]) : NaN)));
    const p = r.map((row, i) => row.map((v, j) => {
      if (i === j || !Number.isFinite(v)) return NaN;
      if (Math.abs(v) >= 1) return 0;
      const t = v * Math.sqrt((n - 2) / (1 - v * v));
      return tTwoSidedP(t, n - 2);
    }));
    return { n, d, mean, sd, cov, r, p };
  }

  // Principal components on the covariance or correlation matrix (complete cases).
  function pca(cols, opts) {
    opts = opts || {};
    const { rows, index } = completeCases(cols), n = rows.length, d = cols.length;
    if (n < 2 || d < 1) throw new Error("PCA needs at least 2 complete rows.");
    const { mean, cov } = covariance(rows);
    const sd = cov.map((r, i) => Math.sqrt(r[i]));
    const standardize = opts.standardize !== false;
    if (standardize && sd.some(s => !(s > 0))) throw new Error("A column is constant, so it cannot be standardised.");
    const scale = standardize ? sd : sd.map(() => 1);
    const M = cov.map((r, i) => r.map((v, j) => v / (scale[i] * scale[j])));
    const { values, vectors } = eigSym(M);
    const ev = values.map(v => Math.max(0, v));
    const total = ev.reduce((a, b) => a + b, 0);
    let cum = 0;
    const components = ev.map((v, i) => { cum += v; return { eigenvalue: v, percent: 100 * v / total, cumPercent: 100 * cum / total, vector: vectors[i] }; });
    const scores = rows.map(r => vectors.map(vec => vec.reduce((s, w, j) => s + w * (r[j] - mean[j]) / scale[j], 0)));
    // Loadings = correlation-scale contribution: eigenvector * sqrt(eigenvalue)
    const loadings = vectors.map((vec, i) => vec.map(w => w * Math.sqrt(ev[i])));
    // Bartlett-free summary: number of components with eigenvalue > 1 (Kaiser) when standardised
    return { n, d, mean, scale, standardize, components, scores, loadings, index, total };
  }

  // Probabilistic PCA, closed-form maximum likelihood (Tipping & Bishop 1999).
  //   x = W z + mu + eps,  z ~ N(0, I_q),  eps ~ N(0, sigma2 I_d)
  //   sigma2 = mean of the discarded eigenvalues of S (S uses divisor N),
  //   W = U_q (Lambda_q - sigma2 I)^(1/2)   (rotation R = I).
  function ppca(cols, q, opts) {
    opts = opts || {};
    const { rows, index } = completeCases(cols), N = rows.length, d = cols.length;
    if (N < 2) throw new Error("PPCA needs at least 2 complete rows.");
    if (!(q >= 1 && q < d)) throw new Error("The number of latent dimensions must be between 1 and " + (d - 1) + ".");
    const { mean, cov } = covariance(rows, "n");
    const sdv = cov.map((r, i) => Math.sqrt(r[i]));
    const standardize = !!opts.standardize;
    if (standardize && sdv.some(s => !(s > 0))) throw new Error("A column is constant, so it cannot be standardised.");
    const scale = standardize ? sdv : sdv.map(() => 1);
    const S = cov.map((r, i) => r.map((v, j) => v / (scale[i] * scale[j])));
    const { values, vectors } = eigSym(S);
    const lam = values.map(v => Math.max(v, 0));
    let sigma2 = 0;
    for (let i = q; i < d; i++) sigma2 += lam[i];
    sigma2 /= (d - q);
    if (!(sigma2 > 0)) sigma2 = 1e-12 * Math.max(1e-300, lam[0]);
    // W: d x q
    const W = Array.from({ length: d }, (_, j) => Array.from({ length: q }, (_, k) => vectors[k][j] * Math.sqrt(Math.max(lam[k] - sigma2, 0))));
    // M = W'W + sigma2 I (q x q) is diagonal here: lam_k
    const Mdiag = Array.from({ length: q }, (_, k) => Math.max(lam[k], sigma2));
    // Posterior means of the latent variables: E[z|x] = M^-1 W' (x - mu)
    const xc = rows.map(r => r.map((v, j) => (v - mean[j]) / scale[j]));
    const latent = xc.map(x => Array.from({ length: q }, (_, k) => {
      let s = 0; for (let j = 0; j < d; j++) s += W[j][k] * x[j];
      return s / Mdiag[k];
    }));
    // Optimal reconstruction from the posterior mean: x_hat = W (W'W)^-1 M E[z|x] + mu
    const WtWdiag = Array.from({ length: q }, (_, k) => Math.max(lam[k] - sigma2, 1e-300));
    const recon = latent.map(z => Array.from({ length: d }, (_, j) => {
      let s = 0; for (let k = 0; k < q; k++) s += W[j][k] * Mdiag[k] / WtWdiag[k] * z[k];
      return s * scale[j] + mean[j];
    }));
    let se = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < d; j++) { const e = rows[i][j] - recon[i][j]; se += e * e; }
    // Log-likelihood: -N/2 [ d ln 2pi + ln|C| + tr(C^-1 S) ],  C = W W' + sigma2 I
    let logDetC = (d - q) * Math.log(sigma2);
    for (let k = 0; k < q; k++) logDetC += Math.log(Math.max(lam[k], sigma2));
    const logLik = -N / 2 * (d * Math.log(2 * Math.PI) + logDetC + d);
    const params = d * q - q * (q - 1) / 2 + 1 + d; // W (up to rotation), sigma2, mu
    const total = lam.reduce((a, b) => a + b, 0);
    return {
      N, d, q, mean, scale, standardize, eigenvalues: lam, sigma2, W, latent, recon, index,
      rmse: Math.sqrt(se / (N * d)), logLik, params, aic: -2 * logLik + 2 * params, bic: -2 * logLik + params * Math.log(N),
      explained: 100 * lam.slice(0, q).reduce((a, b) => a + b, 0) / total,
    };
  }

  // PPCA model choice for q = 1..d-1 from one set of eigenvalues (fit.eigenvalues, divisor N):
  // log-likelihood, AIC, BIC and the percentage of variance in the q-dimensional subspace.
  function ppcaProfile(eigenvalues, N, maxQ) {
    const d = eigenvalues.length, lam = eigenvalues.map(v => Math.max(v, 0));
    const total = lam.reduce((a, b) => a + b, 0), out = [];
    let head = 0, logHead = 0;
    for (let q = 1; q < Math.min(d, (maxQ || d - 1) + 1); q++) {
      head += lam[q - 1];
      let sigma2 = (total - head) / (d - q);
      if (!(sigma2 > 0)) sigma2 = 1e-12 * Math.max(1e-300, lam[0]);
      logHead += Math.log(Math.max(lam[q - 1], sigma2));
      const logLik = -N / 2 * (d * Math.log(2 * Math.PI) + logHead + (d - q) * Math.log(sigma2) + d);
      const params = d * q - q * (q - 1) / 2 + 1 + d;
      out.push({ q, sigma2, logLik, params, aic: -2 * logLik + 2 * params, bic: -2 * logLik + params * Math.log(N), explained: 100 * head / total });
    }
    return out;
  }

  // ---------- formatting ----------
  function fmt(v, digits) {
    if (v === null || v === undefined || Number.isNaN(v)) return "·";
    if (!Number.isFinite(v)) return v > 0 ? "∞" : "-∞";
    digits = digits == null ? 4 : digits;
    if (v === 0) return "0";
    const a = Math.abs(v);
    if (a >= 1e7 || a < 1e-4) return v.toExponential(digits - 1);
    const s = v.toPrecision(Math.max(digits, Math.floor(Math.log10(a)) + 1));
    return s.includes(".") && !s.includes("e") ? s.replace(/\.?0+$/, "") : s;
  }
  function fmtP(p) {
    if (p === null || p === undefined || Number.isNaN(p)) return "·";
    if (p < 0.0001) return "<.0001";
    return p.toFixed(4).replace(/^0/, "");
  }

  const api = {
    detectDelimiter, parseDelimited, tableFromRows, setColumnType, readXlsx, toCsv, isMissing, toNumber,
    lnGamma, betaInc, gammaInc, normCdf, normInv, tCdf, tTwoSidedP, tInv, fSurvival, chi2Survival,
    summarize, quantileSorted, frequencies, histogram, shapiroWilk, oneSampleT, naturalCompare,
    pairs, linearFit, polyFit, groupBy, oneway, contingency,
    invert, eigSym, completeCases, covariance, correlations, pca, ppca, ppcaProfile,
    fmt, fmtP,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GStats = api;
})(typeof window !== "undefined" ? window : globalThis);
