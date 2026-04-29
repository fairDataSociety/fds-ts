/**
 * Key Derivation — the crypto foundation of FDS.
 *
 * Chain: wallet privkey → pod key (keccak256) → file key (PBKDF2)
 *
 * Pod key: keccak256(privateKeyHex + ":pod:" + podName)
 *   - Matches Go fds-id-go derivation for cross-platform interop
 *   - ":pod:" separator prevents concatenation collisions
 *
 * File key: PBKDF2(podKey, salt="fairdrive:v1:{podName}:{filePath}", 100000, SHA-256)
 *   - Per-file key isolation: compromising one file key doesn't expose others
 *   - 100k PBKDF2 iterations (OWASP 2023+ recommendation)
 */

import { keccak_256 } from '@noble/hashes/sha3.js'
import { pbkdf2 } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'

/**
 * Derive a pod encryption key from wallet private key and pod name.
 *
 * @param privateKeyHex - Wallet private key as hex string (with or without 0x prefix)
 * @param podName - Pod (bucket) name
 * @returns 32-byte pod key
 */
export function derivePodKey(privateKeyHex: string, podName: string): Uint8Array {
  // Normalize: strip 0x prefix
  const normalized = privateKeyHex.startsWith('0x')
    ? privateKeyHex.slice(2)
    : privateKeyHex

  // keccak256(privKeyHex + ":pod:" + podName)
  const input = new TextEncoder().encode(normalized + ':pod:' + podName)
  return keccak_256(input)
}

/**
 * Derive a per-file encryption key from pod key, pod name, and file path.
 *
 * @param podKey - 32-byte pod key (from derivePodKey)
 * @param podName - Pod name (included in salt for domain separation)
 * @param filePath - File path within pod
 * @returns 32-byte file key
 */
export async function deriveFileKey(
  podKey: Uint8Array,
  podName: string,
  filePath: string
): Promise<Uint8Array> {
  const salt = new TextEncoder().encode(`fairdrive:v1:${podName}:${filePath}`)
  return pbkdf2(sha256, podKey, salt, { c: 100000, dkLen: 32 })
}

/**
 * Validate a pod name for safe use in key derivation.
 *
 * Rejects names that could cause KDF ambiguity (spec finding S11):
 * - Colons (could inject ":pod:" separator)
 * - Path separators (traversal)
 * - Empty strings
 */
export function validatePodName(name: string): boolean {
  if (!name || name.length === 0) return false
  if (name.includes(':')) return false
  if (name.includes('/')) return false
  if (name.includes('\\')) return false
  if (name.includes('..')) return false
  return true
}
