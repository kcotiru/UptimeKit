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

/** A pinned, absolute time window on one monitor, shareable by token. */
export interface SavedView {
  /** Unique saved view identifier (UUID v4) */
  id: string;
  /** Owning team identifier */
  teamId: string;
  /** Monitor the window belongs to */
  monitorId: string;
  /** User who created this share link, or null if they've since left the team */
  creatorId: string | null;
  /** Display name given by the creator */
  name: string;
  /** ISO 8601 window start — absolute, never relative */
  from: string;
  /** ISO 8601 window end */
  to: string;
  /** 43-char base64url token embedded in the public URL */
  shareToken: string;
  /** ISO 8601 timestamp the link was killed, or null while live */
  revokedAt: string | null;
  /** ISO 8601 timestamp of creation */
  createdAt: string;
}

/** One point on a publicly shared chart. Carries no status code — rolled-up
 *  tiers have none, and the public page does not distinguish up from down. */
export interface SharedViewPoint {
  timestamp: string;
  responseTimeMs: number;
  p95Ms: number;
  sampleCount: number;
}

/** What an anonymous visitor gets. Note the absence of a URL field: the SQL
 *  function never returns monitors.url, so it cannot be rendered by mistake. */
export interface SharedView {
  viewName: string;
  monitorName: string;
  monitorStatus: MonitorStatus;
  from: string;
  to: string;
  /** Coarsest tier serving this window: 'raw' | 'hourly' | 'daily'. */
  sourceTier: string;
  points: SharedViewPoint[];
}
