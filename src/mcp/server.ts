/**
 * fds-mcp — MCP server wrapping the FDS SDK.
 *
 * Exposes 14 tools for AI agents:
 *   identity:  fds_status, fds_create_identity, fds_import_identity
 *   storage:   fds_put, fds_get, fds_list, fds_delete
 *   transfer:  fds_send, fds_receive
 *   sharing:   fds_share, fds_revoke, fds_grantees
 *   exchange:  fds_sell, fds_escrow_status
 *   public:    fds_publish
 *
 * Per spec engram ENG-2026-0303-005: every tool returns adaptive responses
 * with `_next` and `_recommendations` for agent navigation.
 *
 * Per ENG-2026-0303-022: tool names prefixed with fds_ to avoid collisions.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { homedir } from 'os'
import { join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { FdsClient } from '../client.js'
import { TOOL_DEFINITIONS, callTool } from './tools.js'

const FDS_DATA_DIR = process.env.FDS_DATA_DIR || join(homedir(), '.fds')
const IDENTITY_FILE = join(FDS_DATA_DIR, '.identity.json')

export async function createServer(): Promise<Server> {
  const server = new Server(
    {
      name: 'fds-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: `FDS — Fair Data Society SDK. Sovereign data for AI agents.

Encrypted storage, ECDH messaging, ACT sharing, escrow exchange.

Workflow: call fds_status first. If no identity, fds_create_identity. Then
put/get/list to manage data, send to share encrypted, sell to create escrow.

Storage at ~/.fds (override FDS_DATA_DIR). Identity persists across calls.
All puts encrypted by default. Use fds_publish for explicit unencrypted upload.`,
    },
  )

  // Initialize client lazily on first tool call
  let client: FdsClient | null = null

  async function getClient(): Promise<FdsClient> {
    if (client) return client
    if (!existsSync(FDS_DATA_DIR)) await mkdir(FDS_DATA_DIR, { recursive: true })
    client = new FdsClient({ storage: { type: 'local', path: FDS_DATA_DIR } })
    await client.init()
    if (existsSync(IDENTITY_FILE)) {
      const data = JSON.parse(await readFile(IDENTITY_FILE, 'utf8'))
      if (data.mnemonic) await client.identity.import(data.mnemonic)
    }
    return client
  }

  async function persistIdentity(mnemonic: string): Promise<void> {
    await mkdir(FDS_DATA_DIR, { recursive: true })
    await writeFile(IDENTITY_FILE, JSON.stringify({ mnemonic }, null, 2), { mode: 0o600 })
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const fds = await getClient()
    const result = await callTool(name, args ?? {}, fds, persistIdentity)
    return result as any
  })

  return server
}

export async function startStdioServer(): Promise<void> {
  const server = await createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('fds-mcp running on stdio')
}
