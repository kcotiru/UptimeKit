import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { apiConfig } from '../config/api-config';
import { UnauthorizedError } from '../utils/errors';

export interface AuthPayload {
  userId: string;
  teamId: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid authorization header');
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, apiConfig.JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch (err) {
    throw new UnauthorizedError('Invalid or expired token');
  }
};
