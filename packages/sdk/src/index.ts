export type AdapterCapability =
  | "detect"
  | "instructions"
  | "mcp"
  | "hooks"
  | "sessions"
  | "handoff"
  | "worktrees";

export interface AdapterHealth {
  ok: boolean;
  messages: string[];
}

export interface AgentAdapter {
  id: string;
  name: string;
  detect(projectRoot: string): Promise<boolean>;
  capabilities(): AdapterCapability[];
  install?(projectRoot: string): Promise<void>;
  healthcheck?(projectRoot: string): Promise<AdapterHealth>;
}
