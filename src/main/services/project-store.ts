import { randomUUID } from 'node:crypto'
import { copyFile, readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises'
import { join, posix } from 'node:path'
import {
  projectSchema,
  takeSchema,
  PROJECT_SCHEMA_VERSION,
  type Project,
  type Take
} from '@shared/schema'
import { guessCategory } from '@shared/sound-categories'
import { eventIdToPath } from '../util/paths'

export const PROJECT_FILE = 'project.json'
export const TAKES_DIR = 'takes'

/**
 * Lift an older project.json forward. Each step is deliberately small and
 * additive so we never lose a user's recordings to a schema change.
 */
function migrate(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const data = raw as Record<string, unknown>
  // v0 (pre-release) had no schemaVersion and no explicit namespace.
  if (data.schemaVersion === undefined) {
    data.schemaVersion = 1
    data.namespace ??= 'minecraft'
  }
  return data
}

export function emptyProject(name: string, description: string, packFormat: number): Project {
  const now = new Date().toISOString()
  return projectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name,
    description,
    packFormat,
    namespace: 'minecraft',
    createdAt: now,
    modifiedAt: now,
    bindings: []
  })
}

export async function createProject(
  dir: string,
  name: string,
  description: string,
  packFormat: number
): Promise<Project> {
  await mkdir(join(dir, TAKES_DIR), { recursive: true })
  const project = emptyProject(name, description, packFormat)
  await saveProject(dir, project)
  return project
}

export async function loadProject(dir: string): Promise<Project> {
  const raw = await readFile(join(dir, PROJECT_FILE), 'utf8')
  return projectSchema.parse(migrate(JSON.parse(raw)))
}

export async function saveProject(dir: string, project: Project): Promise<Project> {
  const next: Project = {
    ...project,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    modifiedAt: new Date().toISOString()
  }
  const validated = projectSchema.parse(next)
  await mkdir(dir, { recursive: true })
  // Write-then-rename would be safer still; for a file this small the window is
  // negligible and an atomic rename on Windows across a locked file is fussier.
  await writeFile(join(dir, PROJECT_FILE), JSON.stringify(validated, null, 2), 'utf8')
  return validated
}

export async function isProjectDir(dir: string): Promise<boolean> {
  try {
    const s = await stat(join(dir, PROJECT_FILE))
    return s.isFile()
  } catch {
    return false
  }
}

/** Relative (POSIX) path a new take should be written to. */
function takeRelPath(eventId: string, index: number): string {
  return posix.join(TAKES_DIR, eventIdToPath(eventId), `take-${String(index).padStart(2, '0')}.wav`)
}

async function nextTakeIndex(projectDir: string, eventId: string): Promise<number> {
  const dir = join(projectDir, TAKES_DIR, eventIdToPath(eventId))
  try {
    const files = await readdir(dir)
    const used = files
      .map((f) => /^take-(\d+)\.wav$/.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]))
    return used.length ? Math.max(...used) + 1 : 1
  } catch {
    return 1
  }
}

export interface WriteTakeInput {
  projectDir: string
  eventId: string
  wav: Buffer
  durationSeconds: number
  sampleRate: number
  channels: number
  peak: number
}

export async function writeTake(input: WriteTakeInput): Promise<Take> {
  const index = await nextTakeIndex(input.projectDir, input.eventId)
  const rel = takeRelPath(input.eventId, index)
  const abs = join(input.projectDir, rel)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, input.wav)

  return takeSchema.parse({
    id: randomUUID(),
    file: rel,
    duration: input.durationSeconds,
    sampleRate: input.sampleRate,
    channels: input.channels,
    peak: input.peak,
    recordedAt: new Date().toISOString(),
    label: `Take ${index}`,
    trimStart: 0,
    trimEnd: null,
    gainDb: 0,
    volume: 1,
    pitch: 1,
    weight: 1
  })
}

/**
 * Copy a take's audio in from somewhere else — another pack, when merging —
 * into the next free `take-NN.wav` slot for this event. Returns the new
 * project-relative path.
 */
export async function importTakeFile(
  targetDir: string,
  eventId: string,
  sourceFile: string
): Promise<string> {
  const index = await nextTakeIndex(targetDir, eventId)
  const rel = takeRelPath(eventId, index)
  const abs = join(targetDir, rel)
  await mkdir(join(abs, '..'), { recursive: true })
  await copyFile(sourceFile, abs)
  return rel
}

export async function readTake(projectDir: string, relFile: string): Promise<Buffer> {
  return readFile(resolveInProject(projectDir, relFile))
}

export async function deleteTake(projectDir: string, relFile: string): Promise<void> {
  await rm(resolveInProject(projectDir, relFile), { force: true })
}

/**
 * Guard against a project.json (possibly hand-edited or shared) pointing at
 * files outside its own directory.
 */
export function resolveInProject(projectDir: string, relFile: string): string {
  const abs = join(projectDir, relFile)
  const root = join(projectDir, '/')
  if (!abs.startsWith(root)) {
    throw new Error(`Refusing to touch a path outside the project: ${relFile}`)
  }
  return abs
}

/** Add an event to the project if it isn't already bound. */
export function withBinding(project: Project, eventId: string): Project {
  if (project.bindings.some((b) => b.eventId === eventId)) return project
  return {
    ...project,
    bindings: [
      ...project.bindings,
      {
        eventId,
        category: guessCategory(eventId),
        enabled: true,
        replace: true,
        subtitle: null,
        takes: [],
        activeTakeId: null
      }
    ]
  }
}
