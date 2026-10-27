# GitHub Pages deployment

The [Deploy to GitHub Pages](../.github/workflows/deploy.yml) workflow builds and publishes the static `prototype/` runtime to GitHub Pages. It runs on **every push to `main`, including pull-request merges into `main`**, and can be run manually from the Actions tab on `main`. Pushes to feature branches and pull-request updates do not deploy.

## Required one-time repository setting

1. Open **Settings → Pages** in `reallakshman19/Word-to-Table`.
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Merge the deployment workflow pull request into `main`, or after merging choose **Actions → Deploy to GitHub Pages → Run workflow**, selecting `main`, to publish the site.

**Why this is required:** The failed run [#40448228000](https://github.com/reallakshman19/Word-to-Table/actions/runs/40448228000) stopped during `actions/configure-pages@v5`: Pages had not been enabled, and `enablement: true` tried to create the Pages site using the default `GITHUB_TOKEN`. The token does not have `administration:write`, so the API returned `Resource not accessible by integration`. An administrator must enable Pages in repository settings once; the workflow then uses `configure-pages` without attempting to enable the site.

## Verification and published content

- Pull-request CI runs the Pages bundle unit tests in `.github/workflows/xy-checks.yml`.
- Deployment also runs `python -m unittest discover -s tests -p test_pages_bundle.py` before building the Pages artifact.
- `python scripts/build_pages.py --output .pages-site` stages the public prototype runtime, including `index.html`, approved JS and CSS assets, and `.nojekyll`. It does not publish tests, document fixtures, logs, or private source files.
- Successful deployments are expected at https://reallakshman19.github.io/Word-to-Table/ unless a custom domain is configured.

To troubleshoot a failure, open **Actions → Deploy to GitHub Pages** and inspect the first failing step. If `Setup Pages` reports that a Pages site cannot be found, recheck **Settings → Pages → Source: GitHub Actions**.
