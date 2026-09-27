#!/bin/bash
# Stop the development processes, including Maven/npx child processes.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

stop_process_tree() {
    local pid="$1" child
    case "$pid" in ''|*[!0-9]*|0|1) return ;; esac
    for child in $(ps -eo pid=,ppid= | awk -v parent="$pid" '$2 == parent { print $1 }'); do
        stop_process_tree "$child"
    done
    kill "$pid" 2>/dev/null || true
}

for service in frontend backend metro; do
    pid_file="$PROJECT_DIR/.run/$service.pid"
    if [ -f "$pid_file" ]; then
        pid="$(cat "$pid_file")"
        rm -f "$pid_file"
        stop_process_tree "$pid"
        echo "Stopped $service"
    fi
done

# Ctrl+C keeps the database running; explicit stop only stops this project's DB.
if [ "${1:-}" != --keep-db ]; then
    cd "$PROJECT_DIR"
    if docker compose version >/dev/null 2>&1; then
        docker compose stop postgres
    else
        docker-compose stop postgres
    fi
fi
