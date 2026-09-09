import { useEffect, useState } from 'react'
import type { CheckProgress as Progress } from '../../shared/api'

const names: Record<Progress['kind'], string> = {
  structure: 'ตรวจตามโครงสร้าง',
  observations: 'ตรวจตามข้อสังเกต',
}

/**
 * The status bar end of both quality checks. They run in the main process for anywhere from a few
 * seconds to half a minute, so the bar says which check is running and what it is on right now.
 */
export function CheckProgress() {
  const [progress, setProgress] = useState<Progress | null>(null)

  useEffect(() => window.api.onCheckProgress(setProgress), [])
  useEffect(() => {
    // The last step arrives at 100%; hold it a moment so the bar finishes instead of vanishing.
    if (!progress || progress.percent < 100) return
    const timer = setTimeout(() => setProgress(null), 1200)
    return () => clearTimeout(timer)
  }, [progress])

  if (!progress) return null
  return <>
    <span className="status-divider" />
    <span className="status-progress" role="status"
      aria-label={`${names[progress.kind]} ${progress.percent}%`}>
      <span>{names[progress.kind]} · {progress.step}</span>
      <span className="progress"><span style={{ width: `${progress.percent}%` }} /></span>
      <span className="num-cell">{progress.percent}%</span>
    </span>
  </>
}
