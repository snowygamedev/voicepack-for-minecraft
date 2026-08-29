import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import yauzl from 'yauzl'
import yazl from 'yazl'

/**
 * Read a single entry out of a zip/jar without extracting the whole archive.
 * Resolves null when the entry is not present.
 */
export function readZipEntry(zipPath: string, entryName: string): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zip) => {
      if (openErr || !zip) {
        reject(openErr ?? new Error('Could not open archive'))
        return
      }

      let settled = false
      const finish = (value: Buffer | null, err?: Error): void => {
        if (settled) return
        settled = true
        zip.close()
        if (err) reject(err)
        else resolve(value)
      }

      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== entryName) {
          zip.readEntry()
          return
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            finish(null, streamErr ?? new Error('Read failed'))
            return
          }
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => finish(Buffer.concat(chunks)))
          stream.on('error', (e: Error) => finish(null, e))
        })
      })
      zip.on('end', () => finish(null))
      zip.on('error', (e: Error) => finish(null, e))
      zip.readEntry()
    })
  })
}

export interface ZipFileEntry {
  /** Path inside the archive, POSIX separators. */
  path: string
  content: Buffer
}

/** Write a zip from in-memory entries. Resolves with the byte size written. */
export async function writeZip(outPath: string, entries: ZipFileEntry[]): Promise<number> {
  await mkdir(dirname(outPath), { recursive: true })
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile()
    for (const entry of entries) {
      archive.addBuffer(entry.content, entry.path)
    }
    archive.end()

    const out = createWriteStream(outPath)
    let bytes = 0
    archive.outputStream.on('data', (chunk: Buffer) => {
      bytes += chunk.length
    })
    archive.outputStream.on('error', reject)
    out.on('error', reject)
    out.on('close', () => resolve(bytes))
    archive.outputStream.pipe(out)
  })
}
