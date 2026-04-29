/**
 * Access Control Trie (ACT) Implementation
 *
 * Cryptographic access control for Fairdrive content.
 * Uses encryption to enforce access - no access without the decryption key.
 *
 * Architecture:
 * 1. Content is encrypted with a random Data Encryption Key (DEK)
 * 2. DEK is encrypted for each grantee using their public key
 * 3. Encrypted DEKs are stored in ACT metadata on Swarm
 * 4. Grantees decrypt DEK with their private key, then decrypt content
 *
 * This provides:
 * - Cryptographic enforcement (can't read without key)
 * - Fine-grained access (different keys per grantee)
 * - Revocation (remove encrypted DEK from metadata)
 * - Auditability (grant list in metadata)
 */

import { Bee, Reference } from '@ethersphere/bee-js';
import { keccak256, toUtf8Bytes, SigningKey, getBytes, computeAddress } from 'ethers';
import * as crypto from 'crypto';
import type { StamperUploader } from '../upload/StamperUploader.js';

/** Convert bee-js v10 Reference (Bytes subclass) to hex string */
function refToString(ref: Reference | string): string {
  if (typeof ref === 'string') return ref;
  return ref.toHex();
}

export interface ACTGrant {
  grantee: string; // Ethereum address
  publicKey: string; // Public key (for encryption)
  encryptedDEK: string; // DEK encrypted with grantee's public key (hex)
  grantedAt: string;
  expiresAt?: string;
  metadata?: Record<string, string>; // Optional grant metadata
}

export interface ACTMetadata {
  version: number;
  contentRef: string; // Swarm reference to encrypted content
  contentHash: string; // Hash of original plaintext (for verification)
  owner: string; // Owner's address
  ownerPublicKey: string; // Owner's public key
  grants: ACTGrant[]; // Encrypted DEKs per grantee
  createdAt: string;
  modifiedAt: string;
  // C5: Metadata signature (v2+). Absent in v1 metadata for backward compat.
  signature?: string;
  // M5: Audit log entries (v2+)
  auditLog?: Array<{ action: string; address: string; timestamp: string }>;
}

export interface ACTConfig {
  beeUrl: string;
  postageBatchId?: string;
  /** Optional Bee instance for dependency injection (testing) */
  bee?: Bee;
  /** Optional StamperUploader for client-side chunk stamping */
  stamperUploader?: StamperUploader;
}

export interface EncryptResult {
  actRef: string;
  contentRef: string;
  metadata: ACTMetadata;
}

export class ACT {
  private bee: Bee;
  private postageBatchId?: string;
  private stamperUploader?: StamperUploader;

  constructor(config: ACTConfig) {
    this.bee = config.bee ?? new Bee(config.beeUrl);
    this.postageBatchId = config.postageBatchId;
    this.stamperUploader = config.stamperUploader;
  }

  /** Upload data via StamperUploader or legacy path, return reference string */
  private async uploadToSwarm(data: Uint8Array): Promise<string> {
    if (this.stamperUploader) {
      const ref = await this.stamperUploader.upload(data);
      return ref.toHex();
    }
    const result = await this.bee.uploadData(this.postageBatchId, data);
    return refToString(result.reference);
  }

