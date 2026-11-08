export type DebugEventKind =
  | 'USER_ACTION'
  | 'API_REQ'
  | 'API_RES'
  | 'UI_MODAL'
  | 'UI_TOAST'
  | 'UI_TAB'
  | 'MONACO_NAV'
  | 'PLUGIN_CALL'
  | 'RUNTIME_ERROR';

export interface DebugEvent {
  id: string;
  corrId: string;
  ts: string;
  kind: DebugEventKind;
  category: 'ui' | 'network' | 'plugin' | 'editor' | 'system';
  label: string;
  target?: string;
  details?: Record<string, any>;
  durationMs?: number;
}
