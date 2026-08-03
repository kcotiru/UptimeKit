import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { apiConfig } from './config/api-config';
import { errorHandler } from './middleware/error-handler';
import { requestIdMiddleware } from './middleware/request-id';
import { apiLimiter } from './middleware/rate-limiter';
import { NotFoundError } from './utils/errors';
import { authRoutes } from './routes/auth.routes';
import { monitorRoutes } from './routes/monitors.routes';
import { tenantContextMiddleware } from './middleware/tenant-context';

export function createServer() {
  const app = express();

  // Basic middleware
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  
  // Request ID
  app.use(requestIdMiddleware);

  // Logging
  app.use(
    pinoHttp({
      genReqId: (req) => (req.headers['x-request-id'] as string) || 'unknown',
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    })
  );

  // Rate Limiting (apply to all /api routes)
  if (process.env.NODE_ENV !== 'test') {
    app.use('/api', apiLimiter);
  }

  // Health check
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Auth Routes
  app.use('/api/auth', authRoutes);

  // Monitor Routes
  app.use('/api/monitors', monitorRoutes);

  // Catch-all for undefined routes
  app.use((req, res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.url} not found`));
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

if (require.main === module) {
  const app = createServer();
  app.listen(apiConfig.PORT, () => {
    console.log(`🚀 Server listening on port ${apiConfig.PORT}`);
  });
}
