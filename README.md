# Seitendiff Watcher

Watches one part of a public web page from GitHub Actions and opens an issue in your repository when that part changes.

**Use it when**

- you care about one block of a page, such as a price, a notice, a changelog or a job list, and not the rest of the page
- you watch a handful of pages, and a check every few hours is soon enough
- you want no external service, no API key and no server, only a repository you own

**Don't use it when**

- the content is rendered by JavaScript. Seitendiff reads the raw HTML response and runs no scripts.
- you want to watch hundreds of pages. Pages are fetched one after another in a single job.
- you need alerts within minutes. GitHub starts scheduled runs late, often by several minutes.
- the page needs a login or shows a CAPTCHA, or you need selectors beyond the [five simple forms](#supported-selector-forms)

## Quick start: as an action

Add a [`watch.config.json`](#watchconfigjson) to any repository, plus this workflow, for example as `.github/workflows/seitendiff.yml`. The action itself is the last two lines.

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

The first run records the watched part of each page and commits it. Each later run that finds a difference commits the new state and opens an issue labelled `seitendiff`. GitHub notifies everyone watching the repository, by email if they have that turned on.

## Setup: as a template

If you would rather have everything in one place, create a repository from this one:

1. Click **Use this template** at the top of this page and create a new repository, public or private. The workflow is already in place at `.github/workflows/watch.yml` and calls the action from the same repository.
2. Edit `watch.config.json` to list the pages you want to watch.
3. Start a first run under *Actions → Seitendiff watcher → Run workflow*. It records the initial state. From then on the schedule runs by itself, every 6 hours.

The workflow requests `contents: write` and `issues: write` itself. If your organisation restricts the workflow token, allow read and write access under *Settings → Actions → General*. The workflow does not run in this template repository itself, only in repositories created from it.

## Configuration

### watch.config.json

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
| `id`       | yes      | Unique identifier. Used in file names and in the issue title, so no spaces or special characters |
| `url`      | yes      | Public URL to fetch |
| `selector` | no       | Selector for the element to watch, in one of the supported forms below. If empty or omitted, the entire `<body>` is compared |
| `ignore`   | no       | Array of selectors. Matching elements are removed from the watched part before comparison |
| `label`    | yes      | Human-readable name, used as the title of the feed entry |

### Supported selector forms

There is no HTML parser. Selectors are matched with regular expressions, and only these forms work (see `SELECTOR_PATTERN` in [scripts/watch.mjs](scripts/watch.mjs)):

- Tag name only: `main`, `article`, `div`
- Class selector: `.news`, `.price-box`
- ID selector: `#content`
- Tag with class: `div.news`, `section.hero`
- Tag with ID: `div#main`, `article#post`

Any other selector, for example `div > p`, `ul li`, `:first-child` or `[data-x]`, causes a `SelectorError`. The same happens when a selector matches nothing. That page is then skipped and the error is logged. The whole body is **not** used as a fallback. Entries in `ignore` must use the same forms, but an `ignore` entry that matches nothing is fine.

### Action inputs and outputs

| Input      | Default               | Description |
|------------|-----------------------|-------------|
| `config`   | `watch.config.json`   | Path to the config file, relative to the repository root |
| `token`    | `${{ github.token }}` | Token used to create the label and open issues. Needs `issues: write` |
| `data-dir` | `.`                   | Folder for `state/`, `out/` and `feed.xml`, relative to the repository root. Set it if your repository already uses or ignores `state/` or `out/` |

| Output        | Description |
|---------------|-------------|
| `has_changes` | `'true'` if at least one watched part changed in this run, otherwise `'false'` |
| `changed_ids` | Comma-separated ids of the pages that changed |

The action commits to the repository it runs in, so `actions/checkout` has to run first and the job needs `contents: write`. It needs Node.js 18 or newer and the GitHub CLI on the runner. GitHub-hosted runners have both.

## How it works

1. Each configured URL is fetched in turn, with a 15-second timeout.
2. The element matched by `selector` is cut out, elements matched by `ignore` are removed, HTML comments are stripped and whitespace is collapsed.
3. The result is compared with the stored state in `state/<id>.txt`.
4. On the first run for a page, that state is committed as the baseline. Nothing is reported.
5. On a change, a diff goes to `out/<id>.diff` and an entry to the Atom feed `feed.xml`. State, diff and feed are committed and pushed. Then an issue labelled `seitendiff` is opened with a link to the diff. The label is created on first use.
6. When nothing changed, nothing is committed. Only the check timestamps in `state/<id>.json` would differ, and they are not worth a commit.
7. A network error, an HTTP error or a selector problem raises no alert. It is logged as a warning, the remaining pages are still checked, and the run stays green.
8. If the config file cannot be read, the run fails.
9. If the issue cannot be opened, the run fails visibly. This matters: the new state is already committed at that point, so a swallowed error would use up the change without ever reporting it.

Files in the repository:

```
action.yml                   Action definition, used by both setups
watch.config.json            Configuration
.github/workflows/watch.yml  Template workflow, calls action.yml
scripts/watch.mjs            Fetch, extract, compare
scripts/feed.mjs             Atom feed generator
state/<id>.txt               Last normalised text per page
state/<id>.json              SHA-256, timestamp, HTTP status
out/<id>.diff                Last diff per page
feed.xml                     Atom feed, at most 50 entries
test/                        Offline tests
```

## Limitations

- **Selector subset only.** Descendant combinators, pseudo-classes, attribute selectors and multi-class selectors are not supported. A page configured with one of them is skipped.
- **No JavaScript rendering.** Pages are fetched with `fetch()`. Only the initial HTML response is compared, so single-page applications and client-side rendered content are out of reach.
- **Coarse diffs.** Normalisation collapses the watched part into a single line. The diff therefore shows the whole old text and the whole new text, not just the changed words.
- **Approximate schedule.** GitHub Actions cron schedules do not fire at exact times. Delays of several minutes are common under load.
- **Inactive repository suspension.** GitHub disables scheduled workflows in public repositories after 60 days without activity. Seitendiff only commits when something changed, so a quiet page can run into this. Re-enable the workflow in the Actions tab.
- **Runner IP blocks.** Some websites block requests from GitHub-hosted runner IP ranges.
- **Feed size.** The Atom feed keeps at most 50 entries. Older entries are dropped.

## Running the tests

```bash
node test/rot-gruen.mjs
```

The tests need no network connection.

---

MIT License, see [LICENSE](LICENSE).

This repository was written by an autonomous AI agent operating under a named human owner. The [Impressum and privacy notice](https://peppe1337.github.io/impressum.html) (German) names the responsible person.
