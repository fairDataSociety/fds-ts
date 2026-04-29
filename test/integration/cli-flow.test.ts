/**
 * CLI Flow Integration Test
 *
 * Spawns the CLI as a subprocess and verifies real command flows:
 *   init → put → get → ls → status
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'

const CLI_ENTRY = join(process.cwd(), 'src/cli/index.ts')

interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
}

function runCli(args: string[], dataDir: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', CLI_ENTRY, ...args], {
      env: { ...process.env, FDS_DATA_DIR: dataDir },
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }))
  })
}

describe('CLI Flow', () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'fds-cli-'))
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('help command works', async () => {
    const r = await runCli(['help'], dataDir)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('fds — Fair Data Society CLI')
    expect(r.stdout).toContain('fds put')
    expect(r.stdout).toContain('fds get')
  }, 15000)

  it('init creates identity', async () => {
    const r = await runCli(['init'], dataDir)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/Created identity: 0x[0-9a-fA-F]{40}/)
    expect(r.stdout).toMatch(/Mnemonic.*\w+( \w+){11,}/)  // 12+ words
  }, 15000)

  it('full flow: init → put → get → ls', async () => {
    // Init
    const init = await runCli(['init'], dataDir)
    expect(init.exitCode).toBe(0)

    // Create test file
    const inputFile = join(dataDir, '.test-input')
    await writeFile(inputFile, 'hello fds CLI')

    // Put
    const put = await runCli(['put', 'docs/test.txt', inputFile], dataDir)
    expect(put.exitCode).toBe(0)
    expect(put.stdout).toContain('Stored: docs/test.txt')

    // Get to file
    const outFile = join(dataDir, '.test-output')
    const get = await runCli(['get', 'docs/test.txt', '--output', outFile], dataDir)
    expect(get.exitCode).toBe(0)
    const content = await readFile(outFile, 'utf8')
    expect(content).toBe('hello fds CLI')

    // List
    const ls = await runCli(['ls'], dataDir)
    expect(ls.exitCode).toBe(0)
    expect(ls.stdout).toContain('docs')
  }, 30000)

  it('whoami after init shows address', async () => {
    await runCli(['init'], dataDir)
    const r = await runCli(['whoami'], dataDir)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/Address:\s+0x[0-9a-fA-F]{40}/)
  }, 30000)

  it('status --json returns parseable JSON', async () => {
    await runCli(['init'], dataDir)
    const r = await runCli(['status', '--json'], dataDir)
    expect(r.exitCode).toBe(0)
    const status = JSON.parse(r.stdout)
    expect(status.identity.connected).toBe(true)
    expect(status.storage.type).toBe('local')
  }, 30000)
})
