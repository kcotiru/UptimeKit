import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonitorService } from '../../src/api/services/monitor.service';
import { MonitorRepository } from '../../src/api/repositories/monitor.repository';
import { SSRFValidator } from '../../src/shared/security/ssrf-validator';

vi.mock('../../src/api/repositories/monitor.repository');
vi.mock('../../src/shared/security/ssrf-validator');

describe('MonitorService', () => {
  const teamId = 'team-1';

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock SSRF validation as allowed by default
    vi.mocked(SSRFValidator.prototype.validateUrl).mockResolvedValue({ isAllowed: true });
  });

  describe('create', () => {
    it('creates monitor when validation and SSRF pass', async () => {
      const payload = {
        name: 'Test',
        url: 'https://example.com',
        http_method: 'GET',
        expected_status: 200,
        check_interval: 60
      };

      vi.mocked(MonitorRepository.create).mockResolvedValue({ ...payload, id: '1', team_id: teamId } as any);

      const result = await MonitorService.create(teamId, payload);
      expect(result.id).toBe('1');
      expect(MonitorRepository.create).toHaveBeenCalledWith(teamId, payload);
    });

    it('throws error when SSRF fails', async () => {
      const payload = {
        name: 'Test',
        url: 'http://127.0.0.1',
        http_method: 'GET',
        expected_status: 200,
        check_interval: 60
      };

      vi.mocked(SSRFValidator.prototype.validateUrl).mockResolvedValue({ isAllowed: false, reason: 'Local IP' });

      await expect(MonitorService.create(teamId, payload)).rejects.toThrow('SSRF Validation failed: Local IP');
    });
  });
});
