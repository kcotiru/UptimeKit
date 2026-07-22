export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface Team {
  id: string;
  name: string;
  createdAt: Date;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  role: string;
}

export type MonitorType = 'HTTP' | 'TCP' | 'KEYWORD' | 'SSL';

export interface Monitor {
  id: string;
  teamId: string;
  name: string;
  url: string;
  type: MonitorType;
  intervalSec: number;
  expectedStatusCode?: number;
  isActive: boolean;
  createdAt: Date;
}

export interface PingLog {
  time: Date;
  monitorId: string;
  statusCode: number | null;
  responseMs: number | null;
  isUp: boolean;
  errorMessage: string | null;
}

export interface HourlyMonitorStat {
  bucket: Date;
  monitorId: string;
  avgResponseMs: number | null;
  minResponseMs: number | null;
  maxResponseMs: number | null;
  uptimePercentage: number | null;
}

export type IncidentStatus = 'ONGOING' | 'RESOLVED';

export interface Incident {
  id: string;
  monitorId: string;
  startedAt: Date;
  resolvedAt: Date | null;
  cause: string | null;
  status: IncidentStatus;
}

export type AlertChannelType = 'DISCORD' | 'SLACK' | 'EMAIL' | 'WEBHOOK';

export interface AlertChannel {
  id: string;
  teamId: string;
  type: AlertChannelType;
  config: Record<string, any>;
  isEnabled: boolean;
  createdAt: Date;
}
