/**
 * fds-mcp tool definitions and handlers.
 *
 * Each tool returns an MCP tool result with adaptive _next hints (ENG-2026-0303-005)
 * for agent navigation.
 */

import type { FdsClient } from '../client.js'

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function ok(payload: unknown, _next?: string, _recommendations?: string[]): ToolResponse {
  const body: Record<string, unknown> = { ...((payload as Record<string, unknown>) || {}) }
  if (_next) body._next = _next
  if (_recommendations && _recommendations.length) body._recommendations = _recommendations
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
  }
}

function err(error: unknown): ToolResponse {
  const e = error as any
  return {
    content: [{ type: 'text', text: JSON.stringify({
      error: e?.message ?? String(error),
      code: e?.code,
      recovery: e?.recovery,
    }, null, 2) }],
    isError: true,
  }
}

export const TOOL_DEFINITIONS = [
  {
    name: 'fds_status',
    description: 'Check FDS readiness: identity, storage, stamps, inbox. Returns next recommended action.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'fds_create_identity',
    description: 'Create a new HD wallet identity. Returns address + mnemonic (save it!). Mnemonic is returned ONCE.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        password: { type: 'string', description: 'Optional password for SecureWallet (PBKDF2-encrypted)' },
        wordCount: { type: 'number', enum: [12, 24], description: 'Mnemonic word count (default 12)' },
      },
    },
  },
  {
    name: 'fds_import_identity',
    description: 'Import identity from BIP-39 mnemonic phrase.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        mnemonic: { type: 'string', description: '12 or 24 word mnemonic phrase' },
      },
      required: ['mnemonic'],
    },
  },
  {
    name: 'fds_put',
    description: 'Store an object (encrypted by default). Auto-creates bucket if needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Object key in format "bucket/path"' },
        content: { type: 'string', description: 'Content to store (UTF-8 text)' },
        contentType: { type: 'string' },
      },
      required: ['key', 'content'],
    },
  },
  {
    name: 'fds_get',
    description: 'Retrieve an object (auto-decrypts).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Object key' },
      },
      required: ['key'],
    },
  },
  {
    name: 'fds_list',
    description: 'List buckets (no prefix) or objects within a bucket (with prefix).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prefix: { type: 'string', description: 'Optional prefix like "documents/" to list within a bucket' },
      },
    },
  },
  {
    name: 'fds_delete',
    description: 'Delete an object or empty bucket.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Object key or bucket name' },
      },
      required: ['key'],
    },
  },
  {
    name: 'fds_send',
    description: 'Send encrypted data to a recipient (ECDH). Recipient is hex public key or ENS name.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        recipient: { type: 'string', description: 'Recipient public key (0x-prefixed hex) or ENS name' },
        content: { type: 'string', description: 'Content to send (UTF-8 text)' },
        filename: { type: 'string' },
      },
      required: ['recipient', 'content'],
    },
  },
  {
    name: 'fds_receive',
    description: 'List received messages from inbox.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'fds_share',
    description: 'Grant access to a bucket via ACT.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bucket: { type: 'string' },
        recipient: { type: 'string', description: 'Recipient address or ENS' },
      },
      required: ['bucket', 'recipient'],
    },
  },
  {
    name: 'fds_revoke',
    description: 'Revoke a grantee. Note: revocation is metadata-only on Swarm; old refs may still decrypt.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bucket: { type: 'string' },
        recipient: { type: 'string' },
      },
      required: ['bucket', 'recipient'],
    },
  },
  {
    name: 'fds_grantees',
    description: 'List grantees of a bucket.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bucket: { type: 'string' },
      },
      required: ['bucket'],
    },
  },
  {
    name: 'fds_sell',
    description: 'Create an escrow for a stored object. Encrypts with new key, returns escrowId.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Object key to sell' },
        price: { type: 'string', description: 'Price in ETH (e.g. "0.01")' },
        description: { type: 'string' },
      },
      required: ['key', 'price'],
    },
  },
  {
    name: 'fds_escrow_status',
    description: 'Get details for an escrow by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        escrowId: { type: 'string', description: 'Escrow ID (numeric string)' },
      },
      required: ['escrowId'],
    },
  },
  {
    name: 'fds_publish',
    description: 'Publish data PUBLICLY (unencrypted). Anyone with the reference can read.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'Content to publish (UTF-8)' },
        filename: { type: 'string' },
      },
      required: ['content'],
    },
  },
] as const

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  fds: FdsClient,
  persistIdentity: (mnemonic: string) => Promise<void>,
): Promise<ToolResponse> {
  try {
    switch (name) {
      case 'fds_status': {
        const status = await fds.status()
        const _next = !status.identity.connected ? 'fds_create_identity'
                    : !status.storage.connected ? 'fds_status'
                    : 'fds_put'
        const recs: string[] = []
        if (!status.identity.connected) recs.push('Run fds_create_identity to create a wallet')
        if (status.identity.locked) recs.push('Identity is locked')
        return ok(status, _next, recs)
      }

      case 'fds_create_identity': {
        const id = await fds.identity.create({
          password: args.password as string | undefined,
          wordCount: args.wordCount as 12 | 24 | undefined,
        })
        if (id.mnemonic) await persistIdentity(id.mnemonic)
        return ok(id, 'fds_put')
      }

      case 'fds_import_identity': {
        const mnemonic = args.mnemonic as string
        const id = await fds.identity.import(mnemonic)
        await persistIdentity(mnemonic)
        return ok(id, 'fds_put')
      }

      case 'fds_put': {
        const key = args.key as string
        const content = args.content as string
        const result = await fds.put(key, content, {
          contentType: args.contentType as string | undefined,
        })
        return ok(result, 'fds_get')
      }

      case 'fds_get': {
        const key = args.key as string
        const data = await fds.get(key)
        return ok({
          key,
          size: data.length,
          content: new TextDecoder().decode(data),
        }, 'fds_list')
      }

      case 'fds_list': {
        const prefix = args.prefix as string | undefined
        const result = await fds.list(prefix)
        return ok(result, prefix ? 'fds_get' : 'fds_list')
      }

      case 'fds_delete': {
        await fds.delete(args.key as string)
        return ok({ deleted: args.key }, 'fds_list')
      }

      case 'fds_send': {
        const result = await fds.send(args.recipient as string, args.content as string, {
          filename: args.filename as string | undefined,
        })
        return ok(result, 'fds_status')
      }

      case 'fds_receive': {
        const messages = await fds.transfer.receive()
        return ok({ messages, count: messages.length }, messages.length ? 'fds_get' : 'fds_status')
      }

      case 'fds_share': {
        await fds.sharing.grant(args.bucket as string, args.recipient as string)
        return ok({ granted: { bucket: args.bucket, recipient: args.recipient } }, 'fds_grantees')
      }

      case 'fds_revoke': {
        await fds.sharing.revoke(args.bucket as string, args.recipient as string)
        return ok(
          { revoked: { bucket: args.bucket, recipient: args.recipient } },
          'fds_grantees',
          ['Note: ACT revocation is metadata-only. Old grantees may retain old data via cached references. Use rotateAccess for true revocation.'],
        )
      }

      case 'fds_grantees': {
        const grantees = await fds.sharing.list(args.bucket as string)
        return ok({ bucket: args.bucket, grantees }, 'fds_status')
      }

      case 'fds_sell': {
        const escrow = await fds.escrow.create(args.key as string, {
          price: args.price as string,
          description: args.description as string | undefined,
        })
        return ok({
          escrowId: escrow.escrowId.toString(),
          reference: escrow.reference,
          contentHash: escrow.contentHash,
          status: escrow.status,
        }, 'fds_escrow_status')
      }

      case 'fds_escrow_status': {
        const details = await fds.escrow.status(BigInt(args.escrowId as string))
        return ok({
          escrowId: details.escrowId.toString(),
          status: details.status,
          seller: details.seller,
          description: details.description,
          contentHash: details.contentHash,
          reference: details.reference,
          createdAt: details.createdAt.toISOString(),
        }, 'fds_status')
      }

      case 'fds_publish': {
        const result = await fds.publish(args.content as string, {
          filename: args.filename as string | undefined,
        })
        return ok(result, 'fds_status')
      }

      default:
        return err({ message: `Unknown tool: ${name}`, code: 'INVALID_INPUT' })
    }
  } catch (e) {
    return err(e)
  }
}
