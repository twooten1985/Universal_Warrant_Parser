/** Shared helpers for naming media inside a portable case. The ZIP itself is streamed by the server. */

export function portableMediaFileName(index: number, name: string): string {
  const leaf = (name || 'media').replace(/\\/g, '/').split('/').pop() || 'media';
  const safe = leaf.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 100) || 'media';
  return `${String(index + 1).padStart(5, '0')}_${safe}`;
}

export function redactIp(ip: string | undefined): string | undefined {
  if (!ip) return ip;
  const parts = ip.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.XXX.XXX`;
  if (ip.includes(':')) {
    const colons = ip.split(':');
    return `${colons.slice(0, 2).join(':')}:*:*:*`;
  }
  return ip;
}

export function redactPiiText(text: string | undefined): string | undefined {
  if (!text) return text;
  let result = text.replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, (_match, p1, p2) => {
    if (p1.length <= 2) return `*@${p2}`;
    return `${p1[0]}***${p1[p1.length - 1]}@${p2}`;
  });
  result = result.replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, (match) => {
    return match.replace(/\d(?=\d{4})/g, '*');
  });
  return result;
}
