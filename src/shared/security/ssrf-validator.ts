import ipaddr from 'ipaddr.js';
import dns from 'dns/promises';
import net from 'net';
import { URL } from 'url';
import { SSRFValidationResult } from './types';

export interface ISSRFValidator {
  validateUrl(url: string, allowlist?: string[]): Promise<SSRFValidationResult>;
}

export class SSRFValidator implements ISSRFValidator {
  private defaultAllowlist: string[];

  constructor(allowlist: string[] = []) {
    this.defaultAllowlist = allowlist;
  }

  /**
   * Validates target URL against SSRF security policies.
   */
  async validateUrl(url: string, allowlist?: string[]): Promise<SSRFValidationResult> {
    const activeAllowlist = allowlist || this.defaultAllowlist;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { isAllowed: false, reason: 'Invalid URL format' };
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { isAllowed: false, reason: `Forbidden scheme: ${parsedUrl.protocol}` };
    }

    const hostname = parsedUrl.hostname;

    // Handle decimal/hex IP representations (e.g., 2130706433 or 0x7f000001)
    const normalizedHost = this.normalizeNumericHost(hostname) || hostname;

    const ips: string[] = [];

    if (net.isIP(normalizedHost)) {
      ips.push(normalizedHost);
    } else {
      try {
        const records = await dns.lookup(normalizedHost, { all: true });
        for (const rec of records) {
          ips.push(rec.address);
        }
      } catch (err: unknown) {
        const error = err as Error;
        return { isAllowed: false, reason: `DNS lookup failed: ${error.message}` };
      }
    }

    if (ips.length === 0) {
      return { isAllowed: false, reason: 'DNS lookup returned no IP addresses' };
    }

    for (const ipStr of ips) {
      if (activeAllowlist.includes(ipStr) || activeAllowlist.includes(hostname)) {
        continue;
      }

      let addr: ipaddr.IPv4 | ipaddr.IPv6;
      try {
        addr = ipaddr.parse(ipStr);
      } catch {
        return { isAllowed: false, resolvedIp: ipStr, reason: `Invalid IP address format: ${ipStr}` };
      }

      const range = addr.range();
      const forbiddenRanges = [
        'loopback',
        'private',
        'linkLocal',
        'carrierGradeNat',
        'broadcast',
        'multicast',
        'unspecified',
        'reserved',
        'uniqueLocal',
      ];

      if (forbiddenRanges.includes(range)) {
        return {
          isAllowed: false,
          resolvedIp: ipStr,
          reason: `SSRF Violation: IP ${ipStr} is in restricted range (${range})`,
        };
      }
    }

    return {
      isAllowed: true,
      resolvedIp: ips[0],
    };
  }

  /**
   * Normalizes numeric/hex IPv4 host representation (e.g. 2130706433 or 0x7f000001) to standard IPv4.
   */
  private normalizeNumericHost(host: string): string | null {
    // Single number / hex
    if (/^(0x[0-9a-fA-F]+|\d+)$/.test(host)) {
      const num = parseInt(host, host.startsWith('0x') || host.startsWith('0X') ? 16 : 10);
      if (num >= 0 && num <= 0xffffffff) {
        const p1 = (num >>> 24) & 0xff;
        const p2 = (num >>> 16) & 0xff;
        const p3 = (num >>> 8) & 0xff;
        const p4 = num & 0xff;
        return `${p1}.${p2}.${p3}.${p4}`;
      }
    }
    return null;
  }
}
