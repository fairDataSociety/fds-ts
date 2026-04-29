/**
 * Sync Production Configuration
 *
 * Defines configuration types and utilities for production sync deployments.
 * Supports local Bee nodes, public gateways, and custom endpoints.
 */

import { Bee } from '@ethersphere/bee-js';

// ============================================================================
// Environment Types
// ============================================================================

/**
 * Sync environment types
 */
export type SyncEnvironment = 'local' | 'gateway' | 'custom';

/**
 * Known public Swarm gateways
 */
export const PUBLIC_GATEWAYS = {
  /** Official Swarm gateway (read-only, rate-limited) */
  swarm: 'https://gateway.ethswarm.org',
  /** Swarmscan public gateway (read-only) */
  swarmscan: 'https://api.gateway.ethswarm.org',
} as const;

/**
 * Default local Bee endpoints
 */
export const LOCAL_ENDPOINTS = {
  /** Standard local Bee API */
  bee: 'http://localhost:1633',
  /** fdp-play queen node */
  fdpPlay: 'http://localhost:1633',
  /** Debug API (optional) */
  debug: 'http://localhost:1635',
} as const;

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Production sync configuration
 */
export interface ProductionConfig {
  /**
   * Primary Bee API endpoint
   * @example "http://localhost:1633" or "https://gateway.ethswarm.org"
   */
  beeUrl: string;

  /**
   * Postage batch ID for uploads
   * Required for push operations
   */
  postageBatchId?: string;

  /**
   * Postage stamp depth for client-side stamping via Stamper.
   * Required for StamperUploader. If not set, can be auto-detected
   * via bee.getPostageBatch(batchId).depth.
   */
  stampDepth?: number;

  /**
   * Owner address for feed reads
   * Required for pull operations
   */
  ownerAddress?: string;

  /**
   * Private key for feed writes (hex string with 0x prefix)
   * Required for push operations
   */
  privateKey?: string;

  /**
   * Fallback endpoints when primary fails
   * Tried in order
   */
  fallbackUrls?: string[];

  /**
   * Enable gateway mode (read-only, no uploads)
   * Automatically set when using public gateway
   */
  gatewayMode?: boolean;

  /**
   * Connection timeout in milliseconds
   * @default 30000
   */
  connectionTimeout?: number;

  /**
   * Request timeout in milliseconds
   * @default 60000
   */
  requestTimeout?: number;

  /**
   * Maximum retry attempts for failed operations
   * @default 3
   */
  maxRetries?: number;

  /**
   * Delay between retries in milliseconds (base for exponential backoff)
   * @default 1000
   */
  retryDelayMs?: number;

  /**
   * Sync interval for background sync in milliseconds
   * @default 60000
   */
  syncIntervalMs?: number;

  /**
   * ChunkManager chunk size in bytes
   * @default 4194304 (4MB)
   */
  chunkSize?: number;

  /**
   * ChunkManager upload concurrency
   * @default 4
   */
  uploadConcurrency?: number;

  /**
   * ChunkManager download concurrency
   * @default 4
   */
  downloadConcurrency?: number;
}

/**
 * Connection status result
 */
export interface ConnectionStatus {
  /** Whether the connection is working */
  connected: boolean;

  /** Detected environment type */
  environment: SyncEnvironment;

  /** Bee API version (if available) */
  version?: string;

  /** Whether uploads are possible */
  canUpload: boolean;

  /** Whether a valid postage batch exists */
  hasPostageBatch: boolean;

  /** Error message if connection failed */
  error?: string;

  /** Response time in milliseconds */
  latencyMs?: number;
}

/**
 * Configuration validation result
 */
export interface ValidationResult {
  /** Whether the configuration is valid */
  valid: boolean;

  /** Validation errors */
  errors: string[];

  /** Validation warnings (non-blocking) */
  warnings: string[];

