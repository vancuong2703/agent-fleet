import { randomBytes } from 'node:crypto';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Random id: `p-`/`t-` + 4 base36 chars, `r-` + 6 base36 chars.
 */
export function newId(prefix: 'p' | 't' | 'r'): string {
  const length = prefix === 'r' ? 6 : 4;
  const bytes = randomBytes(length);
  let suffix = '';
  for (let i = 0; i < length; i += 1) {
    suffix += BASE36[bytes[i]! % BASE36.length];
  }
  return `${prefix}-${suffix}`;
}

/**
 * Human-readable slug: Vietnamese diacritics stripped, only [a-z0-9-], max 40.
 */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}
