import { useEffect, useState } from 'react'

export function useObjectUrl(file: Blob | null) {
  const [preview, setPreview] = useState<{ file: Blob; url: string } | null>(null)
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    let active = true
    queueMicrotask(() => { if (active) setPreview({ file, url }) })
    return () => { active = false; URL.revokeObjectURL(url) }
  }, [file])
  return preview?.file === file ? preview.url : null
}
