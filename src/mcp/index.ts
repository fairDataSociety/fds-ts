#!/usr/bin/env node
/**
 * fds-mcp — entry point for the MCP server.
 *
 * Run as a stdio MCP server (e.g., from Claude Desktop config).
 * Or import { createServer } from '@fairdatasociety/fds/mcp' for custom transport.
 */

import { startStdioServer } from './server.js'

startStdioServer().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
