# 🃏 Planning Poker

Real-time Scrum / Planning Poker app for agile teams.

## Features
- Create or join rooms via 8-char room code
- Real-time voting over WebSocket
- Fibonacci cards: 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, ?, ☕
- Hidden votes until reveal — no anchoring bias
- Stats on reveal: average, min, max, consensus detection
- Story/ticket description per round
- Observer mode (watch without voting)
- New round / reset flow
- Shareable room link

## Stack
- **Backend:** FastAPI + WebSockets (Python 3.12), port 8002
- **Frontend:** Next.js 14 + Tailwind CSS, port 3001

## Quick Start

```bash
./start.sh
```

Then open: http://localhost:3001

## Dev Setup

```bash
# Backend
cd backend && python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8002 --reload

# Frontend (separate terminal)
cd frontend && npm install
npm run dev -- --port 3001
```

## API

- `POST /api/rooms` — Create room `{name, created_by}`
- `GET /api/rooms/:id` — Get room state
- `WS /ws/:room_id/:user_id` — Real-time connection

### WebSocket Events (client → server)
| Event | Payload |
|-------|---------|
| `join` | `{name, is_observer}` |
| `vote` | `{vote}` |
| `reveal` | — |
| `reset` | `{story?}` |
| `set_story` | `{story}` |
| `kick` | `{user_id}` |
