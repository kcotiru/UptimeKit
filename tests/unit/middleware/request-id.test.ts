import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestIdMiddleware } from '../../../src/api/middleware/request-id';

describe('Request ID Middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockReq = { headers: {} };
    mockRes = { setHeader: vi.fn() };
    mockNext = vi.fn();
  });

  it('should generate a new request ID if none provided', () => {
    requestIdMiddleware(mockReq, mockRes, mockNext);
    expect(mockReq.headers['x-request-id']).toBeDefined();
    expect(mockRes.setHeader).toHaveBeenCalledWith('x-request-id', mockReq.headers['x-request-id']);
    expect(mockNext).toHaveBeenCalledOnce();
  });

  it('should use provided request ID', () => {
    mockReq.headers['x-request-id'] = 'custom-id';
    requestIdMiddleware(mockReq, mockRes, mockNext);
    expect(mockReq.headers['x-request-id']).toBe('custom-id');
    expect(mockRes.setHeader).toHaveBeenCalledWith('x-request-id', 'custom-id');
    expect(mockNext).toHaveBeenCalledOnce();
  });
});
