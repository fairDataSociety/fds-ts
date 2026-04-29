/**
 * CLI parser tests — TDD
 */

import { describe, it, expect } from 'vitest'
import { parseArgs } from '../../../src/cli/commands.js'

describe('CLI parser', () => {
  it('parses bare command', () => {
    const r = parseArgs(['help'])
    expect(r.command).toBe('help')
    expect(r.positional).toEqual([])
    expect(r.flags).toEqual({})
  })

  it('parses positional args', () => {
    const r = parseArgs(['put', 'docs/file.txt', '/local/path.txt'])
    expect(r.command).toBe('put')
    expect(r.positional).toEqual(['docs/file.txt', '/local/path.txt'])
  })

  it('parses --flag value', () => {
    const r = parseArgs(['get', 'docs/file', '--output', '/tmp/out.bin'])
    expect(r.command).toBe('get')
    expect(r.positional).toEqual(['docs/file'])
    expect(r.flags.output).toBe('/tmp/out.bin')
  })

  it('parses bare --flag as boolean', () => {
    const r = parseArgs(['status', '--json'])
    expect(r.command).toBe('status')
    expect(r.flags.json).toBe(true)
  })

  it('parses init with mnemonic import', () => {
    const r = parseArgs(['init', '--import', 'twelve word mnemonic phrase here for testing purposes only'])
    expect(r.command).toBe('init')
    expect(r.flags.import).toBe('twelve word mnemonic phrase here for testing purposes only')
  })

  it('parses sell with price', () => {
    const r = parseArgs(['sell', 'data/file.csv', '--price', '0.01', '--description', 'test'])
    expect(r.command).toBe('sell')
    expect(r.positional).toEqual(['data/file.csv'])
    expect(r.flags.price).toBe('0.01')
    expect(r.flags.description).toBe('test')
  })

  it('defaults to help when no command', () => {
    const r = parseArgs([])
    expect(r.command).toBe('help')
  })
})
