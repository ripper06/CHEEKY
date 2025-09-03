"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

function randomRoom() {
  return Math.random().toString(36).slice(2, 8)
}

export default function Home() {
  const router = useRouter()
  const [roomId, setRoomId] = useState("")
  const [nick, setNick] = useState("")

  const canProceed = nick.trim().length >= 2

  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-balance">Watch YouTube Together</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="nick">Your name</Label>
            <Input id="nick" placeholder="e.g. Alex" value={nick} onChange={(e) => setNick(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              disabled={!canProceed}
              onClick={() => {
                const id = randomRoom()
                router.push(`/room/${id}?nick=${encodeURIComponent(nick)}`)
              }}
            >
              Create a room
            </Button>
            <div className="flex items-center gap-2">
              <Input placeholder="Room code" value={roomId} onChange={(e) => setRoomId(e.target.value.trim())} />
              <Button
                disabled={!canProceed || roomId.length < 3}
                onClick={() => router.push(`/room/${roomId}?nick=${encodeURIComponent(nick)}`)}
              >
                Join
              </Button>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Share the room link with your partner and watch in sync with chat.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
