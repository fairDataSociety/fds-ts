/**
 * @fairdrive/core interfaces
 *
 * Abstract interfaces that don't depend on implementation.
 * Enables swapping between fairOS-dfs, custom adapters, or future implementations.
 */

// ============================================================================
// Types
// ============================================================================

export interface Pod {
  name: string;
  createdAt: Date;
  index?: number;
  /** True if this pod was received from another user */
  isShared?: boolean;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  contentType: string;
  createdAt: Date;
  modifiedAt: Date;
  reference?: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  contentType?: string;
}

export interface ShareReference {
  reference: string;
  type: 'file' | 'pod';
  createdAt: Date;
}

export interface SyncStatus {
  pod: string;
  lastSync?: Date;
  pendingChanges: number;
  status: 'idle' | 'syncing' | 'error';
  error?: string;
}

export interface SyncResult {
  success: boolean;
  uploaded: number;
  downloaded: number;
  conflicts: string[];
  error?: string;
}

export interface Change {
  type: 'create' | 'update' | 'delete';
  path: string;
  timestamp: Date;
}

export interface Wallet {
  address: string;
  mnemonic?: string;
  privateKey?: string;
}

// ============================================================================
// Configuration
// ============================================================================

export interface FairdriveConfig {
  /** Mode determines which features are available */
  mode: 'light' | 'hive' | 'cypherpunk';

  /** Bee node URL */
  beeUrl: string;

  /** Postage batch ID for uploads (required for write operations) */
  batchId?: string;

  /** ENS RPC URL for username resolution */
  ensRpcUrl?: string;

  /** FairOS-dfs server URL (optional, cypherpunk mode) */
  fairOsDfsUrl?: string;

  /** FUSE mount point (optional, cypherpunk mode) */
  fuseMountPoint?: string;
}

// ============================================================================
// Pod Manager Interface
// ============================================================================

export interface IPodManager {
  /**
   * Create a new pod
   * @param name Pod name
   */
  create(name: string): Promise<Pod>;

  /**
   * List all pods (owned and shared)
   */
  list(): Promise<Pod[]>;

  /**
   * Delete a pod
   * @param name Pod name
   */
  delete(name: string): Promise<void>;

  /**
   * Share a pod - returns a reference that can be shared with others
   * @param name Pod name
   * @param recipient Optional recipient address (not used by all adapters)
   */
  share(name: string, recipient?: string): Promise<ShareReference>;

  /**
   * Receive a shared pod
   * @param reference Share reference
   * @param options Optional receive options (e.g., rename pod)
   */
  receive(reference: string, options?: { name?: string }): Promise<Pod>;
}

// ============================================================================
// File Manager Interface
// ============================================================================

export interface IFileManager {
  /**
   * Upload a file to a pod
   * @param pod Pod name
   * @param path Path within pod (e.g., "/documents/file.txt")
   * @param content File content
   * @param contentType MIME type
   */
  upload(
    pod: string,
    path: string,
    content: Buffer | Uint8Array,
    contentType?: string
  ): Promise<FileInfo>;

  /**
   * Download a file from a pod
   * @param pod Pod name
   * @param path Path within pod
   */
  download(pod: string, path: string): Promise<Buffer>;

  /**
   * List files and directories at a path
   * @param pod Pod name
   * @param path Directory path
   */
  list(pod: string, path: string): Promise<DirectoryEntry[]>;

  /**
   * Create a directory
   * @param pod Pod name
   * @param path Directory path
   */
  mkdir(pod: string, path: string): Promise<void>;

  /**
   * Delete a file or directory
   * @param pod Pod name
   * @param path Path
   */
  delete(pod: string, path: string): Promise<void>;

  /**
   * Move/rename a file or directory
   * @param pod Pod name
   * @param oldPath Current path
   * @param newPath New path
   */
  move(pod: string, oldPath: string, newPath: string): Promise<void>;

  /**
   * Share a file
   * @param pod Pod name
   * @param path File path
   */
  share(pod: string, path: string): Promise<ShareReference>;

  /**
   * Receive a shared file
   * @param pod Pod name
   * @param path Destination path
   * @param reference Share reference
   */
  receive(pod: string, path: string, reference: string): Promise<FileInfo>;
}

// ============================================================================
// Wallet Manager Interface
// ============================================================================

export interface IWalletManager {
  /**
   * Create a new wallet with generated mnemonic
   */
  create(): Promise<Wallet>;

  /**
   * Import wallet from mnemonic
   * @param mnemonic 12-word seed phrase
   */
  import(mnemonic: string): Promise<Wallet>;

  /**
   * Export mnemonic (requires password/auth)
   */
  export(): Promise<string>;

  /**
   * Get wallet address
   */
  getAddress(): string;

  /**
   * Check if wallet is loaded
   */
  isConnected(): boolean;

  /**
   * Disconnect wallet
   */
  disconnect(): void;
}

// ============================================================================
// Sync Engine Interface (Desktop only)
// ============================================================================

export interface ISyncEngine {
  /**
   * Push local changes to Swarm
   * @param pod Pod name
   */
  push(pod: string): Promise<SyncResult>;

  /**
   * Pull remote changes from Swarm
   * @param pod Pod name
   */
  pull(pod: string): Promise<SyncResult>;

  /**
   * Get sync status
   * @param pod Pod name
   */
  status(pod: string): Promise<SyncStatus>;

  /**
   * Watch for local changes
   * @param pod Pod name
   * @param localPath Local directory path
   * @param callback Called when changes detected
   */
  watch(pod: string, localPath: string, callback: (changes: Change[]) => void): void;

  /**
   * Stop watching
   * @param pod Pod name
   */
  unwatch(pod: string): void;
}

// ============================================================================
// Unified Fairdrive Interface
// ============================================================================

export interface IFairdrive {
  readonly config: FairdriveConfig;
  readonly pods: IPodManager;
  readonly files: IFileManager;
  readonly wallet: IWalletManager;
  readonly sync?: ISyncEngine;

  /**
   * Initialize Fairdrive with user credentials
   * @param username ENS username (optional)
   * @param password Password for encryption
   */
  login(username: string, password: string): Promise<void>;

  /**
   * Create new account
   * @param username Desired ENS username
   * @param password Password
   */
  register(username: string, password: string): Promise<Wallet>;

  /**
   * Disconnect and clear state
   */
  logout(): void;

  /**
   * Check if logged in
   */
  isLoggedIn(): boolean;
}
