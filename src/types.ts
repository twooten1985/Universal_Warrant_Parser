/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ProviderType = 'discord' | 'snapchat' | 'kik' | 'synchronos' | 'mega' | 'cybertip' | 'google' | 'twitter';

export interface ForensicEvent {
  id: string;
  timestamp: string; // ISO or standardized string
  category: 'message' | 'connection' | 'file' | 'profile' | 'call' | 'other';
  sender: string;
  recipient?: string;
  content: string;
  ipAddress?: string;
  location?: string;
  details?: Record<string, any>;
  sourceFile: string;
  /** Account identity this event belongs to (username, userId, or path-derived label) */
  targetAccount?: string;
  /** Stable account key: provider::uid::ID or provider::user::USERNAME */
  accountKey?: string;
}

/** One Discord login-history row. Times are UTC. `ip` may be the literal "Not found". */
export interface DiscordLoginActivity {
  ip: string;
  /** ISO-8601 UTC when the source time could be read. */
  timestampUtc?: string;
  /** Clock time labeled UTC, or the original text when it could not be read. */
  timestampLabel: string;
  source: 'history' | 'registration' | 'last-seen';
}

/** One row from reports/username_change.csv. `timestampRaw` keeps the recorded UTC offset. */
export interface DiscordUsernameChange {
  timestampRaw: string;
  timestampUtc?: string;
  oldUsername: string;
  oldDiscriminator: string;
  newUsername: string;
  newDiscriminator: string;
  oldDisplayName: string;
  newDisplayName: string;
  sourceFile?: string;
}

/**
 * One row from reports/message_transaction_records.
 * The device string is Discord-recorded client info, not verified hardware.
 */
export interface DiscordDeviceRecord {
  device: string;
  timestampRaw?: string;
  timestampUtc?: string;
  userId?: string;
  source: 'reports/message_transaction_records';
  sourceFile?: string;
}

/** Subscriber / account profile extracted from a warrant return (kept unmerged across accounts). */
export interface AccountRecord {
  userId?: string;
  username?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  createdDate?: string;
  registrationIp?: string;
  /** Last Seen IP from a Discord session file. May be the literal "Not found". */
  lastSeenIp?: string;
  loginActivity?: DiscordLoginActivity[];
  usernameHistory?: DiscordUsernameChange[];
  deviceRecords?: DiscordDeviceRecord[];
  otherDetails?: Record<string, string>;
  sourceFile?: string;
  provider?: string;
  /** Stable key used for chips, filters, and Phase 1 link suggestions */
  accountKey?: string;
}

export interface ParseResult {
  provider: ProviderType;
  events: ForensicEvent[];
  accountInfo?: AccountRecord;
  accounts?: AccountRecord[];
  accountChanges?: Array<{
    id: string;
    timestamp: string;
    field: string;
    oldValue: string;
    newValue: string;
    ipAddress?: string;
    source: string;
    username?: string;
  }>;
  summaryStats: {
    totalEvents: number;
    messagesCount: number;
    connectionsCount: number;
    filesCount: number;
    callsCount: number;
    uniqueIPs: string[];
    dateRange: { start: string; end: string } | null;
  };
  /** Discord channel.json records. Names are copied onto message rows when the ids agree. */
  discordChannels?: Array<{
    id: string;
    name?: string;
    type?: string;
    sourcePath: string;
  }>;
}

export interface UploadedFile {
  name: string;
  /** Raw text or a short display URL. Media bytes are not kept here. */
  content: string;
  size: number;
  isMedia?: boolean;
  mediaType?: 'image' | 'video';
  relativePath?: string;
  provider?: ProviderType;
  md5?: string;
  sha1?: string;
  sha256?: string;
  /** computed once the bytes were hashed; missing means this session already tried and could not. */
  digestStatus?: 'computed' | 'missing';
  /** True only after MD5, SHA-1, and SHA-256 were taken from the original bytes. */
  digestFromBytes?: boolean;
  digestNote?: string;
  isScreenshot?: boolean;
  skinTonePercent?: number;
  gps?: { lat: number; lng: number } | null;
  gpsAlt?: number | null;
  capturedAt?: string | null;
  device?: string | null;
  coordSource?: string | null;
  forensicsProcessed?: boolean;
  /** Absolute path of the original file. Read-only; never written. */
  sourcePath?: string;
  /** Original media could not be found. The case still opens. */
  mediaMissing?: boolean;
  /** Legacy save stored media bytes in SQLite; stream them one file at a time. */
  hasStoredBytes?: boolean;
}

export interface SampleSet {
  name: string;
  description: string;
  files: {
    name: string;
    content: string;
    type: 'json' | 'csv' | 'txt' | 'tsv';
  }[];
}

// Re-export Phase 1 identity types for convenience
export type {
  IdentifierType,
  IdentifierOccurrence,
  LinkEdge,
  LinkRuleId,
  LinkTier,
  LinkEdgeStatus,
} from './identity/types';
