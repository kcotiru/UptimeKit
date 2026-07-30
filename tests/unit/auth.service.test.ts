import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AuthService } from '../../src/api/services/auth.service';
import { db } from '../../src/api/db';
import { UnauthorizedError } from '../../src/api/utils/errors';

vi.mock('bcrypt');
vi.mock('jsonwebtoken');
vi.mock('../../src/api/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

describe('AuthService', () => {
  const mockUser = {
    id: 'user-1',
    team_id: 'team-1',
    email: 'test@example.com',
    password_hash: 'hashed',
    role: 'admin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('should throw UnauthorizedError if user not found', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as any);
      
      await expect(AuthService.login('test@example.com', 'password')).rejects.toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError if password does not match', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockUser] } as any);
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as any);
      
      await expect(AuthService.login('test@example.com', 'wrong_pass')).rejects.toThrow(UnauthorizedError);
    });

    it('should generate tokens on successful login', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockUser] } as any);
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as any);
      vi.mocked(jwt.sign)
        .mockReturnValueOnce('mocked_access_token' as any)
        .mockReturnValueOnce('mocked_refresh_token' as any);
      
      const tokens = await AuthService.login('test@example.com', 'password');
      
      expect(tokens).toEqual({
        accessToken: 'mocked_access_token',
        refreshToken: 'mocked_refresh_token',
      });
      expect(jwt.sign).toHaveBeenCalledTimes(2);
    });
  });

  describe('refresh', () => {
    it('should generate new tokens from valid refresh token', () => {
      const payload = { userId: mockUser.id, teamId: mockUser.team_id, role: mockUser.role };
      vi.mocked(jwt.verify).mockReturnValueOnce(payload as any);
      vi.mocked(jwt.sign)
        .mockReturnValueOnce('new_access_token' as any)
        .mockReturnValueOnce('new_refresh_token' as any);
      
      const tokens = AuthService.refresh('valid_token');
      expect(tokens).toEqual({
        accessToken: 'new_access_token',
        refreshToken: 'new_refresh_token',
      });
    });

    it('should throw UnauthorizedError if refresh token is invalid', () => {
      vi.mocked(jwt.verify).mockImplementationOnce(() => { throw new Error('invalid'); });
      expect(() => AuthService.refresh('invalid_token')).toThrow(UnauthorizedError);
    });
  });
});
