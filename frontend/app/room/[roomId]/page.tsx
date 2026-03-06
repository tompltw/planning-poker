"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";

// Dynamically resolve WS base — called inside useEffect so window is always available
function getWsBase(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (apiUrl) return apiUrl.replace(/^http/, "ws");
  return `ws://${window.location.hostname}:8002`;
}

const FIBONACCI_CARDS = ["0", "1", "2", "3", "5", "8", "13", "21", "?", "☕"];

const THEMES = {
  dark:   { name: "Dark",   swatch: "#1e293b", page: "bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950",  header: "bg-slate-900/60 border-slate-700/50",  table: "from-green-900/60 to-green-950/80 border-green-700/50" },
  ocean:  { name: "Ocean",  swatch: "#0c4a6e", page: "bg-gradient-to-br from-blue-950 via-blue-900 to-teal-950",      header: "bg-blue-950/60 border-blue-700/50",    table: "from-teal-800/60 to-teal-950/80 border-teal-600/50" },
  forest: { name: "Forest", swatch: "#14532d", page: "bg-gradient-to-br from-emerald-950 via-emerald-900 to-green-950", header: "bg-emerald-950/60 border-emerald-700/50", table: "from-emerald-700/60 to-emerald-950/80 border-emerald-500/50" },
  sunset: { name: "Sunset", swatch: "#7c2d12", page: "bg-gradient-to-br from-orange-950 via-rose-900 to-orange-950",  header: "bg-orange-950/60 border-orange-800/50", table: "from-amber-800/60 to-orange-950/80 border-amber-600/50" },
  nebula: { name: "Nebula", swatch: "#4c1d95", page: "bg-gradient-to-br from-purple-950 via-violet-900 to-purple-950", header: "bg-purple-950/60 border-purple-700/50",  table: "from-violet-900/60 to-purple-950/80 border-violet-600/50" },
} as const;
type ThemeKey = keyof typeof THEMES;

type Participant = {
  id: string;
  name: string;
  vote: string | null; // null = not voted, "voted" = voted (hidden), actual value when revealed
  is_observer: boolean;
};

type Stats = {
  average: number;
  min: number;
  max: number;
  consensus: boolean;
  consensus_value: string | null;
};

type Ticket = {
  id: string;
  title: string;
  estimate: string | null;
};

type RoomState = {
  id: string;
  name: string;
  story: string;
  revealed: boolean;
  host_id: string | null;
  participants: Participant[];
  stats: Stats | null;
  tickets: Ticket[];
  ticket_index: number;
};

function getVoteColor(vote: string | null, revealed: boolean): string {
  if (!vote || vote === "voted") return "";
  const num = parseFloat(vote);
  if (isNaN(num)) return "text-purple-400";
  if (num <= 3) return "text-green-400";
  if (num <= 8) return "text-yellow-400";
  if (num <= 21) return "text-orange-400";
  return "text-red-400";
}

