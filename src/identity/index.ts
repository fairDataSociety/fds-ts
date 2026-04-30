/**
 * @fds/identity - FDS Identity Management
 *
 * Provides unified identity management for all FDS applications:
 * - Wallet management (create, sign, verify)
 * - Keystore encryption (Ethereum Web3 Secret Storage v3)
 * - HD wallet derivation (BIP-39/44)
 *
 * Keystores created with this library are compatible with:
 * - MetaMask
 * - Geth / go-ethereum
 * - Other Ethereum wallets supporting Web3 Secret Storage v3
 *
 * Example usage:
 * ```typescript
 * import { Wallet, createKeystore, decryptKeystore } from '@fds/identity'
 *
 * // Create a new wallet
 * const wallet = Wallet.generate()
 *
 * // Encrypt to keystore
 * const keystore = createKeystore(wallet, 'mypassword')
 *
 * // Later, decrypt the keystore
 * const decrypted = decryptKeystore(keystore, 'mypassword')
 * ```
 *
 * HD Wallet example:
 * ```typescript
 * import { HDWallet } from '@fds/identity'
 *
 * // Generate new HD wallet
 * const { wallet, mnemonic } = HDWallet.generate()
 *
 * // Derive accounts
 * const account0 = wallet.deriveAccount(0)
 * const account1 = wallet.deriveAccount(1)
 * ```
 */

// Wallet
export { Wallet, recoverAddress, isValidAddress } from './wallet.js'

// Keystore
export {
  createKeystore,
  decryptKeystore,
  serializeKeystore,
  parseKeystore,
  isValidKeystoreJSON,
  type EncryptedKeystore,
  type KeystoreOptions,
} from './keystore.js'

// HD Wallet
export {
  HDWallet,
  generateMnemonic,
  validateMnemonic,
  getWordlist,
  buildPath,
  DEFAULT_PATH,
  ETHEREUM_COIN_TYPE,
  type HDWalletOptions,
  type DerivedAccount,
} from './hdwallet.js'
