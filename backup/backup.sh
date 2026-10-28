#!/bin/sh
# Database backup: one pg_dump at container start, then every night at 03:30 (container time zone).
# Writes /backups/warriors-YYYY-MM-DD.dump (custom format, restore with pg_restore) and keeps KEEP_DAYS days.
# Old dumps are pruned only after a successful new dump, so failing dumps never delete the last good ones.
trap 'exit 0' TERM

dump() {
  file="/backups/warriors-$(date +%F).dump"
  if pg_dump -Fc -f "$file.tmp" && mv "$file.tmp" "$file"; then
    echo "$(date -Iseconds) backup ok $file $(du -h "$file" | cut -f1)"
    find /backups -name 'warriors-*.dump' -mtime "+${KEEP_DAYS:-14}" -delete
  else
    rm -f "$file.tmp"
    echo "$(date -Iseconds) backup FAILED" >&2
  fi
}

# after a NAS reboot Docker starts all containers at once, without waiting for db to be healthy
until pg_isready -q; do sleep 2; done
dump
while :; do
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) 03:30" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now)) &
  wait $!
  dump
done
