# Seitendiff Watcher

A GitHub Actions template that monitors public web pages for content changes. No external service, no paid API, no dedicated server required.

[Impressum and privacy notice](https://peppe1337.github.io/impressum.html) (German), naming the responsible person. This repository was written by an autonomous AI agent operating under that named human owner.

## Usage

### As an action in any repository

Add a `watch.config.json` (see below) and this workflow, for example as `.github/workflows/seitendiff.yml`. The action itself is the last two lines.

```yaml
on:
  schedule:
    - cron: '0 */6 * * *'
  workflow_dispatch:
permissions:
  contents: write
  issues: write
jobs:
  watch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: peppe1337/seitendiff@v1
```

The action commits its state to the repository it runs in, so `actions/checkout` has to come first. If your repository already uses or ignores `state/` or `out/`, set `data-dir` to a folder of its own.

| Input      | Default               | Description |
|------------|-----------------------|-------------|
| `config`   | `watch.config.json`   | Path to the config file, relative to the repository root |
| `token`    | `${{ github.token }}` | Token used to create the label and open issues; needs `issues: write` |
| `data-dir` | `.`                   | Folder for `state/`, `out/` and `feed.xml`, relative to the repository root |

Outputs: `has_changes` (`'true'` or `'false'`) and `changed_ids` (comma-separated ids).

### As a template

1. Use this repository as a GitHub template and create a new repository (public or private). The workflow is already in place at `.github/workflows/watch.yml` and calls the action from the same repository.
2. Edit `watch.config.json` to describe the pages to monitor (see structure below).
3. Trigger a first run under *Actions → Seitendiff watcher → Run workflow*. It records the initial state. From then on the schedule runs by itself.

The workflow requests `contents: write` and `issues: write` itself. If your organisation restricts the workflow token, allow read and write access under *Settings → Actions → General*. The workflow does not run in this template repository itself, only in repositories created from it.

## What it does

- Fetches configured public URLs on a schedule (the template uses every 6 hours: 00:00, 06:00, 12:00, 18:00 UTC) or on manual trigger.
- Extracts the fragment of the page identified by a CSS selector (see supported forms below).
- Removes sub-elements listed in `ignore` before comparison.
- Normalises the result (strips HTML comments, collapses whitespace) and compares it against the previously stored state.
- On the first run for a page: commits that state as the baseline. Nothing is reported.
- On change:
  - Appends a new entry to the Atom feed `feed.xml` (includes a line-based diff).
  - Opens a GitHub Issue labelled `seitendiff`, with a link to the diff. The label is created on first use. GitHub sends the notification email to repository watchers.
  - Commits the new state, diff, and feed back to the repository.
- When nothing changed, nothing is committed. Only the check timestamps would differ, and those are not worth a commit.
- On network or HTTP error: no alert is raised; the error is logged as a warning and the run continues with the remaining watchers.
- If the config file cannot be read, the run fails.
- If opening the Issue fails, the workflow run fails visibly rather than passing silently. This matters: the new state is committed before the Issue is opened, so a swallowed error would consume the change without ever reporting it.
- On an unsupported selector form: the watcher for that entry is skipped with a `SelectorError` logged; no alert is raised.

## watch.config.json

```json
[
  {
    "id":       "my-site",
    "url":      "https://example.com/news",
    "selector": "main",
    "ignore":   ["nav", ".ads"],
    "label":    "My Site – News"
  }
]
```

| Field      | Required | Description |
|------------|----------|-------------|
| `id`       | yes      | Unique identifier; used as a filename component — no spaces or special characters |
| `url`      | yes      | Public URL to fetch |
| `selector` | no       | CSS selector identifying the element to watch (supported forms only, see below). If empty or omitted, the entire `<body>` is compared |
| `ignore`   | no       | Array of selectors; matching elements are removed from the extracted fragment before comparison |
| `label`    | yes      | Human-readable description; appears in the Issue title |

## Supported selector forms

The script does not use an HTML parser. Selectors are matched with regular expressions. Only the following forms are supported (see `SELECTOR_PATTERN` in [scripts/watch.mjs](scripts/watch.mjs)):

- Tag name only: `main`, `article`, `div`
- Class selector: `.news`, `.price-box`
- ID selector: `#content`
- Tag with class: `div.news`, `section.hero`
- Tag with ID: `div#main`, `article#post`

Any selector that does not match this pattern (for example `div > p`, `ul li`, `:first-child`, `[data-x]`) causes a `SelectorError`. When this happens, the watcher for that entry is skipped entirely — the body is **not** used as a fallback. The error is logged to the workflow output.

The same restriction applies to entries in the `ignore` array.

## File structure

```
action.yml                   Action definition (used by both usage modes)
watch.config.json            Configuration
.github/workflows/watch.yml  Template workflow, calls action.yml
scripts/watch.mjs            Main script
scripts/feed.mjs             Atom feed generator
state/<id>.txt               Last normalised text per watcher
state/<id>.json              SHA-256, timestamp, HTTP status
out/<id>.diff                Last diff per watcher (max. 80 lines)
feed.xml                     Atom feed (max. 50 entries)
test/                        Offline tests
```

## Running tests locally

```bash
node test/rot-gruen.mjs
```

The tests run without a network connection.

## Limitations

- **Selector subset only.** Only the five selector forms listed above are supported. Descendant combinators, pseudo-classes, attribute selectors, and multi-class selectors are not supported and will cause the affected watcher entry to be skipped.
- **No JavaScript rendering.** The script fetches raw HTML with `fetch()`. Pages that require JavaScript to render their content (single-page applications, client-side hydration) are not supported — only the initial HTML response is compared.
- **Schedule timing is approximate.** GitHub Actions cron schedules do not fire at exact times; delays of several minutes are common under load.
- **Inactive repository suspension.** GitHub may disable scheduled workflows in repositories that have had no commits for 60 days. Re-enable them manually in the Actions tab.
- **Runner IP blocks.** Some websites block requests from GitHub-hosted runner IP ranges.
- **Diff readability.** The diff algorithm is line-based without LCS (longest common subsequence). Large reformattings produce verbose diffs.
- **Feed size.** The Atom feed retains at most 50 entries; older entries are discarded.
- **Pages behind authentication or CAPTCHA** cannot be fetched.
