const API_BASE_URL = process.env.EXPRESS_INTERNAL_API_URL || 'http://localhost:3000';

/**
 * Executes an HTTP fetch request against the internal Express REST API with Bearer token header propagation.
 * @template T - Expected JSON response payload type
 * @param endpoint - Endpoint path starting with / (e.g. /api/v1/monitors)
 * @param options - Request options including optional JWT authentication token
 * @returns Parsed JSON response body
 * @throws Error if HTTP response status is not 20x
 */
export async function fetchApi<T>(
  endpoint: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, headers, ...restOptions } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string>),
  };

  if (token) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...restOptions,
    headers: requestHeaders,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || errorBody.message || `API request failed with status ${response.status}`);
  }

  return response.json();
}
