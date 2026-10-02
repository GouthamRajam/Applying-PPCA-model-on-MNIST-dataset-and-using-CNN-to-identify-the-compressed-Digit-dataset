// Checks the statistics engine against reference values computed with SciPy 1.17 and scikit-learn 1.9.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../app/stats.js");

const src = fs.readFileSync(path.join(__dirname, "../app/sample.js"), "utf8");
const csv = src.slice(src.indexOf("`") + 1, src.lastIndexOf("`"));
const iris = S.tableFromRows(S.parseDelimited(csv), "Iris");
const col = name => iris.columns.find(c => c.name === name).values;
const num = ["Sepal length", "Sepal width", "Petal length", "Petal width"].map(col);
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test("parses the Iris sample", () => {
  assert.strictEqual(iris.nrows, 150);
  assert.deepStrictEqual(iris.columns.map(c => c.type), ["numeric", "numeric", "numeric", "numeric", "categorical"]);
});

test("CSV parser handles quotes, missing values and other delimiters", () => {
  const t = S.tableFromRows(S.parseDelimited('a;b;"c ""x"""\r\n1;"p;q";NA\r\n2,5;r;3\r\n'));
  assert.deepStrictEqual(t.columns.map(c => c.name), ["a", "b", 'c "x"']);
  assert.strictEqual(t.columns[0].type, "categorical"); // "2,5" is not a number
  assert.strictEqual(t.columns[1].values[0], "p;q");
  assert.strictEqual(t.columns[2].type, "numeric");
  assert.ok(Number.isNaN(t.columns[2].values[0]));
  const csvOut = S.toCsv(["x", "y"], [[1, NaN], ["a,b", "c"]]);
  assert.strictEqual(csvOut, 'x,y\r\n1,"a,b"\r\n,c\r\n');
});

test("distributions", () => {
  close(S.tInv(0.975, 7), 2.364624251592784);
  close(S.tCdf(-1.3, 4.5), 0.128098043972017);
  close(S.fSurvival(3.2, 3, 17), 0.04985801504489658);
  close(S.chi2Survival(7.1, 3), 0.06877781936579971);
  close(S.normInv(0.001), -3.090232306167813);
  close(S.normCdf(1.7), 0.955434537241457);
});

test("summary statistics", () => {
  const s = S.summarize(num[0]);
  close(s.mean, 5.843333333333334); close(s.sd, 0.828066127977863);
  close(s.skewness, 0.3149109566369729); close(s.kurtosis, -0.5520640413156395);
  close(s.q1, 5.1); close(s.median, 5.8); close(s.q3, 6.4);
});

test("Shapiro-Wilk", () => {
  let r = S.shapiroWilk(num[0]); close(r.w, 0.9760902723490532, 1e-8); close(r.p, 0.010181161454691156, 1e-6);
  r = S.shapiroWilk(num[2]); close(r.w, 0.8762680554631075, 1e-4); assert.ok(r.p < 1e-8);
  r = S.shapiroWilk([2.1, 3.4, 1.9, 5.6, 4.4, 3.3, 2.8, 3.9, 4.1, 3.0]); close(r.w, 0.9713906031045022, 1e-4); close(r.p, 0.9034305013349915, 1e-6);
});

test("linear regression", () => {
  const f = S.linearFit(num[2], num[3]);
  close(f.slope, 0.41575541635241114); close(f.intercept, -0.36307552131902776);
  close(f.r, 0.9628654314027963); close(f.seSlope, 0.009582435790766206); close(f.seInt, 0.03976198987309611);
  const p1 = S.polyFit(num[2], num[3], 1);
  close(p1.predict(4), f.predict(4)); close(p1.rsq, f.rsq);
});

test("one-way ANOVA and Welch", () => {
  const a = S.oneway(col("Species"), num[0]);
  close(a.anova.F, 119.26450218450472); close(a.anova.p, 1.6696691907693648e-31, 1e-4);
  const b = S.oneway(col("Species"), num[1]);
  close(b.welch.F, 45.012035061070215); close(b.welch.df2, 97.40158711885606); close(b.welch.p, 1.4327350607248793e-14, 1e-4);
});

test("correlation and contingency", () => {
  const c = S.correlations([num[0], num[1]]);
  close(c.r[0][1], -0.11756978413300204); close(c.p[0][1], 0.1518982607114476);
  const t = S.contingency(col("Species"), num[3].map(v => (v > 1 ? "big" : "small")));
  close(t.chi2, 124.44821731748726); assert.strictEqual(t.df, 2); close(t.p, 9.471373608444235e-28, 1e-4);
});

test("eigen decomposition", () => {
  const A = [[4, 1, 2, 0.5], [1, 3, 0, 1], [2, 0, 5, 1.5], [0.5, 1, 1.5, 2]];
  const { values, vectors } = S.eigSym(A);
  values.forEach((l, i) => {
    const v = vectors[i];
    A.forEach((row, r) => close(row.reduce((s, a, j) => s + a * v[j], 0), l * v[r], 1e-10));
  });
});

test("PCA eigenvalues match scikit-learn", () => {
  const cov = S.pca(num, { standardize: false }).components.map(c => c.eigenvalue);
  [4.228241706034867, 0.24267074792863355, 0.07820950004291921, 0.023835092973449445].forEach((v, i) => close(cov[i], v));
  const cor = S.pca(num, { standardize: true }).components.map(c => c.eigenvalue);
  [2.918497816531996, 0.9140304714680709, 0.14675687557131495, 0.020714836428619272].forEach((v, i) => close(cor[i], v));
});

test("PPCA matches the Gaussian log-likelihood", () => {
  const f = S.ppca(num, 2);
  close(f.sigma2, 0.05068214786479666); close(f.logLik, -404.96278015611074);
  // With q = d - 1 latent dimensions and tiny noise, reconstruction is close to the data.
  assert.ok(S.ppca(num, 3).rmse < f.rmse);
  const prof = S.ppcaProfile(f.eigenvalues, f.N);
  assert.strictEqual(prof.length, 3);
  close(prof[1].logLik, f.logLik); close(prof[1].bic, f.bic); close(prof[0].logLik, S.ppca(num, 1).logLik);
});