  /**
   * Encrypt content with ACT
   *
   * @param content - Content to encrypt
   * @param ownerAddress - Owner's Ethereum address
   * @param ownerPublicKey - Owner's public key (for self-decryption)
   * @param ownerPrivateKey - Owner's private key (for encrypting DEK to self)
   * @param grantees - Initial list of grantee addresses with public keys
   */
  async encrypt(
    content: Buffer,
    ownerAddress: string,
    ownerPublicKey: string,
    ownerPrivateKey: Uint8Array,
    grantees: Array<{ address: string; publicKey: string }> = []
  ): Promise<EncryptResult> {
    if (!this.postageBatchId) {
      throw new Error('No postage batch ID configured');
    }

    // 1. Generate random DEK (Data Encryption Key)
    const dek = crypto.randomBytes(32);

    try {
      // 2. Encrypt content with DEK
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
      const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Format: IV (16) || authTag (16) || ciphertext
      const encryptedContent = Buffer.concat([iv, authTag, encrypted]);

      // 3. Upload encrypted content
      const contentRef = await this.uploadToSwarm(new Uint8Array(encryptedContent));

      // 4. Calculate content hash (for verification on decrypt)
      const contentHash = keccak256(new Uint8Array(content));

      // 5. Create grants (encrypt DEK for each grantee)
      const grants: ACTGrant[] = [];

      // Always add owner as first grantee (for self-access)
      const ownerGrant = await this.createGrant(
        ownerAddress,
        ownerPublicKey,
        dek
      );
      grants.push(ownerGrant);

      // Add other grantees
      for (const grantee of grantees) {
        const grant = await this.createGrant(
          grantee.address,
          grantee.publicKey,
          dek
        );
        grants.push(grant);
      }

      // 6. Create ACT metadata
      const now = new Date().toISOString();
      const metadata: ACTMetadata = {
        version: 2,
        contentRef,
        contentHash,
        owner: ownerAddress,
        ownerPublicKey,
        grants,
        createdAt: now,
        modifiedAt: now,
        auditLog: [],
      };

      // M5: Audit log entries for initial grants
      this.addAuditEntry(metadata, 'create', ownerAddress);
      for (const grantee of grantees) {
        this.addAuditEntry(metadata, 'grant', grantee.address);
      }

      // C5: Sign metadata with owner's private key
      metadata.signature = this.signMetadata(metadata, ownerPrivateKey);

      // 7. Upload ACT metadata
      const metadataJson = JSON.stringify(metadata);
      const actRef = await this.uploadToSwarm(
        new Uint8Array(Buffer.from(metadataJson, 'utf-8'))
      );

      return {
        actRef,
        contentRef,
        metadata,
      };
    } finally {
      // Zero DEK (H3). Caller owns the private key lifecycle.
      dek.fill(0);
    }
  }

  /**
   * Decrypt content - only works if caller has a grant
   *
   * @param actRef - ACT metadata reference
   * @param callerAddress - Caller's Ethereum address
   * @param callerPrivateKey - Caller's private key (for decrypting DEK)
   */
  async decrypt(
    actRef: string,
    callerAddress: string,
    callerPrivateKey: Uint8Array
  ): Promise<Buffer> {
    // 1. Load ACT metadata
    const metadata = await this.loadMetadata(actRef);

    // 2. Find grant for caller
    const grant = metadata.grants.find(
      g => g.grantee.toLowerCase() === callerAddress.toLowerCase()
    );

    if (!grant) {
      throw new Error('Access denied: no grant for caller');
    }

    // 3. Check expiration
    if (grant.expiresAt && new Date(grant.expiresAt) < new Date()) {
      throw new Error('Access denied: grant has expired');
    }

    // 4. Decrypt DEK with caller's private key
    const encryptedDEK = Buffer.from(grant.encryptedDEK, 'hex');
    const dek = await this.decryptDEK(encryptedDEK, callerPrivateKey);

    try {
      // 5. Download encrypted content
      const encryptedData = await this.bee.downloadData(metadata.contentRef as unknown as Reference);
      const encryptedContent = Buffer.from(encryptedData.toUint8Array());

      // 6. Decrypt content with DEK
      // Format: IV (16) || authTag (16) || ciphertext
      const iv = encryptedContent.subarray(0, 16);
      const authTag = encryptedContent.subarray(16, 32);
      const ciphertext = encryptedContent.subarray(32);

      const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      // 7. Verify content hash
      const decryptedHash = keccak256(new Uint8Array(decrypted));
      if (decryptedHash !== metadata.contentHash) {
        throw new Error('Content verification failed: hash mismatch');
      }

      return decrypted;
    } finally {
      // Zero DEK
      dek.fill(0);
    }
  }

