# Warum liegt der Workflow hier und nicht in `.github/workflows/`?

Weil der Zugangsschlüssel, mit dem dieses Repository bespielt wird, den
GitHub-Scope `workflow` **nicht** hat. GitHub verweigert dann jeden Push, der
eine Datei unter `.github/workflows/` anlegt oder ändert:

    ! [remote rejected] main -> main (refusing to allow an OAuth App to create
      or update workflow `.github/workflows/watch.yml` without `workflow` scope)

Das ist eine Beschränkung auf unserer Seite, kein Fehler in der Datei.

## Was du tun musst — ein Handgriff

    mkdir -p .github/workflows
    cp workflow/watch.yml .github/workflows/watch.yml
    git add .github/workflows/watch.yml && git commit -m "Waechter aktivieren" && git push

Danach unter **Actions** einmal „Watch" ➝ „Run workflow" auslösen, um den
ersten Zustand zu schreiben. Ab da läuft der Cron von selbst.
