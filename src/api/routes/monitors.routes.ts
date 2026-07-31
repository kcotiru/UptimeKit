import { Router } from 'express';
import { MonitorRepository } from '../repositories/monitor.repository';
import { SSRFValidator } from '../../shared/security/ssrf-validator';
import { createMonitorSchema, updateMonitorSchema, paginationSchema } from '../validators/monitor.validator';
import { ValidationError, BadRequestError, NotFoundError } from '../utils/errors';
import { authenticate } from '../middleware/auth';

const ssrfValidator = new SSRFValidator();

import { tenantContextMiddleware } from '../middleware/tenant-context';

const router = Router();

// All monitor routes require authentication and tenant context
router.use(authenticate);
router.use(tenantContextMiddleware);

router.post('/', async (req, res, next) => {
  try {
    const teamId = req.user!.teamId;
    const parsed = createMonitorSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Validation failed', parsed.error.errors);
    
    const ssrfResult = await ssrfValidator.validateUrl(parsed.data.url);
    if (!ssrfResult.isAllowed) throw new BadRequestError(`SSRF Validation failed: ${ssrfResult.reason}`);
    
    const monitor = await MonitorRepository.create(teamId, parsed.data);
    res.status(201).json({ data: monitor, status: 'success' });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user!.teamId;
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError('Pagination validation failed', parsed.error.errors);
    
    const monitors = await MonitorRepository.findAll(teamId, parsed.data.cursor, parsed.data.limit);
    res.json(monitors);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const teamId = req.user!.teamId;
    const monitor = await MonitorRepository.findById(teamId, req.params.id);
    if (!monitor) throw new NotFoundError('Monitor not found');
    res.json(monitor);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const teamId = req.user!.teamId;
    const parsed = updateMonitorSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Validation failed', parsed.error.errors);

    if (parsed.data.url) {
      const ssrfResult = await ssrfValidator.validateUrl(parsed.data.url);
      if (!ssrfResult.isAllowed) throw new BadRequestError(`SSRF Validation failed: ${ssrfResult.reason}`);
    }

    const exists = await MonitorRepository.findById(teamId, req.params.id);
    if (!exists) throw new NotFoundError('Monitor not found');

    const monitor = await MonitorRepository.update(teamId, req.params.id, parsed.data);
    res.json({ data: monitor, status: 'success' });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const teamId = req.user!.teamId;
    const deleted = await MonitorRepository.delete(teamId, req.params.id);
    if (!deleted) throw new NotFoundError('Monitor not found');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export const monitorRoutes = router;
