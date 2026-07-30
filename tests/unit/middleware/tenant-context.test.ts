import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tenantContextMiddleware } from '../../../src/api/middleware/tenant-context';
import { UnauthorizedError } from '../../../src/api/utils/errors';

describe('Tenant Context Middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockReq = {};
    mockRes = {};
    mockNext = vi.fn();
  });

  it('should call next with UnauthorizedError if req.user is missing', async () => {
    await tenantContextMiddleware(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('should call next with UnauthorizedError if req.user.teamId is missing', async () => {
    mockReq.user = { userId: '1' };
    await tenantContextMiddleware(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('should call next without error if req.user.teamId is present', async () => {
    mockReq.user = { userId: '1', teamId: '2' };
    await tenantContextMiddleware(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(); // called with no args
  });
});
