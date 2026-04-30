/**
 * HD Wallet Implementation (BIP-39 / BIP-44)
 *
 * Provides hierarchical deterministic wallet functionality:
 * - Generate and validate mnemonic phrases (12 or 24 words)
 * - Derive accounts using BIP-44 paths
 * - Compatible with standard Ethereum wallets (MetaMask, etc.)
 *
 * Default derivation path: m/44'/60'/0'/0/0 (Ethereum)
 */

import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english'
import * as bip39 from '@scure/bip39'
import { HDKey } from '@scure/bip32'
import { Wallet } from './wallet.js'
import { createKeystore, type EncryptedKeystore, type KeystoreOptions } from './keystore.js'

// ============================================================================
// Constants
// ============================================================================

/**
 * Default Ethereum derivation path (BIP-44)
 */
export const DEFAULT_PATH = "m/44'/60'/0'/0/0"

/**
 * Ethereum coin type for BIP-44
 */
export const ETHEREUM_COIN_TYPE = 60

// ============================================================================
// Types
// ============================================================================

/**
 * Options for HD wallet creation
 */
export interface HDWalletOptions {
  /**
   * Passphrase for additional security (optional)
   * Note: This is different from encryption password
   */
  passphrase?: string
  /**
   * Number of words in mnemonic (12 or 24)
   * 12 words = 128 bits entropy
   * 24 words = 256 bits entropy (more secure)
   */
  wordCount?: 12 | 24
}

/**
 * Derived account information
 */
export interface DerivedAccount {
  wallet: Wallet
  path: string
  index: number
}

// ============================================================================
// HD Wallet Class
// ============================================================================

/**
 * Hierarchical Deterministic Wallet
 */
export class HDWallet {
  private readonly _mnemonic: string
  private readonly _masterKey: HDKey
  private readonly _accounts: Map<string, Wallet> = new Map()

  /**
   * Create HD wallet from mnemonic
   * Use static factory methods instead of constructor directly
   */
  private constructor(mnemonic: string, passphrase: string = '') {
    if (!bip39.validateMnemonic(mnemonic, englishWordlist)) {
      throw new Error('Invalid mnemonic')
    }

    this._mnemonic = mnemonic

    // Derive seed from mnemonic
    const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase)

    // Create master key from seed
    this._masterKey = HDKey.fromMasterSeed(seed)
  }

  /**
   * Generate a new HD wallet with random mnemonic
   *
   * @param options - Wallet options
   * @returns HD wallet and mnemonic phrase
   */
  static generate(options: HDWalletOptions = {}): { wallet: HDWallet; mnemonic: string } {
    const { wordCount = 24, passphrase = '' } = options

    // Generate entropy
    const strength = wordCount === 12 ? 128 : 256
    const mnemonic = bip39.generateMnemonic(englishWordlist, strength)

    const wallet = new HDWallet(mnemonic, passphrase)
    return { wallet, mnemonic }
  }

  /**
   * Create HD wallet from existing mnemonic
   *
   * @param mnemonic - BIP-39 mnemonic phrase (12 or 24 words)
   * @param passphrase - Optional passphrase for additional security
   */
  static fromMnemonic(mnemonic: string, passphrase: string = ''): HDWallet {
    return new HDWallet(mnemonic, passphrase)
  }

  /**
   * Get the mnemonic phrase
   * WARNING: Handle with extreme care - this is the master secret
   */
  get mnemonic(): string {
    return this._mnemonic
  }

  /**
   * Derive an account at the specified path
   *
   * @param path - BIP-44 derivation path (e.g., "m/44'/60'/0'/0/0")
   * @returns Derived wallet
   */
  derivePath(path: string): Wallet {
    // Check cache
    const cached = this._accounts.get(path)
    if (cached) {
      return cached
    }

    // Derive child key
    const childKey = this._masterKey.derive(path)
    if (!childKey.privateKey) {
      throw new Error('Failed to derive private key')
    }

    // Create wallet from derived key
    const wallet = Wallet.fromPrivateKeyBytes(childKey.privateKey)

    // Cache the account
    this._accounts.set(path, wallet)

    return wallet
  }

  /**
   * Derive the default account (m/44'/60'/0'/0/0)
   */
  deriveDefault(): Wallet {
    return this.derivePath(DEFAULT_PATH)
  }

  /**
   * Derive account at specific index
   *
   * @param index - Account index (0, 1, 2, ...)
   * @returns Derived account with wallet and metadata
   */
  deriveAccount(index: number): DerivedAccount {
    const path = `m/44'/60'/0'/0/${index}`
    const wallet = this.derivePath(path)
    return { wallet, path, index }
  }

  /**
   * Derive multiple accounts
   *
   * @param count - Number of accounts to derive
   * @returns Array of derived accounts
   */
  deriveAccounts(count: number): DerivedAccount[] {
    const accounts: DerivedAccount[] = []
    for (let i = 0; i < count; i++) {
      accounts.push(this.deriveAccount(i))
    }
    return accounts
  }

  /**
   * Get all derived accounts
   */
  get accounts(): DerivedAccount[] {
    const result: DerivedAccount[] = []
    for (const [path, wallet] of this._accounts) {
      const match = path.match(/\/(\d+)$/)
      const index = match ? parseInt(match[1], 10) : -1
      result.push({ wallet, path, index })
    }
    return result.sort((a, b) => a.index - b.index)
  }

  /**
   * Create encrypted keystore from the default account
   *
   * @param password - Encryption password
   * @param options - Keystore options
   */
  toKeystore(password: string, options?: KeystoreOptions): EncryptedKeystore {
    const wallet = this.deriveDefault()
    return createKeystore(wallet, password, options)
  }

  /**
   * Create encrypted keystore from specific account
   *
   * @param index - Account index
   * @param password - Encryption password
   * @param options - Keystore options
   */
  accountToKeystore(
    index: number,
    password: string,
    options?: KeystoreOptions
  ): EncryptedKeystore {
    const { wallet } = this.deriveAccount(index)
    return createKeystore(wallet, password, options)
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a new mnemonic phrase
 *
 * @param wordCount - Number of words (12 or 24)
 * @returns Mnemonic phrase
 */
export function generateMnemonic(wordCount: 12 | 24 = 24): string {
  const strength = wordCount === 12 ? 128 : 256
  return bip39.generateMnemonic(englishWordlist, strength)
}

/**
 * Validate a mnemonic phrase
 *
 * @param mnemonic - Mnemonic phrase to validate
 * @returns true if valid BIP-39 mnemonic
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic, englishWordlist)
}

/**
 * Get the word list for BIP-39
 */
export function getWordlist(): string[] {
  return [...englishWordlist]
}

/**
 * Build a BIP-44 derivation path
 *
 * @param accountIndex - Account index
 * @param addressIndex - Address index
 * @param coinType - Coin type (default: 60 for Ethereum)
 */
export function buildPath(
  accountIndex: number = 0,
  addressIndex: number = 0,
  coinType: number = ETHEREUM_COIN_TYPE
): string {
  return `m/44'/${coinType}'/${accountIndex}'/0/${addressIndex}`
}
