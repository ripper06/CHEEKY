"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import YouTubePlayer from "@/components/youtube-player"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

type PlayerEvent =
  | { type: "play"; at: number; by: string }
  | { type: "pause"; at: number; by: string }
  | { type: "seek"; to: number; by: string }
  | { type: "load"; videoId: string; by: string }

type WireMessage =
  | { type: "join"; nick: string; id: string }
  | { type: "presence"; peers: { id: string; nick: string }[] }
  | { type: "chat"; text: string; nick: string; ts: number }
  | { type: "player"; action: "play" | "pause" | "seek" | "load"; t?: number; videoId?: string; by: string }
  | { type: "request_state" }
  | { type: "state"; videoId: string; playing: boolean; time: number }

function extractVideoId(urlOrId: string): string | null {
  const s = urlOrId.trim()
  // direct ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s
  // try URL parsing for robust extraction
  try {
    const u = new URL(s)
    // standard watch URL: ?v=ID
    const vParam = u.searchParams.get("v")
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) return vParam
    // youtu.be short
    const pathParts = u.pathname.split("/").filter(Boolean)
    // /shorts/ID or /embed/ID or /live/ID or /{ID}
    const candidates = [pathParts[pathParts.length - 1], pathParts[pathParts.length - 2]].filter(Boolean) as string[]
    for (const c of candidates) {
      if (/^[a-zA-Z0-9_-]{11}$/.test(c)) return c
    }
  } catch {
    // not a URL, fall through to regex
  }
  // fallback regexes
  const match =
    s.match(/v=([a-zA-Z0-9_-]{11})/) ||
    s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) ||
    s.match(/embed\/([a-zA-Z0-9_-]{11})/) ||
    s.match(/shorts\/([a-zA-Z0-9_-]{11})/) ||
    s.match(/live\/([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

export default function RoomPage() {
  const params = useParams<{ roomId: string }>()
  const sp = useSearchParams()
  const roomId = params.roomId
  const nick = (sp.get("nick") || "Guest").slice(0, 24)

  // Video + player sync state
  const [videoInput, setVideoInput] = useState("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
  const [videoId, setVideoId] = useState<string>(() => extractVideoId(videoInput) || "dQw4w9WgXcQ")
  const [playing, setPlaying] = useState(false)
  const [seekTo, setSeekTo] = useState<number | null>(null)

  // RTC + chat state
  const [role, setRole] = useState<"connecting" | "host" | "guest">("connecting")
  const [peers, setPeers] = useState<{ id: string; nick: string }[]>([])
  const [status, setStatus] = useState<string>("Connecting...")
  const [chatInput, setChatInput] = useState("")
  const [messages, setMessages] = useState<{ nick: string; text: string; ts: number }[]>([])

  // Refs
  const clientId = useMemo(() => Math.random().toString(36).slice(2), [])
  const lastActionRef = useRef<string>("")
  const lastTimeRef = useRef<number>(0)

  // PeerJS refs (typed as any to avoid external types)
  const peerRef = useRef<any | null>(null)
  const hostConnRef = useRef<any | null>(null) // for guests: connection to host
  const connsRef = useRef<Map<string, any>>(new Map()) // for host: guest connections
  const guestNamesRef = useRef<Map<string, string>>(new Map()) // conn.peer -> nick

  // Init PeerJS
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setStatus("Connecting...")
      const { default: Peer } = await import("peerjs")

      // Try to become host by claiming fixed ID
      const hostId = `${roomId}-host`
      setStatus("Trying to become host...")
      let p: any = null
      try {
        p = new Peer(hostId, { debug: 1 })
      } catch (e) {
        // If constructor throws, fallback to guest
      }

      const becomeGuest = () => {
        if (cancelled) return
        setStatus("Connecting to host...")
        const gp = new Peer(undefined, { debug: 1 })
        peerRef.current = gp

        gp.on("open", () => {
          if (cancelled) return
          setRole("guest")
          setStatus("Connected as guest")
          // Connect to host
          const conn = gp.connect(hostId)
          hostConnRef.current = conn
          conn.on("open", () => {
            // Introduce and ask for state
            const msg: WireMessage = { type: "join", nick, id: gp.id }
            conn.send(msg)
            conn.send({ type: "request_state" } satisfies WireMessage)
          })
          conn.on("data", (raw: WireMessage) => handleIncoming(raw, "host"))
          conn.on("close", () => {
            setStatus("Disconnected from host")
          })
          conn.on("error", () => setStatus("Connection error"))
        })

        gp.on("error", (_err: any) => {
          setStatus("Failed to connect to host")
        })
      }

      if (!p) {
        becomeGuest()
        return
      }

      peerRef.current = p

      // If we get "unavailable-id" error, become guest
      let hostChosen = false

      p.on("open", () => {
        if (cancelled) return
        hostChosen = true
        setRole("host")
        setStatus("Hosting room")
        // initialize presence with self
        publishPresence()
      })

      p.on("error", (err: any) => {
        const msg = String(err?.type || err?.message || err)
        if (msg.includes("unavailable-id") || msg.includes("ID is taken")) {
          // Can't be host → guest
          if (!hostChosen) {
            try {
              p.destroy()
            } catch {}
            becomeGuest()
          }
        } else {
          setStatus(`Peer error: ${msg}`)
        }
      })

      // Host: accept connections
      p.on("connection", (conn: any) => {
        connsRef.current.set(conn.peer, conn)

        conn.on("open", () => {
          // nothing extra
        })

        conn.on("data", (raw: WireMessage) => {
          // Host relays messages and maintains presence/state
          if (raw.type === "join") {
            guestNamesRef.current.set(conn.peer, raw.nick)
            publishPresence()
            // Send current state to the new guest
            const state: WireMessage = {
              type: "state",
              videoId,
              playing,
              time: lastTimeRef.current || 0,
            }
            conn.send(state)
            return
          }
          if (raw.type === "request_state") {
            const state: WireMessage = {
              type: "state",
              videoId,
              playing,
              time: lastTimeRef.current || 0,
            }
            conn.send(state)
            return
          }
          if (raw.type === "chat") {
            // add locally and broadcast to everyone (including sender)
            setMessages((m) => [...m, { nick: raw.nick, text: raw.text, ts: raw.ts }])
            broadcastToGuests(raw)
            return
          }
          if (raw.type === "player") {
            // apply locally and rebroadcast to others
            applyPlayerFromWire(raw)
            broadcastToGuests(raw)
            return
          }
        })

        conn.on("close", () => {
          connsRef.current.delete(conn.peer)
          guestNamesRef.current.delete(conn.peer)
          publishPresence()
        })
        conn.on("error", () => {
          connsRef.current.delete(conn.peer)
          guestNamesRef.current.delete(conn.peer)
          publishPresence()
        })
      })

      function publishPresence() {
        // Host presence = self + connected guest names we know
        const list: { id: string; nick: string }[] = [{ id: "host", nick }]
        for (const [peerId, name] of guestNamesRef.current.entries()) {
          list.push({ id: peerId, nick: name })
        }
        setPeers(list)
        const msg: WireMessage = { type: "presence", peers: list }
        broadcastToGuests(msg)
      }

      function broadcastToGuests(msg: WireMessage) {
        for (const [, c] of connsRef.current) {
          try {
            c.send(msg)
          } catch {}
        }
      }

      function applyPlayerFromWire(raw: Extract<WireMessage, { type: "player" }>) {
        if (raw.action === "load" && raw.videoId) {
          lastActionRef.current = "load"
          setVideoId(raw.videoId)
        } else if (raw.action === "play") {
          lastActionRef.current = "play"
          setSeekTo(typeof raw.t === "number" ? raw.t : null)
          setPlaying(true)
        } else if (raw.action === "pause") {
          lastActionRef.current = "pause"
          setSeekTo(typeof raw.t === "number" ? raw.t : null)
          setPlaying(false)
        } else if (raw.action === "seek") {
          lastActionRef.current = "seek"
          if (typeof raw.t === "number") setSeekTo(raw.t)
        }
      }

      function handleIncoming(raw: WireMessage, from: "host" | "guest") {
        if (raw.type === "presence") {
          setPeers(raw.peers)
        } else if (raw.type === "chat") {
          setMessages((m) => [...m, { nick: raw.nick, text: raw.text, ts: raw.ts }])
        } else if (raw.type === "player") {
          // Apply incoming player action
          if (raw.action === "load" && raw.videoId) {
            lastActionRef.current = "load"
            setVideoId(raw.videoId)
          } else if (raw.action === "play") {
            lastActionRef.current = "play"
            if (typeof raw.t === "number") setSeekTo(raw.t)
            setPlaying(true)
          } else if (raw.action === "pause") {
            lastActionRef.current = "pause"
            if (typeof raw.t === "number") setSeekTo(raw.t)
            setPlaying(false)
          } else if (raw.action === "seek") {
            lastActionRef.current = "seek"
            if (typeof raw.t === "number") setSeekTo(raw.t)
          }
        } else if (raw.type === "state") {
          // Initial sync from host
          setVideoId(raw.videoId)
          setPlaying(raw.playing)
          setSeekTo(raw.time)
          lastTimeRef.current = raw.time
        }
      }
      // Store handlers to refs for reuse in button handlers
      ;(broadcastRef as any).current = (msg: WireMessage) => {
        const hostId = `${roomId}-host`
        const isHost = (peerRef.current?.id && peerRef.current.id === hostId) || connsRef.current.size > 0

        if (isHost) {
          // send to all guests (if any)
          for (const [, c] of connsRef.current) {
            try {
              c.send(msg)
            } catch {}
          }
        } else {
          // guest → host
          try {
            hostConnRef.current?.send(msg)
          } catch {}
        }
      }
      ;(applyPlayerFromWireRef as any).current = (raw: Extract<WireMessage, { type: "player" }>) => {
        // host/guest alike
        if (raw.action === "load" && raw.videoId) {
          lastActionRef.current = "load"
          setVideoId(raw.videoId)
        } else if (raw.action === "play") {
          lastActionRef.current = "play"
          if (typeof raw.t === "number") setSeekTo(raw.t)
          setPlaying(true)
        } else if (raw.action === "pause") {
          lastActionRef.current = "pause"
          if (typeof raw.t === "number") setSeekTo(raw.t)
          setPlaying(false)
        } else if (raw.action === "seek") {
          lastActionRef.current = "seek"
          if (typeof raw.t === "number") setSeekTo(raw.t)
        }
      }

      return () => {
        // noop: cleanup is below in effect cleanup
      }
    })()

    return () => {
      cancelled = true
      try {
        hostConnRef.current?.close?.()
      } catch {}
      hostConnRef.current = null
      for (const [, c] of connsRef.current) {
        try {
          c.close?.()
        } catch {}
      }
      connsRef.current.clear()
      try {
        peerRef.current?.destroy?.()
      } catch {}
      peerRef.current = null
      guestNamesRef.current.clear()
      setRole("connecting")
      setStatus("Disconnected")
      setPeers([])
    }
  }, [roomId, nick]) // re-init if room or name changes

  // Broadcast + apply helpers via refs so we can use inside callbacks
  const broadcastRef = useRef<(msg: WireMessage) => void>(() => {})
  const applyPlayerFromWireRef = useRef<(raw: Extract<WireMessage, { type: "player" }>) => void>(() => {})

  function sendPlayer(action: "play" | "pause" | "seek" | "load", opts?: { t?: number; videoId?: string }) {
    const msg: WireMessage = {
      type: "player",
      action,
      by: nick,
      ...(typeof opts?.t === "number" ? { t: opts.t } : {}),
      ...(opts?.videoId ? { videoId: opts.videoId } : {}),
    }
    broadcastRef.current(msg)
  }

  function handleLoad() {
    const extracted = extractVideoId(videoInput)
    if (!extracted) return
    setVideoId(extracted)
    sendPlayer("load", { videoId: extracted })
  }

  function handleSendChat() {
    const text = chatInput.trim()
    if (!text) return
    const msg: WireMessage = { type: "chat", text, nick, ts: Date.now() }
    setMessages((m) => [...m, { nick, text, ts: msg.ts }]) // optimistic local
    broadcastRef.current(msg)
    setChatInput("")
  }

  return (
    <main className="min-h-dvh p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-balance">Room {roomId}</h1>
            <p className="text-sm text-muted-foreground">
              You are: {nick} • {role === "host" ? "Host" : role === "guest" ? "Guest" : "Connecting..."} • {status}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="w-72"
              placeholder="YouTube URL or video ID"
              value={videoInput}
              onChange={(e) => setVideoInput(e.target.value)}
            />
            <Button onClick={handleLoad}>Load</Button>
            <Button
              variant="secondary"
              onClick={() => {
                const url = typeof window !== "undefined" ? window.location.href : ""
                navigator.clipboard.writeText(url)
              }}
            >
              Copy link
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-3">
            <Card>
              <CardContent className="p-3 md:p-4 space-y-3">
                <YouTubePlayer
                  videoId={videoId}
                  playing={playing}
                  seekTo={seekTo}
                  onPlay={(t) => {
                    lastTimeRef.current = t
                    if (lastActionRef.current === "play") {
                      lastActionRef.current = ""
                      return
                    }
                    // Broadcast play with current time
                    sendPlayer("play", { t })
                  }}
                  onPause={(t) => {
                    lastTimeRef.current = t
                    if (lastActionRef.current === "pause") {
                      lastActionRef.current = ""
                      return
                    }
                    sendPlayer("pause", { t })
                  }}
                  onSeek={(t) => {
                    lastTimeRef.current = t
                    if (lastActionRef.current === "seek") {
                      lastActionRef.current = ""
                      return
                    }
                    // Seeking via UI (scrub) can be detected here if needed to broadcast
                    // sendPlayer("seek", { t })
                  }}
                />

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => {
                      setPlaying(true)
                      // Use last known time for accuracy
                      sendPlayer("play", { t: lastTimeRef.current || 0 })
                    }}
                  >
                    Play
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPlaying(false)
                      sendPlayer("pause", { t: lastTimeRef.current || 0 })
                    }}
                  >
                    Pause
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const seconds = 0
                      setSeekTo(seconds)
                      sendPlayer("seek", { t: seconds })
                    }}
                  >
                    Restart
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">
                  People here: {peers.length}{" "}
                  {peers.length > 0 && <span className="text-foreground">({peers.map((p) => p.nick).join(", ")})</span>}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="md:col-span-1">
            <Card className="h-full">
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="font-medium">Chat</div>
                <div className="border rounded-md p-2 h-80 overflow-y-auto bg-muted/30">
                  {messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No messages yet</p>
                  ) : (
                    <ul className="space-y-2">
                      {messages.map((m, i) => (
                        <li key={i} className="text-sm">
                          <span className="font-medium">{m.nick}:</span> <span className="text-pretty">{m.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Type a message"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSendChat()
                    }}
                  />
                  <Button onClick={handleSendChat}>Send</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Separator />
        <p className="text-xs text-muted-foreground">
          Tip: First person becomes host automatically. Paste any YouTube link above and press Load, then share the room
          link to watch together.
        </p>
      </div>
    </main>
  )
}
