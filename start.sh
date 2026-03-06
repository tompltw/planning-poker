#!/bin/bash
# Planning Poker - Start Script
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_LOG="/tmp/poker-backend.log"
FRONTEND_LOG="/tmp/poker-frontend.log"

echo "🃏 Starting Planning Poker..."

# Kill any existing instances
pkill -f "uvicorn main:app.*8002" 2>/dev/null || true
pkill -f "next.*3001" 2>/dev/null || true
sleep 1

# Start Backend
echo "⚙️  Starting backend (port 8002)..."
cd "$SCRIPT_DIR/backend"
source venv/bin/activate
nohup uvicorn main:app --host 0.0.0.0 --port 8002 > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"

# Wait for backend
sleep 2
if curl -s http://localhost:8002/api/health > /dev/null; then
    echo "   ✅ Backend ready"
else
    echo "   ❌ Backend failed to start. Check: $BACKEND_LOG"
    exit 1
fi

# Start Frontend
echo "🎨 Starting frontend (port 3001)..."
cd "$SCRIPT_DIR/frontend"
nohup npm run dev -- --port 3001 > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
echo "   Frontend PID: $FRONTEND_PID"

# Wait for frontend
echo "   Waiting for Next.js..."
for i in {1..15}; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3001 | grep -q "200"; then
        echo "   ✅ Frontend ready"
        break
    fi
    sleep 2
done

echo ""
echo "🚀 Planning Poker is live!"
echo "   App:     http://localhost:3001"
echo "   API:     http://localhost:8002"
echo "   Logs:    $BACKEND_LOG | $FRONTEND_LOG"
