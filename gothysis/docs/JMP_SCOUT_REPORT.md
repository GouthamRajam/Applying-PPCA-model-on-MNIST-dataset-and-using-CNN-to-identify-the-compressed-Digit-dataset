# JMP scout report: UI, platforms, functions and options (JMP 19.2)

Prepared for Gothysis planning, 2 October 2026. Sources: the public JMP 19.2 PDF manuals on
jmp.com (Windows Menu Descriptions, JSL Syntax Reference, Basic Analysis, Fitting Linear Models,
Multivariate Methods, Predictive and Specialized Modeling, Quality and Process Methods, Essential
Graphing, Using JMP). All descriptions below are in our own words; counts come from parsing the
manual text and are approximate (±5%).

## 1. Size at a glance

| What | Count |
|---|---|
| Top-level menus | 12 (File, Edit, Tables, Rows, Cols, DOE, Analyze, Graph, Tools, View, Window, Help) plus Project/Format when open |
| Menu items on the Windows menu card | ~200 |
| Analysis platforms (Analyze menu, incl. Fit Model personalities) | ~94 |
| Graph platforms (incl. 5 profilers) | ~16 |
| Design of experiments (DOE) platforms | ~25 |
| **Total platforms** | **~135** |
| Documented JSL scripting functions and operators | ~905 in 34 categories |
| Parameters in those function signatures | ~1,377 required + ~368 optional |
| Documented report options (red-triangle menu items, launch roles, settings) in the analysis manuals | ~3,800 |
| Pages in the core manuals scanned | ~4,500 (9 PDFs); ~126,700 pages across all 192 PDFs for JMP 17 to 19.2 |

About 20 platforms are JMP Pro only (e.g. Generalized Regression, Mixed Models, Bootstrap Forest,
Boosted Tree, KNN, Naive Bayes, SVM, Model Screening, Structural Equation Models, Uplift).

## 2. How the UI is built (from the manual screenshots)

- **Home window**: recent files on the left, a window list (data tables with their reports nested
  under them) on the right, menu bar and toolbar on top.
- **Data table**: a spreadsheet grid on the right; on the left three stacked panels: table panel
  (saved scripts, red-triangle menu), columns panel (each column with a modeling-type icon:
  blue triangle = continuous, red bars = nominal, green bars = ordinal; counts of rows) and rows
  panel (selected / excluded / hidden / labelled counts). Column headers can show mini histograms.
- **Launch window** (same for every platform): left "Select Columns" list with type icons; middle
  "Cast Selected Columns into Roles" boxes (Y, X, Weight, Freq, By and platform-specific roles,
  marked *required* / *optional*); right "Action" buttons (OK, Cancel, Remove, Recall, Help).
- **Report window**: an outline of collapsible grey title bars (disclosure triangles). Every
  report node has a red-triangle menu with that node's options; this is where most of the ~3,800
  options live. Reports for several variables sit side by side.
- **Linked selection**: clicking a bar or point selects those rows in the data table and
  highlights them in every other open graph.
- **Graph Builder**: drag-and-drop canvas. Columns list on the left, drop zones around the plot
  (X, Y, Group X, Group Y, Wrap, Overlay, Color, Size, Freq, Page, Map), a row of element icons
  on top (points, smoother, line, bar, histogram, box plot, contour, heat map, pie, treemap, …),
  per-element settings panels on the left.
- **Visual style**: light grey report headers, sage-green default histogram fill, red accent for
  fitted lines, compact tables with right-aligned numbers.

## 3. Platform inventory and option counts

Option counts = distinct options found in that platform's chapter (red-triangle items, launch
roles and settings). ✔ = Gothysis has it, ◐ = partly, blank = not yet.

### Basic Analysis
| Platform | Options | Gothysis |
|---|---|---|
| Distribution | ~106 | ◐ histogram, box plot, quantiles, summary, normal quantile plot, Shapiro-Wilk, t test, frequencies |
| Fit Y by X: Bivariate | ~74 | ◐ linear / quadratic / cubic fit, confidence band, ANOVA, residuals |
| Fit Y by X: Oneway | ~129 | ◐ ANOVA, Welch, means and CIs |
| Fit Y by X: Contingency | ~67 | ◐ table, Pearson and likelihood-ratio chi-square |
| Fit Y by X: Logistic | ~22 | |
| Tabulate | ~50 | |
| Text Explorer | ~147 | |

### Fitting Linear Models (Fit Model personalities)
| Personality | Options | Gothysis |
|---|---|---|
| Model specification (launch) | ~72 | |
| Standard Least Squares | ~147 | |
| Stepwise | ~25 | |
| Generalized Regression (Pro) | ~83 | |
| Mixed Models (Pro) | ~62 | |
| Generalized Linear Mixed (Pro) | ~39 | |
| MANOVA / multivariate response | ~39 | |
| Loglinear Variance | ~23 | |
| Nominal / Ordinal Logistic | ~34 | |
| Generalized Linear Model | ~38 | |
| Causal Treatment | ~34 | |