  /** Suggested fixes */
  suggestions: string[];
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default production configuration values
 */
export const DEFAULT_CONFIG: Required<Omit<ProductionConfig, 'beeUrl' | 'postageBatchId' | 'ownerAddress' | 'privateKey' | 'fallbackUrls' | 'stampDepth'>> = {
  gatewayMode: false,
  connectionTimeout: 30000,
  requestTimeout: 60000,
  maxRetries: 3,
  retryDelayMs: 1000,
  syncIntervalMs: 60000,
  chunkSize: 4 * 1024 * 1024, // 4MB
  uploadConcurrency: 4,
  downloadConcurrency: 4,
};

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * Detect the sync environment from a Bee URL
 */
export function detectEnvironment(beeUrl: string): SyncEnvironment {
  const normalizedUrl = beeUrl.toLowerCase().trim();

  // Check for known public gateways
  for (const gateway of Object.values(PUBLIC_GATEWAYS)) {
    if (normalizedUrl.startsWith(gateway.toLowerCase())) {
      return 'gateway';
    }
  }

  // Check for localhost/local network
  if (
    normalizedUrl.includes('localhost') ||
    normalizedUrl.includes('127.0.0.1') ||
    normalizedUrl.includes('0.0.0.0') ||
    normalizedUrl.match(/192\.168\.\d+\.\d+/) ||
    normalizedUrl.match(/10\.\d+\.\d+\.\d+/) ||
    normalizedUrl.match(/172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+/)
  ) {
    return 'local';
  }

  return 'custom';
}

/**
 * Check if an environment supports uploads
 */
export function canUpload(environment: SyncEnvironment): boolean {
  // Public gateways are read-only
  return environment !== 'gateway';
}

// ============================================================================
// Connection Validation
// ============================================================================

/**
 * Validate a Bee connection and return status
 */
export async function validateBeeConnection(
  beeUrl: string,
  postageBatchId?: string
): Promise<ConnectionStatus> {
  const startTime = Date.now();
  const environment = detectEnvironment(beeUrl);

  try {
    const bee = new Bee(beeUrl);

    // Check basic connectivity
    await bee.checkConnection();

    const latencyMs = Date.now() - startTime;

    // Try to get postage batch info if we have one
    let hasPostageBatch = false;
    if (postageBatchId && environment !== 'gateway') {
      try {
        const batch = await bee.getPostageBatch(postageBatchId);
        hasPostageBatch = batch.usable;
      } catch {
        // Batch not found or invalid
      }
    }

    return {
      connected: true,
      environment,
      canUpload: canUpload(environment),
      hasPostageBatch,
      latencyMs,
    };
  } catch (error) {
    return {
      connected: false,
      environment,
      canUpload: false,
      hasPostageBatch: false,
      error: error instanceof Error ? error.message : 'Connection failed',
      latencyMs: Date.now() - startTime,
    };
  }
}

/**
 * Find first working endpoint from a list
 */
export async function findWorkingEndpoint(
  endpoints: string[],
  postageBatchId?: string
): Promise<{ url: string; status: ConnectionStatus } | null> {
  for (const url of endpoints) {
    const status = await validateBeeConnection(url, postageBatchId);
    if (status.connected) {
      return { url, status };
    }
  }
  return null;
}

// ============================================================================
// Configuration Validation
// ============================================================================

/**
 * Validate a production configuration
 */
export function validateConfig(config: ProductionConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Required: beeUrl
  if (!config.beeUrl) {
    errors.push('beeUrl is required');
  } else {
    try {
      new URL(config.beeUrl);
    } catch {
      errors.push(`Invalid beeUrl: ${config.beeUrl}`);
    }
  }

  const environment = config.beeUrl ? detectEnvironment(config.beeUrl) : 'custom';

  // Push requirements
  if (!config.postageBatchId) {
    if (environment !== 'gateway') {
      warnings.push('postageBatchId not set - push operations will fail');
    }
  } else if (config.postageBatchId.length !== 64) {
    errors.push('postageBatchId must be 64 hex characters');
  }

  // Feed requirements
  if (!config.ownerAddress) {
    warnings.push('ownerAddress not set - pull operations may fail');
  } else if (!config.ownerAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
    errors.push('ownerAddress must be a valid Ethereum address (0x + 40 hex chars)');
  }

  if (!config.privateKey) {
    if (environment !== 'gateway') {
      warnings.push('privateKey not set - push operations will fail');
    }
  } else if (!config.privateKey.match(/^0x[0-9a-fA-F]{64}$/)) {
    errors.push('privateKey must be a valid private key (0x + 64 hex chars)');
  }

  // Stamp depth validation
  if (config.stampDepth !== undefined) {
    if (config.stampDepth < 17 || config.stampDepth > 255) {
      errors.push('stampDepth must be between 17 and 255');
    }
  }

  // Gateway mode validation
  if (environment === 'gateway') {
    if (!config.gatewayMode) {
      suggestions.push('Consider setting gatewayMode: true when using a public gateway');
    }
    if (config.postageBatchId || config.privateKey) {
      warnings.push('Push credentials provided but using a read-only gateway');
    }
  }

  // Timeout validation
  if (config.connectionTimeout !== undefined && config.connectionTimeout < 1000) {
    warnings.push('connectionTimeout < 1000ms may cause false connection failures');
  }

  // Chunk size validation
  if (config.chunkSize !== undefined) {
    if (config.chunkSize < 64 * 1024) {
      warnings.push('chunkSize < 64KB may cause excessive chunk overhead');
    }
    if (config.chunkSize > 256 * 1024 * 1024) {
      warnings.push('chunkSize > 256MB may cause memory issues');
    }
  }

  // Fallback URL validation
  if (config.fallbackUrls) {
    for (const url of config.fallbackUrls) {
      try {
        new URL(url);
      } catch {
        errors.push(`Invalid fallback URL: ${url}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    suggestions,
  };
}

// ============================================================================
// Configuration Builder
// ============================================================================

/**
 * Create a production configuration with defaults
 */
export function createProductionConfig(
  overrides: Partial<ProductionConfig> & { beeUrl: string }
): ProductionConfig {
  const environment = detectEnvironment(overrides.beeUrl);

  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    gatewayMode: overrides.gatewayMode ?? (environment === 'gateway'),
  };
}

/**
 * Create a local development configuration
 */
export function createLocalConfig(overrides?: Partial<ProductionConfig>): ProductionConfig {
  return createProductionConfig({
    beeUrl: LOCAL_ENDPOINTS.bee,
    connectionTimeout: 10000, // Faster timeout for local
    ...overrides,
  });
}

/**
 * Create a gateway-only (read-only) configuration
 */
export function createGatewayConfig(
  gateway: keyof typeof PUBLIC_GATEWAYS = 'swarm',
  overrides?: Partial<ProductionConfig>
): ProductionConfig {
  return createProductionConfig({
    beeUrl: PUBLIC_GATEWAYS[gateway],
    gatewayMode: true,
    fallbackUrls: Object.values(PUBLIC_GATEWAYS).filter(
      (g) => g !== PUBLIC_GATEWAYS[gateway]
    ),
    ...overrides,
  });
}

// ============================================================================
// Exports
// ============================================================================

export type {
  ProductionConfig as SyncProductionConfig,
  ConnectionStatus as SyncConnectionStatus,
  ValidationResult as SyncValidationResult,
};
