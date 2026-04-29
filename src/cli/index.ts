#!/usr/bin/env node
/**
 * fds — command-line interface for @fairdatasociety/fds
 *
 * Usage:
 *   fds init [--password <pw>]            Create new identity + default pods
 *   fds init --import "<mnemonic>"        Import from mnemonic
 *   fds whoami                            Show current identity
 *   fds status [--json]                   Show full status
 *   fds put <key> <file|->                Store object (- = stdin)
 *   fds get <key> [--output <file>]       Retrieve object (default: stdout)
 *   fds ls [<prefix>]                     List buckets or objects
 *   fds rm <key>                          Delete object/bucket
 *   fds head <key>                        Show object metadata
 *   fds publish <file> [--filename <n>]   Public unencrypted upload
 *   fds send <recipient> <file>           Encrypted send
 *   fds inbox                             List received messages
 *   fds share <bucket> <recipient>        Grant access
 *   fds revoke <bucket> <recipient>       Revoke access
 *   fds grantees <bucket>                 List grantees
 *   fds sell <key> --price <eth>          Create escrow
 *   fds escrow status <id>                Show escrow status
 *   fds stamps                            Show stamp status
 *
 * Storage location: ~/.fds (override with FDS_DATA_DIR)
 * Identity: imported from FDS_MNEMONIC env or ~/.fds/.identity
 */

import { runCli } from './commands.js'

// Parse args, dispatch to command handlers
runCli(process.argv.slice(2)).catch((err) => {
  if (err && typeof err === 'object' && 'code' in err) {
    console.error(`Error [${(err as any).code}]: ${err.message}`)
    if ((err as any).recovery) {
      console.error(`  → ${(err as any).recovery}`)
    }
  } else {
    console.error('Error:', err instanceof Error ? err.message : String(err))
  }
  process.exit(1)
})
