# Gothysis add-ins

Add-ins add your own analyses and tools to Gothysis, the way JMP add-ins extend JMP. They appear
in the **Add-Ins** tab; users install, turn on or off and remove them with the **Add-Ins** button.

## Installing (users)

- Click **Add-Ins → Install add-in…** and choose a `.gaddin` file, or drag the file onto the
  Gothysis window, or choose it with **Open…**.
- Installed add-ins are kept in `%LOCALAPPDATA%\Gothysis\addins\<id>\` and load every time
  Gothysis starts. Installing a newer version of the same add-in replaces the old one.
- Add-ins run their own JavaScript inside Gothysis with the same access as Gothysis itself.
  Install add-ins only from people you trust.

## JMP add-ins (.jmpaddin)

A `.jmpaddin` is a zip containing `addin.def`, `addin.jmpcust` (its menu items) and JSL
scripts. JSL only runs inside JMP, so Gothysis does not install `.jmpaddin` files. If you
choose one, Gothysis shows what is inside it (name, id, menu items and the script each one
runs, the JSL scripts with line counts, other files) and can save that as a text report.
To use the add-in in Gothysis, rewrite it as a `.gaddin`:

| JMP add-in | Gothysis add-in |
|---|---|
| `addin.def` (`id=`, `name=`) | `addin.json` (`id`, `name`, `version`, `main`, `apiVersion`) |
| `addin.jmpcust` menu item that runs a script | `Gothysis.addAnalysis(...)` or `Gothysis.addCommand(...)` |
| Launch window built with `Column Dialog` / `New Window` | `roles` and `options` in `addAnalysis` (Gothysis draws the launch bar) |
| `Current Data Table()`, `Column(...) << Get Values` | `ctx.role("key")`, `ctx.values("key")`, `ctx.column(name)` |
| Platform calls such as `Distribution(...)`, `Bivariate(...)` | `ctx.stats.*` functions and `ctx.chart.*` |
| `New Column(..., Values(...))` | `ctx.addColumn(name, values)` |
| `Outline Box`, `Table Box`, graphs | `ctx.card(title, html or chart)`, `ctx.table(head, rows)` |
| Extra files (`$ADDIN_HOME(id)\file`) | `Gothysis.fileUrl(ctx.addinId, "file")` |

## Package format

A `.gaddin` is a zip archive. Its files may sit at the top of the zip or in one folder:

```
addin.json      required: the manifest
main.js         the script named by "main"
...             any other files (more scripts, data, images)
```

`addin.json`:

```json
{
  "id": "com.mycompany.wijit",
  "name": "Wijit",
  "version": "1.0.0",
  "author": "My Company QA",
  "description": "What it does, in one line.",
  "main": "main.js",
  "apiVersion": 1
}
```

- `id`: 2–64 characters of lower-case letters, digits, `.`, `_`, `-`. Use reverse-DNS
  (`com.company.name`) so ids do not clash.
- Limits: 25 MB per `.gaddin`, 100 MB unpacked, 500 files.

To make the file on Windows: select the files in the add-in folder, right-click → **Send to →
Compressed (zipped) folder**, then rename the `.zip` to `.gaddin`. In this repository,
`bash build.sh` packs every folder in `addins/` into `dist/Gothysis/Add-ins/<name>.gaddin`.

## API (apiVersion 1)

`main.js` runs once when Gothysis starts (or when the add-in is installed or turned on) and
registers what the add-in offers on `window.Gothysis`.

### Gothysis.addAnalysis(definition)

```js
Gothysis.addAnalysis({
  id: "capability",                       // unique within the add-in
  name: "Process Capability",             // shown in the Add-Ins tab's Analysis list
  description: "Cp, Cpk, Pp, Ppk",
  roles: [                                // column pickers
    { key: "y", label: "Y, measurement", type: "numeric", required: true },
    { key: "by", label: "By", type: "categorical", required: false },
    { key: "xs", label: "X columns", type: "numeric", multiple: true },
  ],
  options: [                              // settings: "number" | "checkbox" | "select" | "text"
    { key: "lsl", label: "LSL", type: "number" },
    { key: "method", label: "Method", type: "select", choices: ["A", "B"], default: "A" },
  ],
  run(ctx) { /* draw results; may be async */ },
});
```

`run` is called again whenever the user changes a role or option. If it throws, Gothysis shows
the error in a card naming the add-in.

### Gothysis.addCommand(definition)

A one-click tool shown as a button at the top of the Add-Ins tab:

```js
Gothysis.addCommand({ id: "row-number", name: "Add row number column", run(ctx) { ... } });
```

### ctx (passed to run)

| Member | What it is |
|---|---|
| `ctx.data` | `{name, nrows, columns: [{name, type}]}` of the open table, or `null` |
| `ctx.role(key)` | the chosen column `{name, type, values}` (an array of them for `multiple` roles) |
| `ctx.values(key)` | a copy of the chosen column's values (numbers, `NaN` = missing; text, `null` = missing) |
| `ctx.column(name)` | any column by name |
| `ctx.options` | the current option values by key |
| `ctx.stats` | the Gothysis statistics library: `summarize`, `quantileSorted`, `frequencies`, `histogram`, `shapiroWilk`, `oneSampleT`, `linearFit`, `polyFit`, `oneway`, `contingency`, `correlations`, `pca`, `ppca`, `ppcaProfile`, `eigSym`, `invert`, `covariance`, `normCdf`, `normInv`, `tCdf`, `tInv`, `tTwoSidedP`, `fSurvival`, `chi2Survival`, `betaInc`, `gammaInc`, `lnGamma`, `toCsv`, … |
| `ctx.card(title, body, opts)` | adds a result card; `body` is an HTML string, a DOM node or a chart; `opts.sub` adds a subtitle, `opts.csv = () => text` adds a CSV button. Charts get PNG / SVG buttons automatically |
| `ctx.table(head, rows)` | HTML for a statistics table; cells are text, numbers or `{v, cls, style}` |
| `ctx.pCell(p)` | a p-value cell (highlighted when < .05) |
| `ctx.note(text)` | adds a line of explanatory text |
| `ctx.chart.histogram(values, name, {normal})` | histogram with box plot |
| `ctx.chart.bar(levels, name)` | bar chart of `[{level, count, prob}]` |
| `ctx.chart.scatter(points, {xlabel, ylabel, before(f), after(f)})` | scatter plot of `[{x, y, c, tip}]` |
| `ctx.chart.normalQuantile(values, name)` | normal quantile plot |
| `ctx.chart.frame({width, height, xdom, ydom, xlabel, ylabel})` | an empty plot to draw on: returns `{svg, plot, sx, sy, x0, y0, w, h, C}` |
| `ctx.chart.el(tag, attrs, parent)`, `ctx.chart.text(...)`, `ctx.chart.curve(f, fn, xdom, attrs)` | SVG drawing helpers |
| `ctx.chart.colors()` | theme colours (`ink`, `fill`, `line`, `cat[0..7]`, …), correct in light and dark mode |
| `ctx.addColumn(name, values, type)` | adds a column to the data table (`type` `"categorical"` for text); returns the final name |
| `ctx.fmt(v, digits)`, `ctx.fmtP(p)`, `ctx.escape(text)` | number, p-value and HTML formatting |
| `ctx.toast(text)`, `ctx.download(name, data, mime)` | a short message; save a file to Downloads |
| `ctx.addinId` | this add-in's id (for `Gothysis.fileUrl`) |

Other members of `window.Gothysis`: `apiVersion`, `version` (Gothysis version),
`fileUrl(addinId, file)`, `loadScript(url)`, `list()`.

## Example

`addins/process-capability/` is a complete add-in (Cp, Cpk, Pp, Ppk with confidence intervals,
% out of spec, histogram with spec limits, and an "Add row number column" tool). Its maths is
tested in `test/capability.test.js`.
