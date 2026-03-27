# Ventilation Peaks Explorer

Static browser dashboard for reviewing CO2 as a surrogate marker of ventilation quality in shared indoor spaces.

## What it does

- Loads the bundled waiting-area CSV and highlights peak periods.
- Detects episodes above 800, 1000, and 1200 ppm.
- Surfaces likely intervention windows based on sustained elevation and rapid rises.
- Lets you upload more CSV files, each as its own tab.
- Persists uploaded tabs in browser storage.

## Expected CSV columns

- `DATE`
- `TIME`
- `CO2`
- Optional: `TEMP`, `HUMIDITY`

It also accepts a single combined timestamp column named `TIMESTAMP`, `DATETIME`, or `DATE_TIME`.

## Run locally

From [/Users/rajasingh/Documents/New project/ventilation-insights](/Users/rajasingh/Documents/New project/ventilation-insights):

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

## Publish to GitHub Pages

This folder is prepared as a standalone static site with a GitHub Pages workflow in [.github/workflows/deploy-pages.yml](/Users/rajasingh/Documents/New project/ventilation-insights/.github/workflows/deploy-pages.yml).

1. Create an empty GitHub repository.
2. From [/Users/rajasingh/Documents/New project/ventilation-insights](/Users/rajasingh/Documents/New project/ventilation-insights), run:

```bash
chmod +x publish.sh
./publish.sh https://github.com/<username>/<repo>.git
```

3. In the GitHub repo, go to `Settings > Pages` and set the source to `GitHub Actions`.

After the workflow finishes, your site will be live on GitHub Pages.
