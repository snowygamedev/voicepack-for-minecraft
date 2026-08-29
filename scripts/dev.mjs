// Thin wrapper around `electron-vite`, used by `npm run dev` and `npm start`.
//
// Its only job is to scrub ELECTRON_RUN_AS_NODE from the environment before
// Electron starts. Electron-based editors (VS Code's extension host, Cursor,
// and anything embedding them) export that variable, and any terminal or task
// that inherits it makes the app boot as plain Node instead of Electron. The
// failure is loud but deeply unhelpful:
//
//   TypeError: Cannot read properties of undefined (reading 'isPackaged')
//
// because `require('electron')` returns a path string rather than the API.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'

/**
 * electron-vite's "exports" map doesn't expose ./bin, so require.resolve can't
 * reach the CLI directly. Go via package.json (which is exported) and fall back
 * to the conventional layout.
 */
function findBin() {
  const require = createRequire(import.meta.url)
  try {
    const pkg = require.resolve('electron-vite/package.json')
    const candidate = path.join(path.dirname(pkg), 'bin', 'electron-vite.js')
    if (existsSync(candidate)) return candidate
  } catch {
    // fall through to the layout guess
  }
  const guess = path.resolve(
    import.meta.dirname,
    '../node_modules/electron-vite/bin/electron-vite.js'
  )
  if (existsSync(guess)) return guess
  throw new Error('Could not locate the electron-vite CLI. Did `npm install` run?')
}

const bin = findBin()

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// Default to `dev`, but pass through anything else (`preview`, `build`, flags).
const args = process.argv.slice(2)
if (args.length === 0) args.push('dev')

const child = spawn(process.execPath, [bin, ...args], {
  env,
  stdio: 'inherit',
  // Electron writes to the real console; a shell layer would only add noise.
  shell: false
})

child.on('exit', (code, signal) => {
  // Re-raise the signal so Ctrl+C feels native instead of exiting 0.
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})

child.on('error', (err) => {
  console.error('Failed to start electron-vite:', err.message)
  process.exit(1)
})
