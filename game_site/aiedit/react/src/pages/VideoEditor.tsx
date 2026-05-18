import { useState } from 'react'
import StyleGrid from '../components/StyleGrid'
import VideoDrawCanvas from '../components/VideoDrawCanvas'
import { CANVAS_SIZE, DRAW_STYLE_BASE, FPS, MAX_DURATION } from '../constants'
import { drawContained } from '../utils'
import { runStyleTransferFromCanvas } from '../inference'

type Phase = 'upload' | 'processing' | 'draw'

async function extractFrames(file: File): Promise<HTMLCanvasElement[]> {
  const video = document.createElement('video')
  video.src   = URL.createObjectURL(file)
  video.muted = true
  await new Promise<void>((res, rej) => { video.onloadedmetadata = () => res(); video.onerror = rej })

  const duration = Math.min(video.duration, MAX_DURATION)
  const count    = Math.round(duration * FPS)
  const frames: HTMLCanvasElement[] = []

  for (let i = 0; i < count; i++) {
    video.currentTime = i / FPS
    await new Promise<void>(r => {
      const t = setTimeout(r, 5000)
      video.onseeked = () => { clearTimeout(t); r() }
    })
    const c = document.createElement('canvas')
    c.width = c.height = CANVAS_SIZE
    drawContained(c.getContext('2d', { willReadFrequently: true })!, video)
    frames.push(c)
  }

  URL.revokeObjectURL(video.src)
  return frames
}

export default function VideoEditor() {
  const [phase, setPhase]                       = useState<Phase>('upload')
  const [videoFile, setVideoFile]               = useState<File | null>(null)
  const [videoDuration, setVideoDuration]       = useState(0)
  const [selected, setSelected]                 = useState(new Set<string>())
  const [timeEstimate, setTimeEstimate]         = useState('')
  const [progressText, setProgressText]         = useState('Initialising...')
  const [progressValue, setProgressValue]       = useState(0)
  const [originalFrames, setOriginalFrames]     = useState<HTMLCanvasElement[]>([])
  const [styledVideoFrames, setStyledVideoFrames] = useState<Map<string, HTMLCanvasElement[]>>(new Map())
  const [styleNames, setStyleNames]             = useState<string[]>([])

  const ready = videoFile !== null && selected.size > 0 && videoDuration > 0

  const updateEstimate = (dur: number, sel: Set<string>) => {
    if (dur > 0 && sel.size > 0) {
      const frames = Math.round(Math.min(dur, MAX_DURATION) * FPS)
      const mins   = Math.round(frames * sel.size * 4 * 20 / 60)
      setTimeEstimate(`${frames} frames × ${sel.size} style(s) ≈ ${mins} min estimated`)
    } else {
      setTimeEstimate('')
    }
  }

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    setVideoFile(file)
    if (!file) return
    const url = URL.createObjectURL(file)
    const v   = document.createElement('video')
    v.src     = url
    v.onloadedmetadata = () => {
      setVideoDuration(v.duration)
      URL.revokeObjectURL(url)
      updateEstimate(v.duration, selected)
    }
  }

  const toggleStyle = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      updateEstimate(videoDuration, next)
      return next
    })
  }

  const handleProcess = async () => {
    if (!videoFile || selected.size === 0) return
    const names = [...selected]
    setStyleNames(names)
    setPhase('processing')

    setProgressText('Extracting frames...')
    const frames = await extractFrames(videoFile)
    setProgressText(`Extracted ${frames.length} frames. Starting inference...`)
    setOriginalFrames(frames)

    const styledMap = new Map<string, HTMLCanvasElement[]>()
    names.forEach(n => styledMap.set(n, new Array(frames.length)))

    const totalPasses = frames.length * names.length * 4
    let passesComplete = 0

    for (let si = 0; si < names.length; si++) {
      const name  = names[si]
      const label = name.replace(/_/g, ' ').replace('.jpg', '')

      for (let fi = 0; fi < frames.length; fi++) {
        const canvas = await runStyleTransferFromCanvas(
          frames[fi],
          `${DRAW_STYLE_BASE}/${name}`,
          (msg) => {
            setProgressText(
              `Style ${si + 1}/${names.length} — ${label} — Frame ${fi + 1}/${frames.length} — ${msg}`
            )
            if (msg.startsWith('Tile')) {
              passesComplete++
              setProgressValue(Math.round((passesComplete / totalPasses) * 100))
            }
          }
        )
        styledMap.get(name)![fi] = canvas
      }
    }

    setProgressValue(100)
    setProgressText('Done! Loading editor...')
    setStyledVideoFrames(new Map(styledMap))
    setPhase('draw')
  }

  if (phase === 'draw' && originalFrames.length > 0) {
    return (
      <VideoDrawCanvas
        originalFrames={originalFrames}
        styledVideoFrames={styledVideoFrames}
        frameCount={originalFrames.length}
        selectedStyleNames={styleNames}
      />
    )
  }

  return (
    <>
      {phase === 'upload' && (
        <div id="phase-upload">
          <h3>Upload your video and select the style(s) to apply</h3>
          <p>Processed at 15 fps in your browser — allow ~20 s per frame per style.</p>
          <div className="upload-zone">
            <label htmlFor="video-input" className={videoFile ? 'file-chosen' : ''}>
              {videoFile ? `✓ ${videoFile.name}` : '+ Choose a video'}
            </label>
            <input type="file" id="video-input" accept="video/*" onChange={handleVideoChange} />
          </div>
          <div id="time-estimate">{timeEstimate}</div>
          <StyleGrid selected={selected} onToggle={toggleStyle} />
          <div className="next-step" style={{ display: ready ? 'block' : 'none' }}>
            <button id="btn-process" onClick={handleProcess}>Process video!</button>
          </div>
        </div>
      )}

      {phase === 'processing' && (
        <div id="phase-processing">
          <div id="progress-text">{progressText}</div>
          <br />
          <progress id="progress-bar" max={100} value={progressValue} />
        </div>
      )}
    </>
  )
}
