/**
 * Turn per-file parse results into one workspace result.
 * Event lists are appended with push(), never spread, so a large return
 * does not allocate a new copy of every record for every file.
 */

import type { ForensicEvent, ParseResult, ProviderType, UploadedFile } from '../types';
import { buildAccountKey } from '../identity';
import { buildParseResult, resolveMediaFile } from '../parserHelper';
import { appendEvents } from './casePersistence';

export interface ParsedFileInput {
  name: string;
  relativePath?: string;
  size: number;
  provider?: ProviderType;
  isMedia?: boolean;
  parse?: ParseResult | null;
}

export function assembleWorkspaceParse(
  files: ReadonlyArray<ParsedFileInput>,
  activeProvider: ProviderType,
  providerLabel: (provider: string) => string
): ParseResult | null {
  if (files.length === 0) return null;

  const combinedEvents: ForensicEvent[] = [];
  const extractedAccounts: Array<NonNullable<ParseResult['accounts']>[number]> = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileParse = file.parse;
    if (!fileParse) continue;
    const fileProvider = (file.provider || activeProvider) as ProviderType;
    appendEvents(combinedEvents, fileParse.events);

    if (!fileParse.accountInfo) continue;
    const provLabel = providerLabel(fileProvider) || fileProvider;
    const accKey = buildAccountKey(
      provLabel,
      fileParse.accountInfo.userId,
      fileParse.accountInfo.username,
      fileParse.accountInfo.email
    );
    const matchIdx = extractedAccounts.findIndex(a => {
      if ((a.provider || '').toLowerCase() !== provLabel.toLowerCase()) return false;
      const b = fileParse.accountInfo;
      if (!b) return false;
      if (fileProvider === 'google') {
        const aUid = a.userId?.toString().trim();
        const bUid = b.userId?.toString().trim();
        if (aUid && bUid) return aUid === bUid;
        const aEmail = a.email?.toLowerCase().trim();
        const bEmail = b.email?.toLowerCase().trim();
        if (aEmail && bEmail) return aEmail === bEmail;
        return false;
      }
      return (
        (a.userId && a.userId === b.userId) ||
        (a.username && b.username && a.username.toLowerCase() === b.username.toLowerCase()) ||
        (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase())
      );
    });
    if (matchIdx < 0) {
      extractedAccounts.push({
        ...fileParse.accountInfo,
        sourceFile: file.name,
        provider: provLabel,
        accountKey: accKey,
      });
    } else if (fileProvider === 'google') {
      const existing = extractedAccounts[matchIdx];
      const incoming = fileParse.accountInfo;
      const isEmpty = (v: unknown) => v === undefined || v === null || v === '';
      const fill = (cur: string | undefined, next: string | undefined): string | undefined =>
        isEmpty(cur) && !isEmpty(next) ? next : cur;
      existing.userId = fill(existing.userId, incoming.userId);
      existing.username = fill(existing.username, incoming.username);
      existing.displayName = fill(existing.displayName, incoming.displayName);
      existing.email = fill(existing.email, incoming.email);
      existing.phone = fill(existing.phone, incoming.phone);
      existing.createdDate = fill(existing.createdDate, incoming.createdDate);
      existing.registrationIp = fill(existing.registrationIp, incoming.registrationIp);
      if (incoming.otherDetails) {
        existing.otherDetails = existing.otherDetails || {};
        for (const [k, v] of Object.entries(incoming.otherDetails)) {
          const cur = existing.otherDetails[k];
          const next = String(v ?? '').trim();
          if ((cur === undefined || cur === null || cur === '') && next !== '') {
            existing.otherDetails[k] = next;
          }
        }
      }
    }
  }

  const extractedChanges: NonNullable<ParseResult['accountChanges']> = [];
  for (let idx = 0; idx < combinedEvents.length; idx++) {
    const evt = combinedEvents[idx];
    const contentLower = (evt.content || '').toLowerCase();
    const isProfile = evt.category === 'profile';
    const isSecurityOrProfileChange =
      contentLower.includes('password') ||
      contentLower.includes('email updated') ||
      contentLower.includes('phone updated') ||
      contentLower.includes('changed display name') ||
      contentLower.includes('account status') ||
      contentLower.includes('privacy settings') ||
      contentLower.includes('profile updated') ||
      contentLower.includes('avatar changed') ||
      contentLower.includes('username changed') ||
      contentLower.includes('name changed') ||
      contentLower.includes('security change') ||
      contentLower.includes('two-factor') ||
      contentLower.includes('2fa') ||
      contentLower.includes('registered') ||
      contentLower.includes('creation') ||
      contentLower.includes('logged') ||
      contentLower.includes('login') ||
      contentLower.includes('sign in');

    if (!isProfile && !isSecurityOrProfileChange) continue;

    let field = 'Profile / Status Update';
    let oldValue = 'N/A';
    let newValue = evt.content;
    if (contentLower.includes('password')) field = 'Security Password Update';
    else if (contentLower.includes('email')) field = 'Associated Email Address';
    else if (contentLower.includes('phone')) field = 'Associated Phone Number';
    else if (contentLower.includes('username')) field = 'Account Username';
    else if (contentLower.includes('display name') || contentLower.includes('alias')) field = 'Display Alias';
    else if (contentLower.includes('2fa') || contentLower.includes('two-factor')) field = 'Two-Factor Authentication';
    else if (contentLower.includes('avatar') || contentLower.includes('photo')) field = 'Profile Avatar';
    else if (contentLower.includes('registration') || contentLower.includes('created')) field = 'Account Creation';

    const changeMatch = evt.content.match(/changed (?:from|to) ["']?([^"']+)["']? (?:to|from) ["']?([^"']+)["']?/i);
    if (changeMatch) {
      oldValue = changeMatch[1];
      newValue = changeMatch[2];
    }
    extractedChanges.push({
      id: evt.id || `change-${idx}`,
      timestamp: evt.timestamp,
      field,
      oldValue,
      newValue,
      ipAddress: evt.ipAddress,
      source: evt.sourceFile,
      username: evt.sender || evt.targetAccount || 'Subject',
    });
  }

  const allFileNames: string[] = new Array(files.length);
  for (let i = 0; i < files.length; i++) allFileNames[i] = files[i].name;

  for (let i = 0; i < combinedEvents.length; i++) {
    const evt = combinedEvents[i];
    const mediaRef = evt.details?.mediaRef;
    if (!mediaRef) continue;
    const resolvedName = resolveMediaFile(String(mediaRef), allFileNames);
    if (!resolvedName) continue;
    combinedEvents[i] = {
      ...evt,
      details: { ...evt.details, resolvedMediaName: resolvedName },
    };
  }

  const displayAccountInfo = extractedAccounts.length === 1 ? extractedAccounts[0] : undefined;
  const result = buildParseResult(activeProvider, combinedEvents, displayAccountInfo);
  return {
    ...result,
    accounts: extractedAccounts,
    accountChanges: extractedChanges,
  };
}

/** Drop file bytes after the parse result exists. Media never keeps a data URL. */
export function filesWithoutRetainedBytes(files: UploadedFile[]): UploadedFile[] {
  const out: UploadedFile[] = new Array(files.length);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.content) out[i] = { ...f, content: '' };
    else out[i] = f;
  }
  return out;
}
