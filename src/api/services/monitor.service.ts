import { MonitorRepository, CreateMonitorDTO, UpdateMonitorDTO } from '../repositories/monitor.repository';
import { SSRFValidator } from '../../shared/security/ssrf-validator';
import { createMonitorSchema, updateMonitorSchema, paginationSchema } from '../validators/monitor.validator';
import { ValidationError, BadRequestError, NotFoundError } from '../utils/errors';

// Instantiate SSRF Validator. Should ideally use allowlist from config if needed.
const ssrfValidator = new SSRFValidator();

export class MonitorService {
  static async create(teamId: string, data: unknown) {
    const parsed = createMonitorSchema.safeParse(data);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors);
    }

    const { url } = parsed.data;
    const ssrfResult = await ssrfValidator.validateUrl(url);
    
    if (!ssrfResult.isAllowed) {
      throw new BadRequestError(`SSRF Validation failed: ${ssrfResult.reason}`);
    }

    return MonitorRepository.create(teamId, parsed.data);
  }

  static async findById(teamId: string, id: string) {
    const monitor = await MonitorRepository.findById(teamId, id);
    if (!monitor) {
      throw new NotFoundError('Monitor not found');
    }
    return monitor;
  }

  static async findAll(teamId: string, query: unknown) {
    const parsed = paginationSchema.safeParse(query);
    if (!parsed.success) {
      throw new ValidationError('Pagination validation failed', parsed.error.errors);
    }
    
    const { cursor, limit } = parsed.data;
    return MonitorRepository.findAll(teamId, cursor, limit);
  }

  static async update(teamId: string, id: string, data: unknown) {
    const parsed = updateMonitorSchema.safeParse(data);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors);
    }

    if (parsed.data.url) {
      const ssrfResult = await ssrfValidator.validateUrl(parsed.data.url);
      if (!ssrfResult.isAllowed) {
        throw new BadRequestError(`SSRF Validation failed: ${ssrfResult.reason}`);
      }
    }

    // Ensure monitor exists
    await this.findById(teamId, id);

    return MonitorRepository.update(teamId, id, parsed.data);
  }

  static async delete(teamId: string, id: string) {
    const deleted = await MonitorRepository.delete(teamId, id);
    if (!deleted) {
      throw new NotFoundError('Monitor not found');
    }
    return { success: true };
  }
}
