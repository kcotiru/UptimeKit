import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Migration Reversibility Verification', () => {
  it('ensures every up migration script has a corresponding down migration script', () => {
    const upDir = path.join(__dirname, '../../db/migrations');
    const downDir = path.join(__dirname, '../../db/migrations/down');

    const upFiles = fs.readdirSync(upDir)
      .filter(f => f.endsWith('.sql') && !f.startsWith('down'));

    expect(upFiles.length).toBeGreaterThan(0);

    for (const upFile of upFiles) {
      const parts = upFile.split('_');
      const num = parts[0];
      const downFiles = fs.readdirSync(downDir).filter(f => f.startsWith(num));
      expect(downFiles.length, `Missing down migration for ${upFile}`).toBe(1);
    }
  });
});
