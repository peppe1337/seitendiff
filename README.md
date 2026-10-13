# Seitendiff Watcher

A GitHub Actions template that monitors public web pages for content changes. No external service, no paid API, no dedicated server required.

[Impressum and privacy notice](https://peppe1337.github.io/impressum.html) (German), naming the responsible person. This repository was written by an autonomous AI agent operating under that named human owner.

## What it does

- Fetches configured public URLs on a schedule (every 6 hours: 00:00, 06:00, 12:00, 18:00 UTC) or on manual trigger.
- Extracts the fragment of the page identified by a CSS selector (see supported forms below).
- Removes sub-elements listed in `ignore` before comparison.
- Normalises the result (strips HTML comments, collapses whitespace) and compares it against the previously stored state.
- On change:
  - Appends a new entry to the Atom feed `feed.xml` (includes a line-based diff).
  - Opens a GitHub Issue. GitHub sends the notification email to repository watchers.
  - Commits the new state, diff, and feed back to the repository.
- On network or HTTP error: no alert is raised; the error is logged and the run continues with the remaining watchers.
- If opening the Issue fails, the workflow run fails visibly rather than passing silently. This matters: the new state is committed before the Issue is opened, so a swallowed error would consume the change without ever reporting it.
- On an unsupported selector form: the watcher for that entry is skipped with a `SelectorError` logged; no alert is raised.

## Setup

1. Use this repository as a GitHub template and create a new repository (public or private). The workflow is already in place at `.github/workflows/watch.yml`.
2. Edit `watch.config.json` to describe the pages to monitor (see structure below).
3. In the repository settings, go to *Settings → Actions → General* and confirm that the workflow has *Read and write permissions*.
4. Nothing to do for labels: the workflow creates the `seitendiff` label itself on first use if it is missing.
5. Trigger a first run manually under *Actions → Seitendiff-Wächter → Run workflow* to capture the initial state. From then on the schedule runs by itself.

The workflow does not run in this template repository itself, only in repositories created from it.

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

The script does not use an HTML parser. Selectors are matched with regular expressions. Only the following forms are supported (`scripts/watch.mjs`, line 42):

- Tag name only: `main`, `article`, `div`
- Class selector: `.news`, `.price-box`
- ID selector: `#content`
- Tag with class: `div.news`, `section.hero`
- Tag with ID: `div#main`, `article#post`

Any selector that does not match this pattern (for example `div > p`, `ul li`, `:first-child`, `[data-x]`) causes a `SelectorError`. When this happens, the watcher for that entry is skipped entirely — the body is **not** used as a fallback. The error is logged to the workflow output.

The same restriction applies to entries in the `ignore` array.

## File structure

```
watch.config.json          Configuration
.github/workflows/watch.yml  Workflow file
scripts/watch.mjs          Main script
scripts/feed.mjs           Atom feed generator
state/<id>.txt             Last normalised text per watcher
state/<id>.json            SHA-256, timestamp, HTTP status
out/<id>.diff              Last diff per watcher (max. 80 lines)
feed.xml                   Atom feed (max. 50 entries)
test/                      Offline tests
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
