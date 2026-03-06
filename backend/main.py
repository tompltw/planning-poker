from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List, Optional, Any
import json
import uuid
import asyncio

app = FastAPI(title="Planning Poker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Data Models ---
class Room:
    def __init__(self, room_id: str, name: str, created_by: str):
        self.id = room_id
        self.name = name
        self.created_by = created_by
        self.host_id: Optional[str] = None
        self.participants: Dict[str, dict] = {}
        self.revealed = False
        self.story = ""
        self.connections: Dict[str, WebSocket] = {}
        # Ticket backlog
        self.tickets: List[dict] = []  # [{id, title, estimate}]
        self.ticket_index: int = -1    # -1 = no backlog loaded

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "story": self.story,
            "revealed": self.revealed,
            "host_id": self.host_id,
            "participants": [
                {
                    "id": uid,
                    "name": p["name"],
                    "vote": p["vote"] if self.revealed else ("voted" if p["vote"] is not None else None),
                    "is_observer": p["is_observer"],
                }
                for uid, p in self.participants.items()
            ],
            "stats": self.get_stats() if self.revealed else None,
            "tickets": self.tickets,
            "ticket_index": self.ticket_index,
        }

    def get_stats(self):
        votes = [
            p["vote"] for p in self.participants.values()
            if p["vote"] is not None and p["vote"] not in ["?", "☕"] and not p["is_observer"] and p["vote"] != ""
        ]
        numeric = []
        for v in votes:
            try:
                numeric.append(float(v))
            except:
                pass
        if not numeric:
            return None
        avg = round(sum(numeric) / len(numeric), 1)
        return {
            "average": avg,
            "min": min(numeric),
            "max": max(numeric),
            "consensus": len(set(numeric)) == 1,
            "consensus_value": str(int(numeric[0])) if len(set(numeric)) == 1 and numeric[0] == int(numeric[0]) else str(numeric[0]) if len(set(numeric)) == 1 else None,
        }

    def save_current_estimate(self):
        """Auto-save estimate for current ticket based on votes."""
        if self.ticket_index < 0 or self.ticket_index >= len(self.tickets):
            return
        stats = self.get_stats()
        if stats is None:
            return
        # Only save if not already manually set
        ticket = self.tickets[self.ticket_index]
        if ticket.get("estimate") is None:
            if stats["consensus"] and stats["consensus_value"]:
                ticket["estimate"] = stats["consensus_value"]
            else:
                avg = stats["average"]
                ticket["estimate"] = str(int(avg)) if avg == int(avg) else str(avg)


# In-memory store
rooms: Dict[str, Room] = {}


# --- HTTP Endpoints ---
class CreateRoomRequest(BaseModel):
    name: str
    created_by: str

@app.post("/api/rooms")
def create_room(req: CreateRoomRequest):
    room_id = str(uuid.uuid4())[:8].upper()
    room = Room(room_id, req.name, req.created_by)
    rooms[room_id] = room
    return {"room_id": room_id, "name": room.name}

@app.get("/api/rooms/{room_id}")
def get_room(room_id: str):
    room = rooms.get(room_id.upper())
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room.to_dict()

@app.get("/api/health")
def health():
    return {"status": "ok", "rooms": len(rooms)}


# --- WebSocket ---
async def broadcast(room: Room, event: dict, exclude: Optional[str] = None):
    msg = json.dumps(event)
    dead = []
    for uid, ws in room.connections.items():
        if uid == exclude:
            continue
        try:
            await ws.send_text(msg)
        except:
            dead.append(uid)
    for uid in dead:
        room.connections.pop(uid, None)

@app.websocket("/ws/{room_id}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, user_id: str):
    await websocket.accept()
    room_id = room_id.upper()
    room = rooms.get(room_id)
    if not room:
        await websocket.send_text(json.dumps({"type": "error", "message": "Room not found"}))
        await websocket.close()
        return

    room.connections[user_id] = websocket
    await websocket.send_text(json.dumps({"type": "state", "room": room.to_dict()}))

    if user_id in room.participants:
        await broadcast(room, {"type": "state", "room": room.to_dict()})

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            event_type = msg.get("type")

            if event_type == "join":
                room.participants[user_id] = {
                    "name": msg["name"],
                    "vote": None,
                    "is_observer": msg.get("is_observer", False),
                }
                if room.host_id is None:
                    room.host_id = user_id
                await broadcast(room, {"type": "state", "room": room.to_dict()})

            elif event_type == "vote":
                if user_id in room.participants and not room.revealed:
                    room.participants[user_id]["vote"] = msg["vote"]
                    await broadcast(room, {"type": "state", "room": room.to_dict()})

            elif event_type == "reveal":
                if user_id == room.host_id:
                    room.revealed = True
                    room.save_current_estimate()
                    await broadcast(room, {"type": "state", "room": room.to_dict()})

            elif event_type == "reset":
                if user_id == room.host_id:
                    room.revealed = False
                    room.story = msg.get("story", room.story)
                    for p in room.participants.values():
                        p["vote"] = None
                    await broadcast(room, {"type": "state", "room": room.to_dict()})

            elif event_type == "set_story":
                if user_id == room.host_id:
                    room.story = msg.get("story", "")
                    await broadcast(room, {"type": "state", "room": room.to_dict()})

            elif event_type == "load_tickets":
                # Host loads a list of ticket titles
                if user_id == room.host_id:
                    titles = msg.get("tickets", [])
                    room.tickets = [
                        {"id": str(uuid.uuid4())[:8], "title": t.strip(), "estimate": None}
                        for t in titles if t.strip()
                    ]
                    room.ticket_index = 0 if room.tickets else -1
                    if room.tickets:
                        room.story = room.tickets[0]["title"]
                        room.revealed = False
                        for p in room.participants.values():
                            p["vote"] = None
                    await broadcast(room, {"type": "state", "room": room.to_dict()})

            elif event_type == "next_ticket":
                # Host advances to next ticket
                if user_id == room.host_id and room.ticket_index >= 0:
                    next_idx = room.ticket_index + 1
                    if next_idx < len(room.tickets):
                        room.ticket_index = next_idx
                        room.story = room.tickets[next_idx]["title"]
                        room.revealed = False
                        for p in room.participants.values():
                            p["vote"] = None
                        await broadcast(room, {"type": "state", "room": room.to_dict()})

            elif event_type == "set_estimate":
                # Host manually sets/overrides estimate for a ticket
                if user_id == room.host_id:
                    ticket_id = msg.get("ticket_id")
                    estimate = msg.get("estimate", "")
                    for t in room.tickets:
                        if t["id"] == ticket_id:
                            t["estimate"] = estimate if estimate else None
                            break
                    await broadcast(room, {"type": "state", "room": room.to_dict()})

            elif event_type == "kick":
                kicked_id = msg.get("user_id")
                if kicked_id and kicked_id in room.participants:
                    room.participants.pop(kicked_id, None)
                    if kicked_id in room.connections:
                        try:
                            await room.connections[kicked_id].send_text(json.dumps({"type": "kicked"}))
                            await room.connections[kicked_id].close()
                        except:
                            pass
                        room.connections.pop(kicked_id, None)
                    await broadcast(room, {"type": "state", "room": room.to_dict()})

    except WebSocketDisconnect:
        room.connections.pop(user_id, None)
        if user_id in room.participants:
            await broadcast(room, {"type": "state", "room": room.to_dict()})
