/**
 * fds CLI command implementations.
 *
 * Each command takes parsed args + an FdsClient and produces output.
 * Commands handle their own error reporting and exit codes.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { FdsClient } from '../client.js'

const FDS_DATA_DIR = process.env.FDS_DATA_DIR || join(homedir(), '.fds')
const IDENTITY_FILE = join(FDS_DATA_DIR, '.identity.json')

interface ParsedArgs {
  command: string
  positional: string[]
  flags: Record<string, string | boolean>
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const name = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        flags[name] = next
        i++
      } else {
        flags[name] = true
      }
    } else {
      positional.push(a)
    }
  }

  const command = positional.shift() || 'help'
  return { command, positional, flags }
}

async function makeClient(): Promise<FdsClient> {
  if (!existsSync(FDS_DATA_DIR)) {
    await mkdir(FDS_DATA_DIR, { recursive: true })
  }
  const fds = new FdsClient({ storage: { type: 'local', path: FDS_DATA_DIR } })
  await fds.init()

  // Auto-load identity if present
  if (existsSync(IDENTITY_FILE)) {
    const data = JSON.parse(await readFile(IDENTITY_FILE, 'utf8'))
    if (data.mnemonic) {
      await fds.identity.import(data.mnemonic)
    }
  }
  return fds
}

async function saveIdentity(mnemonic: string): Promise<void> {
  await mkdir(FDS_DATA_DIR, { recursive: true })
  await writeFile(IDENTITY_FILE, JSON.stringify({ mnemonic }, null, 2), { mode: 0o600 })
}

// ── Command handlers ──────────────────────────────────────

async function cmdHelp(): Promise<void> {
  console.log(`fds — Fair Data Society CLI

Usage:
  fds init [--password <pw>]            Create new identity + default pods
  fds init --import "<mnemonic>"        Import from mnemonic
  fds whoami                            Show current identity
  fds status [--json]                   Show full status
  fds put <key> <file|->                Store object (- = stdin)
  fds get <key> [--output <file>]       Retrieve object
  fds ls [<prefix>]                     List buckets or objects
  fds rm <key>                          Delete object/bucket
  fds head <key>                        Show object metadata
  fds publish <file> [--filename <n>]   Public unencrypted upload
  fds send <recipient> <file>           Encrypted send via ECDH
  fds inbox                             List received messages
  fds share <bucket> <recipient>        Grant access (ACT)
  fds revoke <bucket> <recipient>       Revoke access
  fds grantees <bucket>                 List grantees
  fds sell <key> --price <eth>          Create escrow
  fds escrow <id>                       Show escrow status
  fds stamps                            Show stamp status
  fds help                              This message

Storage: ${FDS_DATA_DIR} (override with FDS_DATA_DIR)
`)
}

async function cmdInit(args: ParsedArgs): Promise<void> {
  const fds = await makeClient()

  if (args.flags.import && typeof args.flags.import === 'string') {
    const id = await fds.identity.import(args.flags.import)
    await saveIdentity(args.flags.import)
    console.log(`Imported identity: ${id.address}`)
  } else {
    const id = await fds.identity.create()
    await saveIdentity(id.mnemonic!)
    console.log(`Created identity: ${id.address}`)
    console.log(`Mnemonic (save this!): ${id.mnemonic}`)
  }

  await fds.destroy()
}

async function cmdWhoami(): Promise<void> {
  const fds = await makeClient()
  const id = fds.identity.current
  if (!id) {
    console.log('No identity. Run: fds init')
  } else {
    console.log(`Address:    ${id.address}`)
    console.log(`Public key: ${id.publicKey}`)
  }
  await fds.destroy()
}

async function cmdStatus(args: ParsedArgs): Promise<void> {
  const fds = await makeClient()
  const status = await fds.status()
  if (args.flags.json) {
    console.log(JSON.stringify(status, null, 2))
  } else {
    console.log(`Identity:  ${status.identity.address ?? '(none)'} ${status.identity.locked ? '🔒' : ''}`)
    console.log(`Storage:   ${status.storage.type} (${status.storage.connected ? 'connected' : 'disconnected'})`)
    console.log(`Stamps:    ${status.stamps.canUpload ? 'available' : 'unavailable'}`)
    console.log(`Inbox:     ${status.inbox.unread} unread`)
  }
  await fds.destroy()
}

async function cmdPut(args: ParsedArgs): Promise<void> {
  const [key, source] = args.positional
  if (!key || !source) throw new Error('Usage: fds put <key> <file|->')

  const fds = await makeClient()
  let data: Buffer
  if (source === '-') {
    data = await readStdin()
  } else {
    data = await readFile(source)
  }
  const result = await fds.put(key, data)
  console.log(`Stored: ${result.bucket}/${result.key} (${result.size} bytes)`)
  await fds.destroy()
}

async function cmdGet(args: ParsedArgs): Promise<void> {
  const [key] = args.positional
  if (!key) throw new Error('Usage: fds get <key> [--output <file>]')

  const fds = await makeClient()
  const data = await fds.get(key)
  if (args.flags.output && typeof args.flags.output === 'string') {
    await writeFile(args.flags.output, data)
    console.log(`Wrote ${data.length} bytes to ${args.flags.output}`)
  } else {
    process.stdout.write(data)
  }
  await fds.destroy()
}

async function cmdLs(args: ParsedArgs): Promise<void> {
  const fds = await makeClient()
  const prefix = args.positional[0]
  const result = await fds.list(prefix)

  const buckets = (result as any).buckets
  if (buckets) {
    console.log('BUCKETS')
    for (const b of buckets) {
      console.log(`  ${b.name}${b.isShared ? ' (shared)' : ''}`)
    }
  }
  if (result.objects?.length) {
    console.log('OBJECTS')
    for (const o of result.objects) {
      console.log(`  ${o.key}\t${o.size}\t${o.lastModified.toISOString()}`)
    }
  }
  if (result.prefixes?.length) {
    console.log('PREFIXES')
    for (const p of result.prefixes) {
      console.log(`  ${p}`)
    }
  }
  await fds.destroy()
}

async function cmdRm(args: ParsedArgs): Promise<void> {
  const [key] = args.positional
  if (!key) throw new Error('Usage: fds rm <key>')
  const fds = await makeClient()
  await fds.delete(key)
  console.log(`Deleted: ${key}`)
  await fds.destroy()
}

async function cmdHead(args: ParsedArgs): Promise<void> {
  const [key] = args.positional
  if (!key) throw new Error('Usage: fds head <key>')
  const fds = await makeClient()
  const meta = await fds.storage.head(key)
  if (!meta) {
    console.log('Not found')
  } else {
    console.log(`Key:          ${meta.key}`)
    console.log(`Size:         ${meta.size}`)
    console.log(`Type:         ${meta.contentType}`)
    console.log(`Created:      ${meta.createdAt.toISOString()}`)
    console.log(`Modified:     ${meta.modifiedAt.toISOString()}`)
    console.log(`Encrypted:    ${meta.encrypted}`)
  }
  await fds.destroy()
}

async function cmdPublish(args: ParsedArgs): Promise<void> {
  const [source] = args.positional
  if (!source) throw new Error('Usage: fds publish <file> [--filename <n>]')
  const fds = await makeClient()
  const data = await readFile(source)
  const filename = (args.flags.filename as string) || source.split('/').pop()
  const result = await fds.publish(data, { filename })
  console.log(`Published: ${result.reference}`)
  if (result.url) console.log(`URL: ${result.url}`)
  await fds.destroy()
}

async function cmdSend(args: ParsedArgs): Promise<void> {
  const [recipient, source] = args.positional
  if (!recipient || !source) throw new Error('Usage: fds send <recipient> <file>')
  const fds = await makeClient()
  const data = await readFile(source)
  const filename = source.split('/').pop()
  const result = await fds.send(recipient, data, { filename })
  console.log(`Sent encrypted to ${result.recipient}`)
  console.log(`Reference: ${result.reference}`)
  await fds.destroy()
}

async function cmdInbox(): Promise<void> {
  const fds = await makeClient()
  const messages = await fds.transfer.receive()
  if (messages.length === 0) {
    console.log('Inbox empty')
  } else {
    for (const m of messages) {
      console.log(`${m.timestamp.toISOString()}\t${m.filename ?? '(no name)'}\t${m.size ?? '?'} bytes\t${m.type}`)
    }
  }
  await fds.destroy()
}

async function cmdShare(args: ParsedArgs): Promise<void> {
  const [bucket, recipient] = args.positional
  if (!bucket || !recipient) throw new Error('Usage: fds share <bucket> <recipient>')
  const fds = await makeClient()
  await fds.sharing.grant(bucket, recipient)
  console.log(`Granted ${recipient} access to ${bucket}`)
  await fds.destroy()
}

async function cmdRevoke(args: ParsedArgs): Promise<void> {
  const [bucket, recipient] = args.positional
  if (!bucket || !recipient) throw new Error('Usage: fds revoke <bucket> <recipient>')
  const fds = await makeClient()
  await fds.sharing.revoke(bucket, recipient)
  console.log(`Revoked ${recipient} from ${bucket}`)
  await fds.destroy()
}

async function cmdGrantees(args: ParsedArgs): Promise<void> {
  const [bucket] = args.positional
  if (!bucket) throw new Error('Usage: fds grantees <bucket>')
  const fds = await makeClient()
  const grantees = await fds.sharing.list(bucket)
  if (grantees.length === 0) {
    console.log('No grantees')
  } else {
    for (const g of grantees) {
      console.log(`${g.address}\t${g.grantedAt.toISOString()}`)
    }
  }
  await fds.destroy()
}

async function cmdSell(args: ParsedArgs): Promise<void> {
  const [key] = args.positional
  if (!key || !args.flags.price) throw new Error('Usage: fds sell <key> --price <eth>')
  const fds = await makeClient()
  const escrow = await fds.escrow.create(key, {
    price: args.flags.price as string,
    description: args.flags.description as string | undefined,
  })
  console.log(`Escrow created: ${escrow.escrowId}`)
  console.log(`Reference: ${escrow.reference}`)
  console.log(`Status: ${escrow.status}`)
  await fds.destroy()
}

async function cmdEscrow(args: ParsedArgs): Promise<void> {
  const [id] = args.positional
  if (!id) throw new Error('Usage: fds escrow <id>')
  const fds = await makeClient()
  const details = await fds.escrow.status(BigInt(id))
  console.log(`Escrow:       ${details.escrowId}`)
  console.log(`Status:       ${details.status}`)
  console.log(`Seller:       ${details.seller}`)
  console.log(`Reference:    ${details.reference}`)
  if (details.description) console.log(`Description:  ${details.description}`)
  await fds.destroy()
}

async function cmdStamps(): Promise<void> {
  const fds = await makeClient()
  const info = await fds.stamps.status()
  console.log(`Available:    ${info.available}`)
  console.log(`Can upload:   ${info.canUpload}`)
  if (info.batchId) console.log(`Batch ID:     ${info.batchId}`)
  await fds.destroy()
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer))
  }
  return Buffer.concat(chunks)
}

// ── Dispatcher ────────────────────────────────────────────

export async function runCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv)

  switch (args.command) {
    case 'help': case '--help': case '-h':
      return cmdHelp()
    case 'init':       return cmdInit(args)
    case 'whoami':     return cmdWhoami()
    case 'status':     return cmdStatus(args)
    case 'put':        return cmdPut(args)
    case 'get':        return cmdGet(args)
    case 'ls': case 'list': return cmdLs(args)
    case 'rm': case 'delete': return cmdRm(args)
    case 'head':       return cmdHead(args)
    case 'publish':    return cmdPublish(args)
    case 'send':       return cmdSend(args)
    case 'inbox':      return cmdInbox()
    case 'share':      return cmdShare(args)
    case 'revoke':     return cmdRevoke(args)
    case 'grantees':   return cmdGrantees(args)
    case 'sell':       return cmdSell(args)
    case 'escrow':     return cmdEscrow(args)
    case 'stamps':     return cmdStamps()
    default:
      console.error(`Unknown command: ${args.command}`)
      console.error('Run: fds help')
      process.exit(1)
  }
}
