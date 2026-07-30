/**
 * Result of SSRF validation.
 */
export interface SSRFValidationResult {
  isAllowed: boolean;
  resolvedIp?: string;
  reason?: string;
}
