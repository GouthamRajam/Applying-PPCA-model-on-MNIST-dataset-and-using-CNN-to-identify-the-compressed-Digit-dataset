GOTHYSIS for Windows - statistics and PCA / PPCA on your own data
(independent open tool; not affiliated with JMP or SAS)

START
  1. Right-click Gothysis-Windows.zip -> Extract All.
  2. Double-click Gothysis.exe. Gothysis opens in its own window (it uses Microsoft Edge, which
     is already part of Windows 10/11; nothing is installed and no admin rights are needed).
  3. The first time, Windows may say "Windows protected your PC" because the app is not
     code-signed: click "More info" -> "Run anyway".
  Tip: right-click Gothysis.exe -> Send to -> Desktop (create shortcut).
  Gothysis closes itself about 20 seconds after you close its window.

DATA
  Open... (Ctrl+O) a .csv, .tsv, .txt or .xlsx file (first sheet), drag a file onto the window,
  or Paste data copied from Excel. The first row holds the column names. Each column is numeric
  (N) or categorical (C); click the letter in the column list to switch. Blank, NA, NaN, "." and
  "?" count as missing. Sample: Iris loads Fisher's Iris data to try things out.
  Your data stays on this computer: Gothysis only listens on 127.0.0.1 (port 47631).

ANALYSES
  Distribution    histogram with box plot and normal curve, quantiles, summary statistics,
                  normal quantile plot, Shapiro-Wilk test, one-sample t test; frequencies for
                  categorical columns.
  Fit Y by X      numeric Y, numeric X: linear / quadratic / cubic fit, 95% confidence band,
                  parameter estimates, ANOVA, residual plot.
                  numeric Y, categorical X: one-way ANOVA, Welch's test, means with 95% CIs.
                  categorical Y, categorical X: contingency table, Pearson and likelihood-ratio
                  chi-square.
  Correlations    Pearson correlation matrix with p-values, scatterplot matrix.
  PCA & PPCA      principal components on correlations or covariances: eigenvalues, scree,
                  score and loading plots, loading matrix, Save scores.
                  Probabilistic PCA (Tipping & Bishop, 1999): maximum-likelihood W and noise
                  variance, log-likelihood, AIC / BIC for every q, latent space plot, Save latent
                  (adds z columns and the reconstructed columns).

SAVING
  Save CSV saves the data table, including saved score/latent columns. Each chart has PNG and
  SVG buttons; tables have CSV buttons. Files go to your Downloads folder.