### Multivariate Methods and Clustering
| Platform | Options | Gothysis |
|---|---|---|
| Multivariate (correlations) | ~52 | ◐ Pearson matrix, p-values, scatterplot matrix |
| Principal Components | ~58 | ◐ eigenvalues, scree, score / loading plots, save scores (plus PPCA, which JMP lacks as such) |
| Discriminant | ~60 | |
| Partial Least Squares | ~64 | |
| Multiple Correspondence Analysis | ~29 | |
| Structural Equation Models (Pro) | ~115 | |
| Factor Analysis | ~43 | |
| Multidimensional Scaling | ~12 | |
| Multivariate Embedding | ~29 | |
| Item Analysis | ~9 | |
| Hierarchical Cluster | ~61 | |
| K Means Cluster | ~32 | |
| Normal Mixtures | ~26 | |
| Latent Class Analysis | ~17 | |
| Cluster Variables | ~10 | |

### Predictive, Specialized and Screening
Neural ~33, Partition ~61, Bootstrap Forest ~27, Boosted Tree ~27, K Nearest Neighbors ~14,
Naive Bayes ~14, Support Vector Machines ~30, Model Screening ~32, Model Comparison ~11,
Make Validation Column ~18, Formula Depot ~14, Fit Curve ~59, Nonlinear ~61, Functional Data
Explorer ~95, Gaussian Process ~16, Bayesian Optimization ~36, Time Series ~82, Time Series
Forecast ~27, Matched Pairs ~23, Explore Outliers ~43, Explore Missing Values ~24, Explore
Patterns ~36, Response Screening ~61, Predictor Screening ~7, Association Analysis ~32, Process
History Explorer ~15. Gothysis: none yet.

### Quality and Process
Control Chart Builder ~97, Measurement Systems Analysis ~56, Type 1 Gauge ~23, Variability Gauge
~60, Attribute Gauge ~16, Process Screening ~69, Process Capability ~71, CUSUM ~21, EWMA ~25,
Model Driven Multivariate Control Chart ~35, Legacy Control Charts ~33, Pareto ~49,
Cause-and-Effect Diagram ~12, Manage Limits ~12, OC Curves ~18. Gothysis: none yet.

### Graphing
Graph Builder ~201, Bubble Plot ~24, Scatterplot Matrix ~15, Parallel Plot ~8, Cell Plot ~15,
Scatterplot 3D ~41, Contour Plot ~29, Ternary Plot ~8, Maps ~13, plus Profiler, Contour,
Mixture, Custom and Excel profilers. Gothysis: scatterplot matrix only (◐).

### Not scanned in detail
Reliability and Survival (15 platforms), Consumer Research (5), Life Sciences (7), DOE (~25),
and the data-table tools (Tables menu: 14 items such as Summary, Subset, Sort, Stack, Split,
Transpose, Join, Concatenate, Missing Data Pattern).

### JSL functions by category (~905)
Probability 85, Display 80, Programming 72, Utility 70, Matrix 64, Graphics 54, Random 44,
File 40, Transcendental 38, Date and Time 35, Statistical 34, Conditional and Logical 32,
Character 30, Character Pattern 28, Discrete Probability 25, List 18, Row State 18, Row 16,
SAS Integration 16, MATLAB 15, Financial 12, Trigonometric 12, Python 12, Numeric 11,
Comparison 9, JMPEX R 9, Assignment 7, Expression 7, Optimization 6, Constant, HTTP and SQL 2
each (Comment and R Integration functions were not counted by the parser). The Syntax Reference
covers "many" functions; the in-product Scripting Index lists more.

## 4. Where Gothysis stands

Gothysis covers about 5 of ~135 platforms, partly: Distribution, the three main Fit Y by X
personalities, Multivariate correlations and Principal Components (plus PPCA). Its PCA output on
the Iris data matches the eigenvalues in JMP's own Principal Components example
(2.918, 0.914, 0.147, 0.021).

## 5. Suggested build order (highest value per effort)

1. **Logistic** in Fit Y by X (completes Fit Y by X).
2. **Fit Model: Standard Least Squares** with several X columns, interactions, effect tests,
   leverage plots; then **Stepwise**.
3. **Distribution extras**: CDF plot, stem and leaf, test std dev, tolerance / prediction
   intervals, continuous fits (normal, lognormal, Weibull, gamma, exponential) with GOF.
4. **Oneway extras**: t test, Tukey HSD / Student's t comparisons, nonparametric (Wilcoxon /
   Kruskal-Wallis), unequal-variance tests (Levene, Brown-Forsythe, Bartlett).
5. **Clustering**: K Means and Hierarchical (with dendrogram).
6. **Quality**: Control Chart Builder basics (I-MR, X̄-R, X̄-S, p, np, c, u) and Process
   Capability (Cp, Cpk, Pp, Ppk).
7. **Data-table tools**: Summary, Subset, Sort, Stack, Split, Transpose, Join; row exclusion
   and linked selection between charts and the table.
8. **Graph Builder-style** drag-and-drop chart maker.
9. **Launch windows and red-triangle menus** so each report can be customised like JMP's.
