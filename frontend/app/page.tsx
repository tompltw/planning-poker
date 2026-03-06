"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") return `http://${window.location.hostname}:8002`;
  return "http://localhost:8002";
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState<"home" | "create" | "join">("home");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const createRoom = async () => {
    if (!name.trim() || !roomName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${getApiBase()}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: roomName, created_by: name }),
      });
      const data = await res.json();
      // Store name in session
      sessionStorage.setItem("poker_name", name);
      router.push(`/room/${data.room_id}?name=${encodeURIComponent(name)}`);
    } catch (e) {
      setError("Failed to create room. Is the server running?");
    }
    setLoading(false);
  };

  const joinRoom = () => {
    if (!name.trim() || !joinCode.trim()) return;
    sessionStorage.setItem("poker_name", name);
    router.push(`/room/${joinCode.toUpperCase().trim()}?name=${encodeURIComponent(name)}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950">
      <div className="w-full max-w-md p-8">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="text-6xl mb-3">🃏</div>
          <h1 className="text-4xl font-bold text-white mb-2">Planning Poker</h1>
          <p className="text-slate-400 text-sm">Real-time Scrum estimation for agile teams</p>
        </div>

        {mode === "home" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Your Name</label>
              <input
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                placeholder="Enter your name..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && name.trim() && setMode("create")}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={() => { if (name.trim()) setMode("create"); }}
                disabled={!name.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition"
              >
                Create Room
              </button>
              <button
                onClick={() => { if (name.trim()) setMode("join"); }}
                disabled={!name.trim()}
                className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition"
              >
                Join Room
              </button>
            </div>
          </div>
        )}

        {mode === "create" && (
          <div className="space-y-4">
            <button onClick={() => setMode("home")} className="text-slate-400 hover:text-white text-sm flex items-center gap-1 mb-2">
              ← Back
            </button>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Room Name</label>
              <input
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                placeholder="Sprint 42 Planning..."
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createRoom()}
                autoFocus
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              onClick={createRoom}
              disabled={!roomName.trim() || loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition mt-2"
            >
              {loading ? "Creating..." : "Create Room →"}
            </button>
          </div>
        )}

        {mode === "join" && (
          <div className="space-y-4">
            <button onClick={() => setMode("home")} className="text-slate-400 hover:text-white text-sm flex items-center gap-1 mb-2">
              ← Back
            </button>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Room Code</label>
              <input
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition uppercase tracking-widest text-center text-xl font-mono"
                placeholder="ABC123"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                maxLength={8}
                autoFocus
              />
            </div>
            <button
              onClick={joinRoom}
              disabled={!joinCode.trim()}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition mt-2"
            >
              Join Room →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
