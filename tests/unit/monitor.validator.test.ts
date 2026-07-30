import { describe, it, expect } from 'vitest';
import { createMonitorSchema, updateMonitorSchema, paginationSchema } from '../../src/api/validators/monitor.validator';

describe('Monitor Validators', () => {
  describe('createMonitorSchema', () => {
    it('validates a correct payload', () => {
      const data = {
        name: 'Test Monitor',
        url: 'https://example.com',
        http_method: 'GET',
        expected_status: 200,
        check_interval: 60
      };
      
      const result = createMonitorSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('rejects invalid urls', () => {
      const data = {
        name: 'Test Monitor',
        url: 'ftp://example.com',
        http_method: 'GET',
        expected_status: 200,
        check_interval: 60
      };
      
      const result = createMonitorSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects short interval', () => {
      const data = {
        name: 'Test',
        url: 'http://example.com',
        http_method: 'GET',
        expected_status: 200,
        check_interval: 10
      };
      
      const result = createMonitorSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });
});
