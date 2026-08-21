/**
 * Health check status of a monitored HTTP endpoint.
 */
export type MonitorStatus = 'up' | 'down' | 'degraded' | 'unknown';

/**
 * Authenticated user profile information.
 */
export interface User {
  /** Unique user identifier (UUID v4) */
  id: string;
  /** User email address */
  email: string;
  /** Active team identifier */
  teamId: string;
}

/**
 * Active client session state.
 */
export interface AuthSession {
  /** User details if logged in */
  user: User | null;
  /** Authentication status indicator */
  isAuthenticated: boolean;
}

/**
 * HTTP health monitor target entity.
 */
export interface Monitor {
  /** Unique monitor identifier (UUID v4) */
  id: string;
  /** Owning team identifier */
  teamId: string;
  /** Display name of the monitor */
  name: string;
  /** Target HTTP/HTTPS endpoint URL */
  url: string;
  /** Interval between health pings in seconds */
  intervalSeconds: number;
  /** Maximum ping timeout in milliseconds */
  timeoutMs: number;
  /** Current operational status */
  status: MonitorStatus;
  /** ISO 8601 timestamp of last ping check */
  lastCheckedAt: string | null;
  /** ISO 8601 timestamp of monitor creation */
  createdAt: string;
}

/**
 * Single time-series ping performance metric entry.
 */
export interface PingMetric {
  /** ISO 8601 timestamp of ping measurement */
  timestamp: string;
  /** Response time in milliseconds */
  responseTimeMs: number;
  /** Returned HTTP status code (e.g. 200, 500, or null) */
  statusCode: number | null;
  /** Operational success status */
  isUp: boolean;
}

/**
 * Time-series metrics payload for a monitor.
 */
export interface MonitorMetricsResponse {
  /** Monitor identifier */
  monitorId: string;
  /** Array of metric records */
  metrics: PingMetric[];
}

/**
 * Input payload for creating a new HTTP monitor.
 */
export interface CreateMonitorInput {
  /** Display name for the monitor */
  name: string;
  /** Target public HTTP/HTTPS URL */
  url: string;
  /** Optional ping check interval in seconds */
  intervalSeconds?: number;
  /** Optional timeout limit in milliseconds */
  timeoutMs?: number;
}

/** Notification target providers, matching the team_webhooks CHECK constraint. */
export type WebhookProvider = 'slack' | 'discord' | 'generic';

/**
 * Team-scoped webhook the worker posts incident notifications to.
 */
export interface TeamWebhook {
  /** Unique webhook identifier (UUID v4) */
  id: string;
  /** Owning team identifier */
  teamId: string;
  /** Payload format used when posting */
  provider: WebhookProvider;
  /** Destination URL */
  url: string;
  /** ISO 8601 timestamp of creation */
  createdAt: string;
}

/** Selectable window for the metrics chart. Lives here, not in the picker
 *  component, so shared code never imports from components/. */
export type TimeRangePreset = '1h' | '24h' | '7d' | '30d' | 'custom';

/** Uniform result shape returned by every Server Action. Actions return
 *  failures rather than throwing, so client components can render the
 *  message without a try/catch around every call. */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };
