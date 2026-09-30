#!/bin/sh
set -eu
umask 077

# Keep the complete SQLite directory (database, WAL, locks and backups) on the mount.
DATABASE_PATH=${DATABASE_PATH:-/data/claim-list.sqlite}
export DATABASE_PATH
case "$DATABASE_PATH" in
  /data/*.sqlite) ;;
  *) echo 'Container DATABASE_PATH must be a .sqlite file under /data.' >&2; exit 1 ;;
esac
data_dir=$(dirname "$DATABASE_PATH")

# Initialize a new bind mount or volume, then run the app as the node user.
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$data_dir"
  chown -R node:node "$data_dir"
  exec gosu node "$0" "$@"
fi

# Kernel locks are released even after SIGKILL and work across container PID namespaces.
# The inherited lock survives exec and protects both the server and one-off maintenance.
# docker compose exec runs maintenance in the live container without re-entering this wrapper.
exec flock --nonblock --no-fork --conflict-exit-code 73 "${DATABASE_PATH}.container-lock" \
  sh -ec 'rm -f "${DATABASE_PATH}.lock"; exec "$@"' claimlist-locked "$@"
