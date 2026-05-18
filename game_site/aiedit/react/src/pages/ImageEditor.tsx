import { useState } from 'react'
import StyleGrid from '../components/StyleGrid'
import DrawCanvas from '../components/DrawCanvas'
import { DRAW_STYLE_BASE } from '../constants'
import { runStyleTransfer } from '../inference'

type Phase = 'upload' | 'processing' | 'draw'

export default function ImageEditor() {
  const [phase, setPhase]                   = useState<Phase>('upload')
  const [contentFile, setContentFile]       = useState<File | null>(null)
  const [selected, setSelected]             = useState(new Set<string>())
  const [progressText, setProgressText]     = useState('Initialising...')
  const [progressValue, setProgressValue]   = useState(0)
  const [styledCanvases, setStyledCanvases] = useState<Map<string, HTMLCanvasElement>>(new Map())
  const [styleNames, setStyleNames]         = useState<string[]>([])

  const ready = contentFile !== null && selected.size > 0

  const toggleStyle = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const handleProcess = async () => {
    if (!contentFile || selected.size === 0) return
    const names = [...selected]
    setStyleNames(names)
    setPhase('processing')

    const canvases = new Map<string, HTMLCanvasElement>()
    const totalPasses = names.length * 4
    let passesComplete = 0

    for (let i = 0; i < names.length; i++) {
      const name  = names[i]
      const label = name.replace(/_/g, ' ').replace('.jpg', '')
      const canvas = await runStyleTransfer(
        contentFile,
        `${DRAW_STYLE_BASE}/${name}`,
        (msg) => {
          setProgressText(`Style ${i + 1}/${names.length} — ${label} — ${msg}`)
          if (msg.startsWith('Tile')) {
            passesComplete++
            setProgressValue(Math.round((passesComplete / totalPasses) * 90))
          }
        }
      )
      canvases.set(name, canvas)
    }

    setProgressValue(100)
    setProgressText('Done! Loading editor...')
    setStyledCanvases(canvases)
    setPhase('draw')
  }

  if (phase === 'draw' && contentFile) {
    return (
      <DrawCanvas
        styledCanvases={styledCanvases}
        contentFile={contentFile}
        selectedStyleNames={styleNames}
      />
    )
  }

  return (
    <>
      {phase === 'upload' && (
        <div id="phase-upload">
          <h3>Upload your image and select the style(s) to apply</h3>
          <p>Processing runs entirely in your browser — please allow ~15–30s per style.</p>
          <div className="upload-zone">
            <label htmlFor="content-input" className={contentFile ? 'file-chosen' : ''}>
              {contentFile ? `✓ ${contentFile.name}` : '+ Choose an image'}
            </label>
            <input
              type="file" id="content-input" accept=".jpg,.png,.jpeg"
              onChange={e => setContentFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <StyleGrid selected={selected} onToggle={toggleStyle} />
          <div className="next-step" style={{ display: ready ? 'block' : 'none' }}>
            <button id="btn-edit" onClick={handleProcess}>Edit your image!</button>
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
