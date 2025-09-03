"use client"

import { useEffect, useRef } from "react"

type YouTubePlayerProps = {
  videoId: string
  playing: boolean
  seekTo?: number | null
  playbackRate?: number
  onReady?: (api: any) => void
  onPlay?: (t: number) => void
  onPause?: (t: number) => void
  onSeek?: (t: number) => void
}

declare global {
  interface Window {
    YT?: any
    onYouTubeIframeAPIReady?: () => void
  }
}

export default function YouTubePlayer({
  videoId,
  playing,
  seekTo,
  playbackRate = 1,
  onReady,
  onPlay,
  onPause,
  onSeek,
}: YouTubePlayerProps) {
  const playerRef = useRef<any | null>(null)
  const containerIdRef = useRef(`yt-${Math.random().toString(36).slice(2)}`)
  const readyRef = useRef<boolean>(false)

  // Load IFrame API
  useEffect(() => {
    if (window.YT && window.YT.Player) return
    const tag = document.createElement("script")
    tag.src = "https://www.youtube.com/iframe_api"
    document.body.appendChild(tag)
  }, [])

  // Initialize player
  useEffect(() => {
    if (!window.YT || !window.YT.Player) {
      window.onYouTubeIframeAPIReady = () => {
        create()
      }
    } else {
      create()
    }

    function create() {
      if (playerRef.current) return
      playerRef.current = new window.YT.Player(containerIdRef.current, {
        videoId, // initial video
        playerVars: {
          rel: 0,
          modestbranding: 1,
          controls: 1,
        },
        events: {
          onReady: () => {
            const p = playerRef.current!
            readyRef.current = true
            p.setPlaybackRate(playbackRate)
            onReady?.(p)
          },
          onStateChange: (e) => {
            const p = playerRef.current!
            if (e.data === window.YT.PlayerState.PLAYING) {
              onPlay?.(p.getCurrentTime())
            } else if (e.data === window.YT.PlayerState.PAUSED) {
              onPause?.(p.getCurrentTime())
            }
          },
        },
      })
    }

    return () => {
      try {
        playerRef.current?.destroy()
      } catch {}
      playerRef.current = null
      readyRef.current = false
    }
  }, []) // mount-only

  // Load new video IDs without destroying/recreating the player
  useEffect(() => {
    const p = playerRef.current
    if (!p || !videoId || !readyRef.current) return
    try {
      const current = p.getVideoData?.().video_id
      if (current !== videoId) {
        p.loadVideoById(videoId)
        // keep external desired play state consistent
        if (!playing) p.pauseVideo()
      }
    } catch {}
  }, [videoId, playing])

  // External control: play/pause
  useEffect(() => {
    const p = playerRef.current
    if (!p || !readyRef.current) return
    try {
      if (playing) p.playVideo()
      else p.pauseVideo()
    } catch {}
  }, [playing])

  // External control: seek
  useEffect(() => {
    const p = playerRef.current
    if (!p || !readyRef.current) return
    if (typeof seekTo === "number") {
      try {
        p.seekTo(seekTo, true)
        onSeek?.(seekTo)
      } catch {}
    }
  }, [seekTo, onSeek])

  // External control: playback rate
  useEffect(() => {
    const p = playerRef.current
    if (!p || !readyRef.current) return
    try {
      p.setPlaybackRate(playbackRate)
    } catch {}
  }, [playbackRate])

  return <div className="w-full aspect-video rounded-md overflow-hidden border bg-muted" id={containerIdRef.current} />
}
