// Hand a string to the browser as a file download: a `Blob`, a synthetic
// `<a download>` click, and the object URL revoked straight after. Static-site
// friendly (no server round-trip); DOM-only, so it is not part of the pure
// modules — callers inject nothing, tests stub `URL.createObjectURL`.
export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
