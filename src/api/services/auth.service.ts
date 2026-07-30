import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { apiConfig } from '../config/api-config';
import { UnauthorizedError } from '../utils/errors';

export interface User {
  id: string;
  team_id: string;
  email: string;
  password_hash: string;
  role: string;
}

export class AuthService {
  static async login(email: string, password: string) {
    const res = await db.query<User>('SELECT * FROM users WHERE email = $1', [email]);
    const user = res.rows[0];

    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    return this.generateTokens(user);
  }

  static generateTokens(user: Pick<User, 'id' | 'team_id' | 'role'>) {
    const payload = {
      userId: user.id,
      teamId: user.team_id,
      role: user.role
    };

    const accessToken = jwt.sign(payload, apiConfig.JWT_SECRET, {
      expiresIn: apiConfig.JWT_EXPIRY,
    });

    const refreshToken = jwt.sign(payload, apiConfig.JWT_SECRET, {
      expiresIn: apiConfig.JWT_REFRESH_EXPIRY,
    });

    return { accessToken, refreshToken };
  }

  static refresh(token: string) {
    try {
      const payload = jwt.verify(token, apiConfig.JWT_SECRET) as any;
      return this.generateTokens({
        id: payload.userId,
        team_id: payload.teamId,
        role: payload.role
      });
    } catch (err) {
      throw new UnauthorizedError('Invalid refresh token');
    }
  }
}
