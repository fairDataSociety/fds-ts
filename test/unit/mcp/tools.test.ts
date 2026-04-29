/**
 * MCP tool tests — TDD
 *
 * Verifies tool definitions and the dispatch handler against a real FdsClient.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../../../src/client.js'
import { TOOL_DEFINITIONS, callTool } from '../../../src/mcp/tools.js'

describe('MCP tool definitions', () => {
  it('exposes 15 tools', () => {
    expect(TOOL_DEFINITIONS.length).toBe(15)
  })

  it('all tool names are fds_-prefixed', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toMatch(/^fds_/)
    }
  })

  it('all tools have a description and inputSchema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(10)
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('exposes the expected core tools', () => {
    const names = TOOL_DEFINITIONS.map(t => t.name)
    expect(names).toContain('fds_status')
    expect(names).toContain('fds_create_identity')
    expect(names).toContain('fds_put')
    expect(names).toContain('fds_get')
    expect(names).toContain('fds_send')
    expect(names).toContain('fds_share')
    expect(names).toContain('fds_sell')
    expect(names).toContain('fds_publish')
  })
})

describe('MCP tool dispatch', () => {
  let fds: FdsClient
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fds-mcp-'))
    fds = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds.init()
  })

  afterEach(async () => {
    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })

  async function noopPersist(_: string): Promise<void> {}

  it('fds_status returns identity + storage info with _next', async () => {
    const result = await callTool('fds_status', {}, fds, noopPersist)
    expect(result.isError).toBeUndefined()
    const body = JSON.parse(result.content[0].text)
    expect(body.identity).toBeDefined()
    expect(body.storage).toBeDefined()
    expect(body._next).toBe('fds_create_identity')  // no identity yet
  })

  it('fds_create_identity creates and returns identity', async () => {
    const result = await callTool('fds_create_identity', {}, fds, noopPersist)
    const body = JSON.parse(result.content[0].text)
    expect(body.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(body.mnemonic).toBeDefined()
    expect(body._next).toBe('fds_put')
  })

  it('fds_put then fds_get round-trips data', async () => {
    await callTool('fds_create_identity', {}, fds, noopPersist)

    const putR = await callTool('fds_put', { key: 'docs/hello.txt', content: 'world' }, fds, noopPersist)
    expect(putR.isError).toBeUndefined()

    const getR = await callTool('fds_get', { key: 'docs/hello.txt' }, fds, noopPersist)
    const getBody = JSON.parse(getR.content[0].text)
    expect(getBody.content).toBe('world')
    expect(getBody.size).toBe(5)
  })

  it('fds_list returns buckets when no prefix', async () => {
    await callTool('fds_create_identity', {}, fds, noopPersist)
    await callTool('fds_put', { key: 'docs/file.txt', content: 'data' }, fds, noopPersist)

    const result = await callTool('fds_list', {}, fds, noopPersist)
    const body = JSON.parse(result.content[0].text)
    expect(body.buckets).toBeDefined()
    expect(body.buckets.some((b: any) => b.name === 'docs')).toBe(true)
  })

  it('fds_share grants access', async () => {
    await callTool('fds_create_identity', {}, fds, noopPersist)
    await callTool('fds_put', { key: 'research/paper.pdf', content: 'data' }, fds, noopPersist)

    const result = await callTool('fds_share', {
      bucket: 'research',
      recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    }, fds, noopPersist)
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('granted')
  })

  it('fds_sell creates escrow', async () => {
    await callTool('fds_create_identity', {}, fds, noopPersist)
    await callTool('fds_put', { key: 'data/users.csv', content: 'id,name\n1,Alice' }, fds, noopPersist)

    const result = await callTool('fds_sell', {
      key: 'data/users.csv',
      price: '0.01',
      description: 'User data',
    }, fds, noopPersist)
    const body = JSON.parse(result.content[0].text)
    expect(body.escrowId).toBeDefined()
    expect(body.status).toBe('Created')
  })

  it('fds_publish stores unencrypted', async () => {
    await callTool('fds_create_identity', {}, fds, noopPersist)
    const result = await callTool('fds_publish', {
      content: 'Hello, world!',
      filename: 'index.html',
    }, fds, noopPersist)
    const body = JSON.parse(result.content[0].text)
    expect(body.reference).toBeDefined()
  })

  it('unknown tool returns error', async () => {
    const result = await callTool('fds_nonexistent', {}, fds, noopPersist)
    expect(result.isError).toBe(true)
  })

  it('errors include code and recovery', async () => {
    // No identity → fds_put should fail with NO_IDENTITY
    const result = await callTool('fds_put', { key: 'docs/x', content: 'y' }, fds, noopPersist)
    expect(result.isError).toBe(true)
    const body = JSON.parse(result.content[0].text)
    expect(body.code).toBe('NO_IDENTITY')
    expect(body.recovery).toBeDefined()
  })
})
