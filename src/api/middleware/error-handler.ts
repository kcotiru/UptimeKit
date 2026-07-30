import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
    });
  }

  // Log unhandled errors
  if (req.log) {
    req.log.error(err, 'Unhandled error');
  } else {
    if (process.env.NODE_ENV === 'test') {
      console.error('Unhandled Error in test:', err);
    }
  }

  if (process.env.NODE_ENV === 'test') console.error(err);
  return res.status(500).json({
    status: 'error',
    message: 'Internal server error',
  });
};
