#!/bin/bash
# AI Route Planner — Web 前端 + Spring Boot 开发环境
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

for command in mvn npx curl; do
    command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done

# macOS terminals may still default to Java 8 even when Java 21 is installed.
if [ "$(uname -s)" = Darwin ]; then
    if DEV_JAVA_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null); then
        export JAVA_HOME="$DEV_JAVA_HOME"
        export PATH="$JAVA_HOME/bin:$PATH"
    fi
fi

if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
else
    echo "Docker Compose is required." >&2
    exit 1
fi

for service in backend frontend; do
    pid_file="$PROJECT_DIR/.run/$service.pid"
    if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
        echo "Development services are already running. Stop them with ./scripts/stop-dev.sh first." >&2
        exit 1
    fi
done

mkdir -p "$PROJECT_DIR/.run"
cleanup() { bash "$SCRIPT_DIR/stop-dev.sh" --keep-db; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "[1/3] Starting PostgreSQL..."
"${COMPOSE[@]}" up -d postgres

echo "[2/3] Starting Backend (http://localhost:8081)..."
mvn spring-boot:run -Dspring-boot.run.arguments=--server.port=8081 > "$PROJECT_DIR/.run/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PROJECT_DIR/.run/backend.pid"

wait_for_service() {
    local pid="$1" url="$2" log="$3"
    for ((i=0; i<60; i++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
            echo "Service exited. See $log" >&2
            tail -n 30 "$log"
            return 1
        fi
        if curl --fail --silent --max-time 2 "$url" >/dev/null; then
            return 0
        fi
        sleep 2
    done
    echo "Service did not become ready: $url. See $log" >&2
    tail -n 30 "$log"
    return 1
}

wait_for_service "$BACKEND_PID" http://localhost:8081/api/route/health "$PROJECT_DIR/.run/backend.log"

echo "[3/3] Starting Web Frontend (routeplan/)..."
npx --yes serve "$PROJECT_DIR/routeplan" --listen 3000 --no-port-switching > "$PROJECT_DIR/.run/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$PROJECT_DIR/.run/frontend.pid"
wait_for_service "$FRONTEND_PID" http://localhost:3000/index.html "$PROJECT_DIR/.run/frontend.log"

echo ""
echo "Frontend: http://localhost:3000"
echo "Backend:  http://localhost:8081"
echo "Logs:     $PROJECT_DIR/.run/"
echo "Press Ctrl+C to stop, or run ./scripts/stop-dev.sh"

# Detect either service exiting; a plain 'wait' can hide a failed child.
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
    sleep 2
done
echo "A development service stopped. Check .run/ for logs." >&2
exit 1
