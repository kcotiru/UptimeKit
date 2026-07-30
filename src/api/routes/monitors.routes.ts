import { Router } from 'express';
import { MonitorService } from '../services/monitor.service';
import { authenticate } from '../middleware/auth';

import { tenantContextMiddleware } from '../middleware/tenant-context';

const router = Router();

// All monitor routes require authentication and tenant context
router.use(authenticate);
router.use(tenantContextMiddleware);

router.post('/', async (req, res, next) => {
  try {
    const teamId = req.user!.teamId; 
    const monitor = await MonitorService.create(teamId, req.body);
    res.status(201).json({ data: monitor, status: 'success' });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user!.teamId;
    const monitors = await MonitorService.findAll(teamId, req.query);
    res.json(monitors);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const teamId = req.user!.teamId;
    const monitor = await MonitorService.findById(teamId, req.params.id);
    res.json(monitor);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const teamId = req.user!.teamId;
    const monitor = await MonitorService.update(teamId, req.params.id, req.body);
    res.json({ data: monitor, status: 'success' });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const teamId = req.user!.teamId;
    await MonitorService.delete(teamId, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export const monitorRoutes = router;
