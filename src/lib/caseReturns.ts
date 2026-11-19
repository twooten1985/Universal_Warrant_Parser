/**
 * One imported warrant return inside a case.
 * The source zip or folder is never modified. Removing a return drops parsed rows only.
 */
import type { ProviderType } from '../types';
import { googleFolderFromPath } from './googleFolders';

export const RETURN_ROLES = ['unassigned', 'suspect', 'victim', 'witness', 'other'] as const;
export type ReturnRole = (typeof RETURN_ROLES)[number];

export interface CaseReturn {
  id: string;
  name: string;
  provider: ProviderType;
  subjectName: string;
  role: ReturnRole;
  sourceName: string;
  sourceSha256?: string;
  importedAt: string;
  accountId?: string;
  fileCount: number;
  eventCount: number;
  mediaCount: number;
}

export function isReturnRole(value: unknown): value is ReturnRole {
  return RETURN_ROLES.includes(value as ReturnRole);
}

export function returnRoleLabel(role: ReturnRole | string | undefined): string {
  switch (role) {
    case 'suspect': return 'Suspect';
    case 'victim': return 'Victim';
    case 'witness': return 'Witness';
    case 'other': return 'Other';
    default: return 'Unassigned';
  }
}

export function newReturnId(): string {
  return `ret-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Account label an examiner can recognize. Synthetic and real shapes both use the folder or a username column. */
export function accountIdFromPaths(provider: string, paths: readonly string[]): string {
  if (provider === 'google') {
    for (let i = 0; i < paths.length; i++) {
      const folder = googleFolderFromPath(paths[i]);
      if (!folder) continue;
      if (folder.email && folder.gaiaId) return `${folder.email} / ${folder.gaiaId}`;
      if (folder.email) return folder.email;
      if (folder.gaiaId) return folder.gaiaId;
    }
  }
  const blob = paths.join('\n');
  if (provider === 'snapchat') {
    const named = blob.match(/(?:^|[/\\])(?:user[_-]?profile|account)[^/\\]*[/\\]([A-Za-z0-9._-]{3,32})/i);
    if (named) return named[1];
    const user = blob.match(/\busername["'\s:=]+([A-Za-z0-9._-]{3,32})/i);
    if (user) return user[1];
  }
  if (provider === 'discord') {
    const id = blob.match(/\b(\d{17,20})\b/);
    if (id) return id[1];
  }
  if (provider === 'kik') {
    const user = blob.match(/subscriber-data-([A-Za-z0-9._-]{3,32})/i);
    if (user) return user[1];
  }
  return '';
}
