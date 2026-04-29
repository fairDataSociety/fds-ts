/**
 * HD Wallet management for Fairdrive
 *
 * BIP-39/44 compliant wallet for identity and encryption keys.
 * The wallet is the source of identity in the FDS ecosystem.
 */

import { HDNodeWallet, Mnemonic, Wallet as EthersWallet, keccak256, toUtf8Bytes } from 'ethers';

export interface Wallet {
  address: string;
  publicKey: string;
}

export interface WalletManagerConfig {
  // Future: hardware wallet support
}

// BIP-44 path for Fairdrive: m/44'/60'/0'/0/0
// Must match Go fds-id-go DefaultDerivationPath for cross-platform interoperability
const FAIRDRIVE_PATH = "m/44'/60'/0'/0/0";

export class WalletManager {
  private mnemonic?: string;
  private hdNode?: HDNodeWallet;
  private wallet?: Wallet;

  constructor(config?: WalletManagerConfig) {
    // Config reserved for future hardware wallet integration
  }

  /**
   * Create new HD wallet with random mnemonic
   */
  async create(): Promise<{ wallet: Wallet; mnemonic: string }> {
    // Generate random mnemonic (12 words)
    const randomWallet = EthersWallet.createRandom();
    const mnemonic = randomWallet.mnemonic!.phrase;

    // Derive HD node from mnemonic
    this.mnemonic = mnemonic;
    this.hdNode = HDNodeWallet.fromMnemonic(
      Mnemonic.fromPhrase(mnemonic),
      FAIRDRIVE_PATH
    );

    this.wallet = {
      address: this.hdNode.address,
      publicKey: this.hdNode.publicKey,
    };

    return {
      wallet: this.wallet,
      mnemonic,
    };
  }

  /**
   * Import wallet from mnemonic phrase
   */
  async import(mnemonic: string): Promise<Wallet> {
    // Validate mnemonic
    try {
      Mnemonic.fromPhrase(mnemonic);
    } catch (e) {
      throw new Error('Invalid mnemonic phrase');
    }

    this.mnemonic = mnemonic;
    this.hdNode = HDNodeWallet.fromMnemonic(
      Mnemonic.fromPhrase(mnemonic),
      FAIRDRIVE_PATH
    );

    this.wallet = {
      address: this.hdNode.address,
      publicKey: this.hdNode.publicKey,
    };

    return this.wallet;
  }

  /**
   * Export mnemonic (requires confirmation)
   */
  async export(): Promise<string> {
    if (!this.mnemonic) {
      throw new Error('No wallet loaded');
    }
    return this.mnemonic;
  }

  /**
   * Get current wallet
   */
  getWallet(): Wallet | undefined {
    return this.wallet;
  }

  /**
   * Get HD node for signing
   */
  getHDNode(): HDNodeWallet | undefined {
    return this.hdNode;
  }

  /**
   * Get the raw private key as hex string (without 0x prefix).
   * Used for Stamper construction and feed signing.
   *
   * @throws Error if no wallet is loaded
   */
  getPrivateKey(): string {
    if (!this.hdNode) {
      throw new Error('No wallet loaded');
    }
    return this.hdNode.privateKey.slice(2); // Strip 0x prefix
  }

  /**
   * Derive encryption key for pod
   * Uses deterministic derivation matching Go fds-id-go:
   *   keccak256(privateKeyHex + ":pod:" + podName)
   * where privateKeyHex is the 64-char hex private key (no 0x prefix)
   */
  async deriveKey(podName: string): Promise<Uint8Array> {
    if (!this.hdNode) {
      throw new Error('No wallet loaded');
    }

    // Use private key hex (strip 0x prefix) to match Go fds-id-go derivation
    const privKeyHex = this.hdNode.privateKey.slice(2);
    const derivationInput = `${privKeyHex}:pod:${podName}`;
    const hash = keccak256(toUtf8Bytes(derivationInput));

    // Return as Uint8Array (32 bytes)
    return new Uint8Array(Buffer.from(hash.slice(2), 'hex'));
  }

  /**
   * Derive child wallet at specific index
   * Useful for creating separate identities or pod-specific wallets
   */
  async deriveChild(index: number): Promise<Wallet> {
    if (!this.hdNode) {
      throw new Error('No wallet loaded');
    }

    const childNode = this.hdNode.deriveChild(index);
    return {
      address: childNode.address,
      publicKey: childNode.publicKey,
    };
  }

  /**
   * Sign a message with the wallet
   */
  async signMessage(message: string): Promise<string> {
    if (!this.hdNode) {
      throw new Error('No wallet loaded');
    }
    return this.hdNode.signMessage(message);
  }

  /**
   * Sign typed data (EIP-712)
   */
  async signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>
  ): Promise<string> {
    if (!this.hdNode) {
      throw new Error('No wallet loaded');
    }
    return this.hdNode.signTypedData(
      domain as any,
      types,
      value
    );
  }
}
