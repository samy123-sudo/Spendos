import type { AppState, Settings } from "./types";

export type Notify = (message: string, isError?: boolean) => void;
export type GoTo = (tab: string) => void;

export interface PageProps {
  state: AppState;
  refresh: () => Promise<void>;
  saveSettings: (patch: Record<string, unknown>) => Promise<Settings | void>;
  notify: Notify;
  goTo: GoTo;
  onLock: () => Promise<void>;
}
