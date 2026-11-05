/**
 * Discord .xlsx reports. A file that is only CSV with an Excel extension is not a workbook.
 */

import type { ParseResult, ProviderType } from '../types';
import { buildParseResult } from '../parserHelper';
import { accountFromDevices, deviceEventsFor, devicesFromGrid } from './discordReports';
import { readXlsxSheets } from './xlsxRows';

export async function parseDiscordWorkbook(
  provider: ProviderType,
  fileName: string,
  bytes: Uint8Array,
  relativePath?: string
): Promise<ParseResult> {
  const empty = buildParseResult(provider, [], undefined);
  if (provider !== 'discord') return empty;
  const sheets = await readXlsxSheets(bytes);
  if (!sheets) return empty;
  const sheet = sheets.find(item => item.rows.some(row => row.some(cell => cell.trim()))) || sheets[0];
  if (!sheet) return empty;
  const devices = devicesFromGrid(sheet.rows, fileName, relativePath);
  if (!devices.length) return empty;
  const account = accountFromDevices(devices, fileName);
  return buildParseResult(provider, deviceEventsFor(devices, fileName), account);
}
