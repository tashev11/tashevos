export type Health = "ok" | "warn" | "fail";

export interface AgentDetection {
  id: string;
  name: string;
  detected: boolean;
  evidence: string[];
  historySources: string[];
}

export interface ProjectScan {
  root: string;
  technologies: string[];
  packageManager?: string;
}

export interface GitSnapshot {
  branch: string;
  head: string;
  dirty: boolean;
  changedFiles: number;
}

export interface DoctorCheck {
  id: string;
  label: string;
  health: Health;
  detail: string;
}

export interface EventRecord {
  id: string;
  ts: string;
  type: string;
  agent?: string;
  data?: Record<string, unknown>;
}
