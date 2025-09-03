"use client"

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { getSupabaseBrowser } from "@/lib/supabase-browser"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

type ChatMessage = {
  id: string
  from: string
  text: string
  ts: number
}

export function RoomChat({ roomId, nick, clientId }: { roomId: string; nick: string; clientId: string }) {
  const supabase = useMemo(getSupabaseBrowser, [])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const channel = supabase.channel(`room-${roomId}-chat`, {
      config: { broadcast: { self: false } },
    })

    channel.on("broadcast", { event: "chat-message" }, (payload) => {
      const msg = payload.payload as ChatMessage
      setMessages((prev) => [...prev, msg].slice(-200))
    })

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // optional greeting
      }
    })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [roomId, supabase])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  function sendMessage(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    const msg: ChatMessage = {
      id: `${clientId}-${Date.now()}`,
      from: nick || "Guest",
      text,
      ts: Date.now(),
    }
    setMessages((prev) => [...prev, msg].slice(-200))
    setInput("")
    supabase.channel(`room-${roomId}-chat`).send({
      type: "broadcast",
      event: "chat-message",
      payload: msg,
    })
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="py-4">
        <CardTitle className="text-base">Chat</CardTitle>
      </CardHeader>
      <Separator />
      <CardContent className="flex-1 p-0">
        <ScrollArea className="h-[360px] px-4 py-3">
          <div className="space-y-2">
            {messages.map((m) => (
              <div key={m.id} className="text-sm">
                <span className="font-medium">{m.from}:</span> <span className="text-foreground/90">{m.text}</span>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </ScrollArea>
        <form onSubmit={sendMessage} className="p-3 flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            className="flex-1"
          />
          <Button type="submit">Send</Button>
        </form>
      </CardContent>
    </Card>
  )
}