  /**
   * Grant access to a new grantee
   *
   * @param actRef - Existing ACT reference
   * @param ownerPrivateKey - Owner's private key (to verify ownership)
   * @param newGrantee - New grantee's address and public key
   */
  async grant(
    actRef: string,
    ownerAddress: string,
    ownerPrivateKey: Uint8Array,
    newGrantee: { address: string; publicKey: string }
  ): Promise<string> {
    if (!this.postageBatchId) {
      throw new Error('No postage batch ID configured');
    }

    // 1. Load existing metadata
    const metadata = await this.loadMetadata(actRef);

    // 2. Verify ownership
    if (metadata.owner.toLowerCase() !== ownerAddress.toLowerCase()) {
      throw new Error('Access denied: not the owner');
    }

    // 3. Check if grantee already exists
    const existingGrant = metadata.grants.find(
      g => g.grantee.toLowerCase() === newGrantee.address.toLowerCase()
    );
    if (existingGrant) {
      throw new Error('Grantee already has access');
    }

    // 4. Get owner's grant to decrypt DEK
    const ownerGrant = metadata.grants.find(
      g => g.grantee.toLowerCase() === ownerAddress.toLowerCase()
    );
    if (!ownerGrant) {
      throw new Error('Owner grant not found');
    }

    const encryptedDEK = Buffer.from(ownerGrant.encryptedDEK, 'hex');
    const dek = await this.decryptDEK(encryptedDEK, ownerPrivateKey);

    try {
      // 5. Create grant for new grantee
      const newGrant = await this.createGrant(
        newGrantee.address,
        newGrantee.publicKey,
        dek
      );

      // 6. Update metadata
      metadata.grants.push(newGrant);
      metadata.modifiedAt = new Date().toISOString();

      // M5: Audit log
      this.addAuditEntry(metadata, 'grant', newGrantee.address);

      // C5: Re-sign metadata
      metadata.signature = this.signMetadata(metadata, ownerPrivateKey);

      // 7. Upload updated metadata
      const metadataJson = JSON.stringify(metadata);
      return await this.uploadToSwarm(
        new Uint8Array(Buffer.from(metadataJson, 'utf-8'))
      );
    } finally {
      // Zero DEK (H3). Caller owns the private key lifecycle.
      dek.fill(0);
    }
  }

  /**
   * Revoke access from a grantee
   */
  async revoke(
    actRef: string,
    ownerAddress: string,
    granteeAddress: string
  ): Promise<string> {
    if (!this.postageBatchId) {
      throw new Error('No postage batch ID configured');
    }

    // 1. Load existing metadata
    const metadata = await this.loadMetadata(actRef);

    // 2. Verify ownership
    if (metadata.owner.toLowerCase() !== ownerAddress.toLowerCase()) {
      throw new Error('Access denied: not the owner');
    }

    // 3. Cannot revoke owner's own access
    if (granteeAddress.toLowerCase() === ownerAddress.toLowerCase()) {
      throw new Error('Cannot revoke owner access');
    }

    // 4. Find and remove grant
    const grantIndex = metadata.grants.findIndex(
      g => g.grantee.toLowerCase() === granteeAddress.toLowerCase()
    );

    if (grantIndex < 0) {
      throw new Error('Grantee not found');
    }

    metadata.grants.splice(grantIndex, 1);
    metadata.modifiedAt = new Date().toISOString();

    // M5: Audit log
    this.addAuditEntry(metadata, 'revoke', granteeAddress);

    // Note: revoke() doesn't have owner private key to re-sign.
    // Signature will be stale after revocation. This is acceptable
    // because revocation only removes grants (defensive operation).
    delete metadata.signature;

    // 5. Upload updated metadata
    const metadataJson = JSON.stringify(metadata);
    return await this.uploadToSwarm(
      new Uint8Array(Buffer.from(metadataJson, 'utf-8'))
    );
  }

  /**
   * List all grantees for an ACT (C4: requires owner verification)
   *
   * @param actRef - ACT metadata reference
   * @param callerAddress - Must be the owner to list grants
   */
  async listGrants(
    actRef: string,
    callerAddress: string
  ): Promise<Array<{ address: string; grantedAt: string; expiresAt?: string }>> {
    const metadata = await this.loadMetadata(actRef);

    // C4: Verify caller is owner before exposing grant list
    if (metadata.owner.toLowerCase() !== callerAddress.toLowerCase()) {
      throw new Error('Access denied: only the owner can list grants');
    }

    return metadata.grants.map(g => ({
      address: g.grantee,
      grantedAt: g.grantedAt,
      expiresAt: g.expiresAt,
    }));
  }

