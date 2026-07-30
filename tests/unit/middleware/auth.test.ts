import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticate } from '../../../src/api/middleware/auth';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../../../src/api/utils/errors';
import { apiConfig } from '../../../src/api/config/api-config';

vi.mock('jsonwebtoken');

describe('Auth Middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockReq = { headers: {} };
    mockRes = {};
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  it('should throw UnauthorizedError if no authorization header', () => {
    expect(() => authenticate(mockReq, mockRes, mockNext)).toThrow(UnauthorizedError);
  });

  it('should throw UnauthorizedError if authorization header does not start with Bearer', () => {
    mockReq.headers.authorization = 'Basic xyz';
    expect(() => authenticate(mockReq, mockRes, mockNext)).toThrow(UnauthorizedError);
  });

  it('should throw UnauthorizedError if token is invalid', () => {
    mockReq.headers.authorization = 'Bearer invalid_token';
    vi.mocked(jwt.verify).mockImplementationOnce(() => { throw new Error('invalid'); });
    expect(() => authenticate(mockReq, mockRes, mockNext)).toThrow(UnauthorizedError);
  });

  it('should call next and set req.user if token is valid', () => {
    mockReq.headers.authorization = 'Bearer valid_token';
    const payload = { userId: '1', teamId: '2', role: 'admin' };
    vi.mocked(jwt.verify).mockReturnValueOnce(payload as any);

    authenticate(mockReq, mockRes, mockNext);

    expect(jwt.verify).toHaveBeenCalledWith('valid_token', apiConfig.JWT_SECRET);
    expect(mockReq.user).toEqual(payload);
    expect(mockNext).toHaveBeenCalledOnce();
  });
});
