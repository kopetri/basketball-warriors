#!/bin/sh
# Pull-based deploy: every INTERVAL seconds, fetch main from GitHub; on a new commit, check it out in APP_DIR
# and run `docker compose up -d --build`. The NAS needs no inbound access; GitHub holds no secrets.
# Also deploys once at start, so `docker restart deployer-deployer-1` retries a failed deploy.
# Only signed commits are deployed: by an SSH key in /deploy/allowed_signers (the owner's own pushes), or by GitHub's
# web-flow key (merges made with the "Merge" button on GitHub). Commits pushed straight to main from someone
# else's machine are refused. Both trust lists live only on the NAS. Branches other than main are never fetched.
# Never run `git clean` here: data/ and .env live untracked in the same folder.
trap 'exit 0' TERM
export GIT_SSH_COMMAND="ssh -i /deploy/deploy_key -o UserKnownHostsFile=/deploy/known_hosts -o IdentitiesOnly=yes"
export GNUPGHOME=/tmp/gnupg
mkdir -p -m 700 "$GNUPGHOME" && gpg --batch --quiet --import /deploy/github-web-flow.gpg 2>/dev/null
git config --global --add safe.directory "$APP_DIR"
cd "$APP_DIR" || exit 1
[ -d .git ] || { git init -q -b main && git remote add origin "$REPO"; }

log() { echo "$(date -Iseconds) $*"; }

deploy() {
  old=$(git rev-parse -q --verify HEAD || echo none)
  git reset -q --hard "$1" || return 1
  docker compose up -d --build --remove-orphans || return 1
  # backup.sh is bind-mounted, so a running backup container keeps the old script until restarted
  if [ "$old" = none ] || git diff --name-only "$old" "$1" | grep -q '^backup/'; then docker compose restart backup; fi
  docker image prune -f >/dev/null
}

first=1
refused=
while :; do
  if git fetch -q origin main; then
    new=$(git rev-parse FETCH_HEAD)
    if [ -n "$first" ] || [ "$new" != "$(git rev-parse -q --verify HEAD)" ]; then
      if ! git -c gpg.ssh.allowedSignersFile=/deploy/allowed_signers verify-commit "$new" 2>/dev/null; then
        [ "$new" = "$refused" ] || log "REFUSED $(git log -1 --format='%h %s' "$new"): not signed by an allowed key or a GitHub merge"
        refused=$new
      else
        log "deploying $(git log -1 --format='%h %s' "$new")"
        if deploy "$new"; then log "deploy ok"; else log "deploy FAILED"; fi
      fi
    fi
    first=
  else
    log "fetch FAILED"
  fi
  sleep "${INTERVAL:-300}" &
  wait $!
done