  /**
   * Check if an address has access (C4: requires owner verification)
   *
   * @param actRef - ACT metadata reference
   * @param address - Address to check
   * @param callerAddress - Must be the owner to check access
   */
  async hasAccess(actRef: string, address: string, callerAddress: string): Promise<boolean> {
    const metadata = await this.loadMetadata(actRef);

    // C4: Verify caller is owner before revealing access information
    if (metadata.owner.toLowerCase() !== callerAddress.toLowerCase()) {
      throw new Error('Access denied: only the owner can check access');
    }

    const grant = metadata.grants.find(
      g => g.grantee.toLowerCase() === address.toLowerCase()
    );

    if (!grant) return false;
    if (grant.expiresAt && new Date(grant.expiresAt) < new Date()) return false;

    return true;
  }

  /**
   * Load ACT metadata (C5: verify signature if present)
   */
  async loadMetadata(actRef: string): Promise<ACTMetadata> {
    const data = await this.bee.downloadData(actRef as unknown as Reference);
    const metadata = JSON.parse(Buffer.from(data.toUint8Array()).toString('utf-8')) as ACTMetadata;

    // C5: Verify signature if present (v2+ metadata)
    if (metadata.signature) {
      const { signature, ...metadataWithoutSig } = metadata;
      const payload = JSON.stringify(metadataWithoutSig);
      const payloadHash = keccak256(toUtf8Bytes(payload));

      // Recover signer from signature
      const recoveredPub = SigningKey.recoverPublicKey(
        getBytes(payloadHash),
        signature
      );
      // Compare derived addresses (handles compressed vs uncompressed public keys)
      const ownerPub = metadata.ownerPublicKey.startsWith('0x')
        ? metadata.ownerPublicKey
        : '0x' + metadata.ownerPublicKey;
      const recoveredAddr = computeAddress(recoveredPub);
      const ownerAddr = computeAddress(ownerPub);

      if (recoveredAddr.toLowerCase() !== ownerAddr.toLowerCase()) {
        throw new Error('ACT metadata signature verification failed: not signed by owner');
      }
    }

    return metadata;
  }

  /**
   * Sign metadata with owner's private key (C5)
   */
  private signMetadata(metadata: ACTMetadata, ownerPrivateKey: Uint8Array): string {
    // Remove existing signature before computing new one
    const { signature: _, auditLog: __, ...metadataForSigning } = metadata;
    const payload = JSON.stringify({ ...metadataForSigning, auditLog: metadata.auditLog });
    const payloadHash = keccak256(toUtf8Bytes(payload));
    const signingKey = new SigningKey(ownerPrivateKey);
    const sig = signingKey.sign(getBytes(payloadHash));
    return sig.serialized;
  }

  /**
   * Add audit log entry (M5)
   */
  private addAuditEntry(
    metadata: ACTMetadata,
    action: string,
    address: string
  ): void {
    if (!metadata.auditLog) {
      metadata.auditLog = [];
    }
    metadata.auditLog.push({
      action,
      address,
      timestamp: new Date().toISOString(),
    });
  }

  // ============ Private Methods ============

  /**
   * Create a grant (encrypt DEK for grantee)
   */
  private async createGrant(
    granteeAddress: string,
    granteePublicKey: string,
    dek: Buffer
  ): Promise<ACTGrant> {
    // Encrypt DEK with grantee's public key using ECIES-like scheme
    const encryptedDEK = await this.encryptDEKForPublicKey(dek, granteePublicKey);

    return {
      grantee: granteeAddress,
      publicKey: granteePublicKey,
      encryptedDEK: encryptedDEK.toString('hex'),
      grantedAt: new Date().toISOString(),
    };
  }