export default function RoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const roomId = (params.roomId as string).toUpperCase();

  // Resolve name: URL param > sessionStorage > prompt
  // NOTE: sessionStorage is read in useEffect only (never during SSR) to avoid hydration mismatch
  const nameFromUrl = searchParams.get("name");
  const [userName, setUserName] = useState(nameFromUrl || "");
  const [nameReady, setNameReady] = useState(!!nameFromUrl);
  const [nameInput, setNameInput] = useState(nameFromUrl || "");

  // Populate name from sessionStorage client-side after mount
  useEffect(() => {
    if (!nameFromUrl) {
      const stored = sessionStorage.getItem("poker_name");
      if (stored) {
        setUserName(stored);
        setNameInput(stored);
        setNameReady(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [userId] = useState(() => {
    if (typeof window !== "undefined") {
      let id = sessionStorage.getItem("poker_user_id");
      if (!id) { id = Math.random().toString(36).slice(2, 10); sessionStorage.setItem("poker_user_id", id); }
      return id;
    }
    return Math.random().toString(36).slice(2, 10);
  });

  const [room, setRoom] = useState<RoomState | null>(null);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [storyInput, setStoryInput] = useState("");
  const [isObserver, setIsObserver] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [joined, setJoined] = useState(false);
  // Ticket backlog
  const [ticketInput, setTicketInput] = useState("");
  const [showTicketInput, setShowTicketInput] = useState(false);
  const [editingEstimate, setEditingEstimate] = useState<string | null>(null); // ticket id
  const [estimateEdit, setEstimateEdit] = useState("");
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<ThemeKey>("dark");

  // Mark mounted — guarantees server and client initial render are identical (both show spinner)
  useEffect(() => { setMounted(true); }, []);

  // Load + persist theme
  useEffect(() => {
    const saved = localStorage.getItem("poker_theme") as ThemeKey | null;
    if (saved && THEMES[saved]) setTheme(saved);
  }, []);
  const applyTheme = (t: ThemeKey) => { setTheme(t); localStorage.setItem("poker_theme", t); };

  const wsRef = useRef<WebSocket | null>(null);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    const ws = new WebSocket(`${getWsBase()}/ws/${roomId}/${userId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError("");
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "state") {
        const r: RoomState = msg.room;
        setRoom(r);
        const me = r.participants.find(p => p.id === userId);
        if (me && r.revealed && me.vote && me.vote !== "voted") {
          setMyVote(me.vote);
        }
        if (r.revealed === false && room?.revealed === true) {
          // Reset happened
          setMyVote(null);
        }
      } else if (msg.type === "kicked") {
        router.push("/?kicked=1");
      } else if (msg.type === "error") {
        setError(msg.message);
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setError("Connection failed. Make sure the server is running.");
      setConnected(false);
    };

    return () => { ws.close(); };
  }, [roomId, userId]);

  // Auto-join once connected and name is ready
  useEffect(() => {
    if (connected && !joined && nameReady) {
      send({ type: "join", name: userName, is_observer: isObserver });
      setJoined(true);
    }
  }, [connected, joined, userName, isObserver, send, nameReady]);

  // Reset myVote when round resets
  useEffect(() => {
    if (room && !room.revealed) {
      const me = room.participants.find(p => p.id === userId);
      if (me && !me.vote) setMyVote(null);
    }
  }, [room?.revealed]);

  const vote = (card: string) => {
    if (!room || room.revealed || isObserver) return;
    setMyVote(card);
    send({ type: "vote", vote: card });
  };

  const reveal = () => send({ type: "reveal" });

  const reset = () => {
    setMyVote(null);
    send({ type: "reset", story: storyInput });
  };

  const setStory = () => send({ type: "set_story", story: storyInput });

  const loadTickets = () => {
    const titles = ticketInput.split("\n").filter(t => t.trim());
    if (!titles.length) return;
    send({ type: "load_tickets", tickets: titles });
    setShowTicketInput(false);
    setTicketInput("");
  };

  const nextTicket = () => send({ type: "next_ticket" });

  const gotoTicket = (index: number) => send({ type: "goto_ticket", index });

  const saveEstimate = (ticketId: string) => {
    send({ type: "set_estimate", ticket_id: ticketId, estimate: estimateEdit });
    setEditingEstimate(null);
    setEstimateEdit("");
  };

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fallbackCopy = (text: string) => {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    try { document.execCommand("copy"); } catch {}
    document.body.removeChild(el);
  };

  const copyCode = () => copyToClipboard(roomId);
  const copyLink = () => {
    const shareUrl = `${window.location.origin}/room/${roomId}`;
    copyToClipboard(shareUrl);
  };

  const voters = room?.participants.filter(p => !p.is_observer) ?? [];
  const votedCount = voters.filter(p => p.vote !== null).length;
  const allVoted = voters.length > 0 && voters.every(p => p.vote !== null);

  // Before mount: always render spinner (server and client match)
  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="animate-spin text-4xl mb-4">⚙️</div>
          <p className="text-slate-400">Connecting to room {roomId}...</p>
        </div>
      </div>
    );
  }

  // Name prompt — shown when no name available from URL or sessionStorage
  if (!nameReady) {
    const submitName = () => {
      const n = nameInput.trim();
      if (!n) return;
      sessionStorage.setItem("poker_name", n);
      setUserName(n);
      setNameReady(true);
    };
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950">
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-8 w-full max-w-sm shadow-2xl">
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">🃏</div>
            <h2 className="text-white text-xl font-bold">Join Room</h2>
            <p className="text-slate-400 text-sm mt-1">Room code: <span className="font-mono text-indigo-300 font-bold">{roomId}</span></p>
          </div>
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              className="bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
              placeholder="Your name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitName()}
            />
            <div className="flex items-center gap-2">
              <input
                id="observer"
                type="checkbox"
                checked={isObserver}
                onChange={(e) => setIsObserver(e.target.checked)}
                className="accent-indigo-500"
              />
              <label htmlFor="observer" className="text-slate-400 text-sm">Join as observer (no voting)</label>
            </div>
            <button
              onClick={submitName}
              disabled={!nameInput.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition"
            >
              Join Room
            </button>
            <button onClick={() => router.push("/")} className="text-slate-500 hover:text-slate-300 text-sm text-center">
              ← Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="text-5xl mb-4">🚫</div>
          <p className="text-red-400 text-lg">{error}</p>
          <button onClick={() => router.push("/")} className="mt-4 text-indigo-400 hover:underline">
            ← Go Home
          </button>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="animate-spin text-4xl mb-4">⚙️</div>
          <p className="text-slate-400">Connecting to room {roomId}...</p>
        </div>
      </div>
    );
  }

  const T = THEMES[theme];

  return (
    <div className={`min-h-screen ${T.page} flex flex-col`}>
      {/* Header */}
      <header className={`border-b ${T.header} backdrop-blur px-6 py-4`}>
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🃏</span>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">{room.name}</h1>
              <p className="text-slate-400 text-xs">Playing as <span className="text-indigo-400 font-medium">{userName}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
            <button
              onClick={copyCode}
              className="flex items-center gap-2 bg-slate-700/80 hover:bg-slate-600/80 border border-slate-600 text-slate-200 text-sm px-3 py-1.5 rounded-lg transition"
            >
              <span className="font-mono font-bold tracking-wider text-indigo-300">{roomId}</span>
              <span className="text-slate-400">{copied ? "✓" : "📋"}</span>
            </button>
            <button onClick={copyLink} className="text-slate-400 hover:text-white text-xs px-2 py-1 bg-slate-800 rounded-lg border border-slate-700">
              Share Link
            </button>
            {/* Theme picker */}
            <div className="flex items-center gap-1 ml-1">
              {(Object.entries(THEMES) as [ThemeKey, typeof THEMES[ThemeKey]][]).map(([key, t]) => (
                <button
                  key={key}
                  title={t.name}
                  onClick={() => applyTheme(key)}
                  className={`w-5 h-5 rounded-full border-2 transition ${theme === key ? "border-white scale-110" : "border-transparent hover:border-white/50"}`}
                  style={{ backgroundColor: t.swatch }}
                />
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8 flex flex-col gap-8">
        {/* Story / Ticket Panel */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {room.tickets.length > 0 ? `Ticket ${room.ticket_index + 1} of ${room.tickets.length}` : "Current Story / Ticket"}
            </label>
            {room.host_id === userId && room.tickets.length === 0 && (
              <button
                onClick={() => setShowTicketInput(v => !v)}
                className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/40 px-2 py-1 rounded-lg"
              >
                {showTicketInput ? "Cancel" : "📋 Load Backlog"}
              </button>
            )}
            {room.host_id === userId && room.tickets.length > 0 && (
              <button
                onClick={() => {
                  setTicketInput(room.tickets.map(t => t.title).join("\n"));
                  setShowTicketInput(true);
                }}
                className="text-xs text-slate-400 hover:text-slate-300 border border-slate-600 px-2 py-1 rounded-lg"
              >
                ✏️ Edit Backlog
              </button>
            )}
          </div>

          {/* Ticket list input (host only) */}
          {showTicketInput && room.host_id === userId && (
            <div className="mb-4">
              <textarea
                autoFocus
                className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm font-mono"
                rows={5}
                placeholder={"One ticket per line:\nUSER-101 Add login page\nUSER-102 Fix checkout bug\nUSER-103 Dark mode"}
                value={ticketInput}
                onChange={(e) => setTicketInput(e.target.value)}
              />
              <div className="flex gap-2 mt-2">
                <button onClick={loadTickets} disabled={!ticketInput.trim()} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm px-4 py-2 rounded-xl transition">
                  Load Tickets
                </button>
                <button onClick={() => setShowTicketInput(false)} className="text-slate-400 hover:text-white text-sm px-3 py-2 rounded-xl border border-slate-600">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Single story input (no backlog) */}
          {room.tickets.length === 0 && !showTicketInput && (
            room.host_id === userId ? (
              <div className="flex gap-3">
                <input
                  className="flex-1 bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
                  placeholder="Describe the story or paste a ticket ID..."
                  value={storyInput}
                  onChange={(e) => setStoryInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setStory()}
                />
                <button onClick={setStory} className="bg-slate-700 hover:bg-slate-600 text-white text-sm px-4 py-2.5 rounded-xl border border-slate-600 transition">Set</button>
              </div>
            ) : (
              <p className="text-slate-500 text-sm italic">Only the host can set the story.</p>
            )
          )}

          {/* Current ticket display */}
          {room.story && (
            <p className="text-indigo-300 text-sm mt-2 font-medium">📌 {room.story}</p>
          )}

          {/* Ticket backlog list */}
          {room.tickets.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Backlog</p>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
                {room.tickets.map((t, i) => (
                  <div
                    key={t.id}
                    onClick={() => { if (room.host_id === userId && i !== room.ticket_index) gotoTicket(i); }}
                    className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm transition ${
                      i === room.ticket_index
                        ? "bg-indigo-600/20 border border-indigo-500/40 text-white"
                        : i < room.ticket_index
                        ? `text-slate-500 bg-slate-800/30 ${room.host_id === userId ? "cursor-pointer hover:bg-slate-700/50 hover:text-slate-300 hover:border hover:border-slate-600" : ""}`
                        : `text-slate-300 bg-slate-800/20 ${room.host_id === userId ? "cursor-pointer hover:bg-indigo-900/20 hover:border hover:border-indigo-700/40" : ""}`
                    }`}
                    title={room.host_id === userId && i !== room.ticket_index ? "Click to jump to this ticket" : undefined}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span className="text-slate-500 text-xs w-5 shrink-0">{i + 1}.</span>
                      {i === room.ticket_index && <span className="text-indigo-400">▶</span>}
                      {i !== room.ticket_index && t.estimate && <span className="text-green-500">✓</span>}
                      <span className="truncate">{t.title}</span>
                    </span>
                    <span className="shrink-0">
                      {editingEstimate === t.id && room.host_id === userId ? (
                        <span className="flex items-center gap-1">
                          <input
                            autoFocus
                            className="w-14 bg-slate-700 border border-slate-500 rounded px-1 py-0.5 text-white text-xs text-center"
                            value={estimateEdit}
                            onChange={(e) => setEstimateEdit(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveEstimate(t.id); if (e.key === "Escape") setEditingEstimate(null); }}
                          />
                          <button onClick={() => saveEstimate(t.id)} className="text-green-400 hover:text-green-300 text-xs">✓</button>
                        </span>
                      ) : (
                        <span
                          className={`font-bold text-xs px-2 py-0.5 rounded ${
                            t.estimate ? "bg-green-900/40 text-green-300 cursor-pointer hover:bg-green-900/60" : "text-slate-600"
                          }`}
                          title={room.host_id === userId ? "Click to edit" : undefined}
                          onClick={() => {
                            if (room.host_id === userId) {
                              setEditingEstimate(t.id);
                              setEstimateEdit(t.estimate || "");
                            }
                          }}
                        >
                          {t.estimate ?? "—"}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Participants — Poker Table Layout */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Participants — {votedCount}/{voters.length} voted
            </h2>
            {allVoted && !room.revealed && (
              <span className="text-green-400 text-xs animate-pulse">All votes in!</span>
            )}
          </div>

          {/* Poker table */}
          {(() => {
            const all = room.participants;
            const half = Math.ceil(all.length / 2);
            const topRow = all.slice(0, half);
            const bottomRow = [...all.slice(half)].reverse();

            const renderSeat = (p: Participant) => (
              <div key={p.id} className="flex flex-col items-center gap-1">
                {/* Playing card */}
                <div className={`w-12 h-16 rounded-lg border-2 flex items-center justify-center font-bold text-lg transition-all
                  ${p.id === userId ? "border-indigo-400 shadow-lg shadow-indigo-500/20" : "border-slate-600"}
                  ${p.vote === null
                    ? "bg-slate-700/60"
                    : p.vote === "voted"
                    ? "bg-indigo-950 border-indigo-500/60 shadow shadow-indigo-500/30"
                    : "bg-slate-800 border-slate-400/60"}`}>
                  {p.vote === null && <span className="text-slate-500 text-xl">?</span>}
                  {p.vote === "voted" && <span className="text-lg">🂠</span>}
                  {p.vote !== null && p.vote !== "voted" && (
                    <span className={getVoteColor(p.vote, room.revealed)}>{p.vote}</span>
                  )}
                </div>
                {/* Name */}
                <div className="text-center">
                  <p className="text-xs text-slate-300 font-medium truncate max-w-[56px]">
                    {room.host_id === p.id && <span className="text-yellow-400">👑</span>}{p.name}
                  </p>
                  {p.id === userId && <p className="text-xs text-indigo-400">you</p>}
                  {p.is_observer && <p className="text-xs text-slate-500">👁</p>}
                </div>
              </div>
            );

            return (
              <div className="flex flex-col items-center gap-0">
                {/* Top row */}
                <div className="flex gap-4 justify-center px-4 pb-2 z-10">
                  {topRow.map(renderSeat)}
                </div>
                {/* Oval table */}
                <div className={`w-full max-w-lg bg-gradient-to-b ${T.table} border-4 rounded-3xl h-24 flex items-center justify-center shadow-inner px-8`}>
                  <p className="text-slate-300/80 text-xs text-center truncate max-w-[280px]">
                    {room.story || (room.tickets.length > 0 && room.ticket_index >= 0 ? room.tickets[room.ticket_index]?.title : "") || "🃏 Waiting for story…"}
                  </p>
                </div>
                {/* Bottom row */}
                <div className="flex gap-4 justify-center px-4 pt-2 z-10">
                  {bottomRow.map(renderSeat)}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Stats (revealed) */}
        {room.revealed && (
          <div className={`rounded-2xl p-6 border ${room.stats?.consensus ? "bg-green-900/20 border-green-500/40" : "bg-slate-800/50 border-slate-700/50"}`}>
            <div className="flex items-center gap-2 mb-5">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Results</h2>
              {room.stats?.consensus && <span className="text-green-400 text-sm font-bold">🎉 Consensus!</span>}
            </div>
            {room.stats && (
              <div className="grid grid-cols-3 gap-4 text-center mb-6">
                <div>
                  <p className="text-3xl font-bold text-indigo-400">{room.stats.average}</p>
                  <p className="text-xs text-slate-400 mt-1">Average</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-green-400">{room.stats.min}</p>
                  <p className="text-xs text-slate-400 mt-1">Min</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-red-400">{room.stats.max}</p>
                  <p className="text-xs text-slate-400 mt-1">Max</p>
                </div>
              </div>
            )}
            {/* Vote Breakdown */}
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Vote Breakdown</p>
              <div className="flex flex-wrap gap-2">
                {(() => {
                  const tally: Record<string, string[]> = {};
                  room.participants.forEach(p => {
                    if (p.vote && !p.is_observer) {
                      if (!tally[p.vote]) tally[p.vote] = [];
                      tally[p.vote].push(p.name);
                    }
                  });
                  return Object.entries(tally)
                    .sort(([a], [b]) => {
                      const na = parseFloat(a), nb = parseFloat(b);
                      if (!isNaN(na) && !isNaN(nb)) return na - nb;
                      return 0;
                    })
                    .map(([val, names]) => (
                      <div key={val} className="bg-slate-700/60 border border-slate-600 rounded-xl px-4 py-2 flex items-center gap-3">
                        <span className="text-lg font-bold text-white">{val}</span>
                        <div className="flex flex-col">
                          <span className="text-xs text-slate-400">{names.length} vote{names.length > 1 ? "s" : ""}</span>
                          <span className="text-xs text-slate-300">{names.join(", ")}</span>
                        </div>
                      </div>
                    ));
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Voting Cards */}
        {!isObserver && (
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
              {room.revealed ? "Round Complete" : "Cast Your Vote"}
            </h2>
            <div className="flex flex-wrap gap-3 justify-center">
              {FIBONACCI_CARDS.map((card) => (
                <button
                  key={card}
                  onClick={() => vote(card)}
                  disabled={room.revealed}
                  className={`
                    w-16 h-24 rounded-xl text-xl font-bold border-2 transition-all transform
                    ${room.revealed ? "opacity-50 cursor-not-allowed" : "hover:scale-110 hover:-translate-y-1 cursor-pointer"}
                    ${myVote === card && !room.revealed
                      ? "bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-500/30 scale-110 -translate-y-1"
                      : "bg-slate-800 border-slate-600 text-slate-200 hover:border-indigo-500 hover:bg-slate-700"
                    }
                  `}
                >
                  {card}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons — host only */}
        <div className="flex justify-center gap-4">
          {room.host_id === userId ? (
            !room.revealed ? (
              <button
                onClick={reveal}
                disabled={votedCount === 0}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-8 py-3 rounded-xl transition text-lg"
              >
                Reveal Cards 👁
              </button>
            ) : (
              <div className="flex gap-3">
                {room.tickets.length > 0 ? (
                  room.ticket_index < room.tickets.length - 1 ? (
                    <button
                      onClick={nextTicket}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-8 py-3 rounded-xl transition text-lg"
                    >
                      Next Ticket →
                    </button>
                  ) : (
                    <span className="text-green-400 font-bold py-3 px-4">🎉 All tickets estimated!</span>
                  )
                ) : (
                  <button
                    onClick={reset}
                    className="bg-green-600 hover:bg-green-500 text-white font-bold px-8 py-3 rounded-xl transition text-lg"
                  >
                    New Round 🔄
                  </button>
                )}
              </div>
            )
          ) : (
            <p className="text-slate-500 text-sm italic">
              {room.revealed ? "Waiting for host to start next round..." : "Waiting for host to reveal..."}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
