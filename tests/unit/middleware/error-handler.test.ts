import { describe, it, expect, vi, beforeEach } from 'vitest';
import { errorHandler } from '../../../src/api/middleware/error-handler';
import { BadRequestError } from '../../../src/api/utils/errors';

describe('Error Handler Middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockReq = { log: { error: vi.fn() } };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    mockNext = vi.fn();
  });

  it('should handle AppError correctly', () => {
    const error = new BadRequestError('Invalid input');
    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      status: 'error',
      message: 'Invalid input',
    });
  });

  it('should handle unknown Error correctly', () => {
    const error = new Error('Unknown crash');
    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      status: 'error',
      message: 'Internal server error',
    });
    expect(mockReq.log.error).toHaveBeenCalledWith(error, 'Unhandled error');
  });
});