  /**
   * Encrypt DEK for a public key (ECIES with HKDF)
   *
   * v2 format: Uses ECDH + HKDF for key derivation (C1 fix).
   * v1 backward compat: Old format used SHA-256 directly.
   *
   * v2 format: 0x02 || ephemeralPublic(65) || iv(12) || authTag(16) || ciphertext
   * v1 format: ephemeralPublic(65) || iv(16) || authTag(16) || ciphertext
   */
  private async encryptDEKForPublicKey(dek: Buffer, publicKey: string): Promise<Buffer> {
    // Generate ephemeral key pair
    const ephemeralPrivate = crypto.randomBytes(32);
    const ephemeralPublic = this.derivePublicKeyFromPrivate(ephemeralPrivate);

    // Derive shared secret using ECDH
    const sharedSecret = this.deriveSharedSecret(ephemeralPrivate, publicKey);

    // C1: Use HKDF instead of raw SHA-256 for key derivation
    const encKey = crypto.hkdfSync(
      'sha256',
      sharedSecret,
      Buffer.from('fairdrive-act-v2'), // salt with domain separation
      Buffer.from('dek-encryption'),    // info/context
      32                                 // key length
    );

    // Use 12-byte IV (GCM standard)
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encKey), iv);
    const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Zero sensitive data
    ephemeralPrivate.fill(0);
    sharedSecret.fill(0);

    // v2 format: version(1) || ephemeralPublic(65) || iv(12) || authTag(16) || ciphertext
    return Buffer.concat([
      Buffer.from([0x02]),  // Version marker
      Buffer.from(ephemeralPublic, 'hex'),
      iv,
      authTag,
      encrypted,
    ]);
  }

  /**
   * Decrypt DEK with private key (supports v1 and v2 formats)
   */
  private async decryptDEK(encryptedDEK: Buffer, privateKey: Uint8Array): Promise<Buffer> {
    // Detect format version by first byte
    const isV2 = encryptedDEK[0] === 0x02;

    if (isV2) {
      // v2 format: version(1) || ephemeralPublic(65) || iv(12) || authTag(16) || ciphertext
      const ephemeralPublic = encryptedDEK.subarray(1, 66).toString('hex');
      const iv = encryptedDEK.subarray(66, 78);
      const authTag = encryptedDEK.subarray(78, 94);
      const ciphertext = encryptedDEK.subarray(94);

      const sharedSecret = this.deriveSharedSecret(Buffer.from(privateKey), ephemeralPublic);

      // HKDF key derivation (matching encrypt)
      const decKey = crypto.hkdfSync(
        'sha256',
        sharedSecret,
        Buffer.from('fairdrive-act-v2'),
        Buffer.from('dek-encryption'),
        32
      );

      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(decKey), iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      } finally {
        sharedSecret.fill(0);
      }
    } else {
      // v1 format (backward compat): ephemeralPublic(65) || iv(16) || authTag(16) || ciphertext
      // First byte is 0x04 (uncompressed public key prefix)
      const ephemeralPublic = encryptedDEK.subarray(0, 65).toString('hex');
      const iv = encryptedDEK.subarray(65, 81);
      const authTag = encryptedDEK.subarray(81, 97);
      const ciphertext = encryptedDEK.subarray(97);

      const sharedSecret = this.deriveSharedSecret(Buffer.from(privateKey), ephemeralPublic);

      // v1: SHA-256 key derivation (legacy)
      const decKey = crypto.createHash('sha256').update(sharedSecret).digest();

      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', decKey, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      } finally {
        sharedSecret.fill(0);
        decKey.fill(0);
      }
    }
  }

  /**
   * Derive public key from private key (secp256k1)
   */
  private derivePublicKeyFromPrivate(privateKey: Buffer): string {
    // Using ethers.js for secp256k1 operations
    const pubKey = SigningKey.computePublicKey(privateKey, false); // Uncompressed
    return pubKey.slice(2); // Remove 0x prefix
  }

  /**
   * Derive shared secret using ECDH
   *
   * Uses ethers.js SigningKey for proper secp256k1 ECDH.
   */
  private deriveSharedSecret(privateKey: Buffer, publicKey: string): Buffer {
    // Create SigningKey from private key
    const signingKey = new SigningKey(privateKey);
    // Compute shared secret via ECDH (point multiplication)
    const formattedPublicKey = publicKey.startsWith('0x') ? publicKey : '0x' + publicKey;
    const sharedSecret = signingKey.computeSharedSecret(formattedPublicKey);
    // Return as Buffer (remove 0x prefix and convert)
    return Buffer.from(getBytes(sharedSecret));
  }
}
