/**
 * Browser DownloadProvider Implementation
 *
 * Uses URL.createObjectURL and anchor element for downloads.
 */

import type { DownloadProvider } from '../adapters/types.js'

/**
 * Browser download provider
 */
export class BrowserDownloadProvider implements DownloadProvider {
  createObjectURL(blob: Blob): string {
    return URL.createObjectURL(blob)
  }

  revokeObjectURL(url: string): void {
    URL.revokeObjectURL(url)
  }

  triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    // Clean up after a short delay
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 100)
  }

  // Browser doesn't have writeFile
  writeFile = undefined
}
