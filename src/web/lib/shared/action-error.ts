import { ZodError } from 'zod';

export const GENERIC_ERROR = 'Something went wrong. Please try again.';

/** An Error whose message was written for the user. Anything else is treated as internal. */
export class UserError extends Error {}

/**
 * The one place an error becomes user-facing text. Passes through only what this
 * codebase authored for users (a ZodError's first issue, a UserError); everything
 * else, notably PostgREST text naming tables and constraints, is logged and replaced.
 */
export function toUserMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? GENERIC_ERROR;
  if (error instanceof UserError) return error.message;
  console.error('Action failed:', error);
  return GENERIC_ERROR;
}
