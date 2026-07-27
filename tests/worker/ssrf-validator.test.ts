import { describe, it, expect } from 'vitest';
import { SSRFValidator } from '../../src/worker/security/ssrf-validator';

describe('SSRFValidator', () => {
  const validator = new SSRFValidator();

  it('blocks loopback IP 127.0.0.1', async () => {
    const result = await validator.validateUrl('http://127.0.0.1/health');
    expect(result.isAllowed).toBe(false);
    expect(result.reason).toContain('SSRF Violation');
  });

  it('blocks IPv6 loopback ::1', async () => {
    const result = await validator.validateUrl('http://[::1]/status');
    expect(result.isAllowed).toBe(false);
    expect(result.reason).toContain('SSRF Violation');
  });

  it('blocks private IPv4 ranges (10.0.0.1, 172.16.0.1, 192.168.1.1)', async () => {
    const r1 = await validator.validateUrl('http://10.0.0.1');
    const r2 = await validator.validateUrl('http://172.16.0.1');
    const r3 = await validator.validateUrl('http://192.168.1.1');

    expect(r1.isAllowed).toBe(false);
    expect(r2.isAllowed).toBe(false);
    expect(r3.isAllowed).toBe(false);
  });

  it('blocks AWS link-local metadata IP 169.254.169.254', async () => {
    const result = await validator.validateUrl('http://169.254.169.254/latest/meta-data/');
    expect(result.isAllowed).toBe(false);
    expect(result.reason).toContain('SSRF Violation');
  });

  it('blocks decimal and hex numeric IP representations', async () => {
    // 2130706433 is 127.0.0.1
    const r1 = await validator.validateUrl('http://2130706433');
    expect(r1.isAllowed).toBe(false);

    // 0x7f000001 is 127.0.0.1
    const r2 = await validator.validateUrl('http://0x7f000001');
    expect(r2.isAllowed).toBe(false);
  });

  it('allows public URLs like https://example.com', async () => {
    const result = await validator.validateUrl('https://example.com');
    expect(result.isAllowed).toBe(true);
    expect(result.resolvedIp).toBeDefined();
  });

  it('allows admin allowlisted private IP', async () => {
    const allowlistedValidator = new SSRFValidator(['127.0.0.1']);
    const result = await allowlistedValidator.validateUrl('http://127.0.0.1/metrics');
    expect(result.isAllowed).toBe(true);
  });

  it('rejects unsupported protocols like ftp or file', async () => {
    const r1 = await validator.validateUrl('file:///etc/passwd');
    expect(r1.isAllowed).toBe(false);
    expect(r1.reason).toContain('Forbidden scheme');
  });
});
