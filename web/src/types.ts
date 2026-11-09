import { Language } from './utils/i18n';

export interface Settings {
  appTitle: string;
  baseColor: string;
  accentColor: string;
  themeMode: 'dark' | 'light';
  language: Language;
  hasCustomIcon: boolean;
  iconMime?: string;
  authEnabled: boolean;
  authUser: string;
  authPass?: string;
  apiEnabled: boolean;
  apiKey?: string;
  pluginExecUnrestricted?: boolean;
  structureGuardEnabled?: boolean;
  criticalPatterns?: string[];
  bottomDockMode?: 'auto' | 'always' | 'hidden';
}

export interface LanguagePackDef {
  code: string;
  name: string;
  flag?: string;
  translations?: Record<string, string>;
}

export interface PluginSettingField {
  id: string;
  label: string;
  type: 'boolean' | 'string' | 'number' | 'select';
  default?: any;
  options?: Array<{ label: string; value: any }> | string[];
  description?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  icon?: string;
  entry: string;
  css?: string;
  permissions?: string[];
  fileMatches?: string[];
  minAppVersion?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  providesServices?: string[];
  locales?: Record<string, Record<string, string>>;
  localization?: LanguagePackDef;
  settings?: PluginSettingField[];
}

export interface PluginItem extends PluginManifest {
  enabled: boolean;
  dir: string;
  installedAt: string;
  builtin?: boolean;
  dependents?: string[];
}

export interface DependencyIssue {
  pluginId: string;
  required: string;
  installed?: string;
  status: 'missing' | 'incompatible' | 'disabled';
  optional?: boolean;
}

export interface PendingInstall {
  tempKey: string;
  manifest: PluginManifest;
  isOfficial: boolean;
  dependencyIssues?: DependencyIssue[];
  createdAt: string;
}

export interface ProcessInfo {
  id: string;
  pluginId: string;
  command: string;
  args: string[];
  pid: number;
  port?: number;
  startedAt: string;
  status: 'running' | 'stopped' | 'failed';
}

export interface SplitPanelDef {
  id: string;
  pluginId: string;
  title: string;
  open: boolean;
  render: (container: HTMLElement) => void;
}

export interface SplitActionOption {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  isDefault?: boolean;
  onClick?: () => void;
}

export interface ToolbarButtonDef {
  id: string;
  pluginId: string;
  label: string;
  title?: string;
  icon?: string;
  shortcut?: string;
  fileMatches?: string[];
  options?: SplitActionOption[];
  activeOptionId?: string;
  visible?: (file?: OpenFile | null) => boolean;
  onSelectOption?: (optionId: string) => void;
  onClick: (selectedOptionId?: string) => void;
}

export interface HeaderItemDef {
  id: string;
  pluginId: string;
  order?: number;
  render: (container: HTMLElement) => void;
}

export interface WorkspaceRoot {
  id: string;
  name: string;
  path: string;
  readOnly: boolean;
  icon?: string;
  order?: number;
  server?: string;
}

export interface FileItem {
  name: string;
  path: string;
  root?: string;
  fullRelPath?: string;
  isDir: boolean;
  size: number;
  modTime: string;
  createdAt?: string;
  extension: string;
}

export interface FileInfo {
  path: string;
  root?: string;
  fullRelPath?: string;
  name: string;
  readOnly?: boolean;
  size: number;
  lineCount: number;
  charCount: number;
  sha256: string;
  modifiedAt?: string;
  createdAt?: string;
}

export type OutlineNodeType =
  | 'object'
  | 'list'
  | 'string'
  | 'number'
  | 'boolean'
  | 'section'
  | 'router'
  | 'service'
  | 'middleware'
  | 'function'
  | 'class';

export interface OutlineNode {
  id: string;
  label: string;
  type: OutlineNodeType;
  line: number;
  value?: string;
  children?: OutlineNode[];
}

export interface FileRevision {
  id: string;
  timestamp: Date | string;
  content: string;
  linesCount: number;
  linesDelta: number;
}

export interface OpenFileOptions {
  line?: number;
  column?: number;
  highlight?: boolean;
}

export interface OpenFile {
  path: string;
  root?: string;
  fullRelPath?: string;
  name: string;
  content: string;
  initialContent: string;
  isDirty: boolean;
  readOnly?: boolean;
  language: string;
  revisions: FileRevision[];
  badge?: string;
  onCustomSave?: (content: string) => Promise<void>;
}

export type AuditSeverity = 'info' | 'warn' | 'critical' | 'error';
export type AuditCategory = 'user' | 'system' | 'error' | 'plugin' | 'network';

export interface AuditEvent {
  id: string;
  timestamp: string;
  user: string;
  ip: string;
  category?: AuditCategory;
  source?: 'user' | 'backend' | 'frontend' | 'plugin';
  sourceId?: string;
  action: string;
  severity: AuditSeverity;
  target: string;
  details?: Record<string, any>;
}

export interface AuditQueryResponse {
  events: AuditEvent[];
  total: number;
}

export type GuardSeverity = 'critical' | 'warning' | 'info';

export interface GuardIssue {
  file: string;
  severity: GuardSeverity;
  line: number;
  column: number;
  message: string;
  snippet?: string;
  rule: string;
}

export interface GuardValidationResult {
  valid: boolean;
  isGuarded: boolean;
  issues: GuardIssue[];
}

export interface PluginSource {
  id: string;
  name: string;
  url: string;
  official: boolean;
  enabled: boolean;
  lastSync?: string;
  pluginsCount: number;
}

export interface CatalogItem {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license?: string;
  homepage?: string;
  downloadUrl: string;
  sourceId: string;
  official: boolean;
  installed: boolean;
  enabled: boolean;
  icon?: string;
  tags?: string[];
  locales?: Record<string, { name?: string; description?: string }>;
}

export interface StudioProfile {
  $schema?: string;
  version: string;
  exportedAt: string;
  app: {
    appTitle: string;
    baseColor: string;
    accentColor: string;
    themeMode: string;
    language: string;
    bottomDockMode?: string;
    structureGuardEnabled?: boolean;
    criticalPatterns?: string[];
  };
  sources: PluginSource[];
  plugins: Array<{
    id: string;
    name: string;
    version: string;
    enabled: boolean;
    sourceUrl?: string;
  }>;
  pluginSettings?: Record<string, Record<string, any>>;
}

export interface ProfilePreview {
  profile: StudioProfile;
  settingsDiff: string[];
  newSources: PluginSource[];
  pluginsStatus: Array<{
    id: string;
    name: string;
    version: string;
    installed: boolean;
    action: 'already_installed' | 'to_install' | 'will_enable';
  }>;
}

export interface ProfileImportResult {
  settingsApplied: boolean;
  sourcesAdded: number;
  pluginsQueued: string[];
  pluginsEnabled?: string[];
  errors?: string[];
}

export type ContextMenuGroup = 'open' | 'clipboard' | 'tools' | 'edit' | 'danger';

export interface ContextMenuTarget {
  path: string;
  name: string;
  isDir: boolean;
  extension: string;
  currentDir: string;
}

export interface ContextMenuItem {
  id: string;
  pluginId?: string;
  label: string;
  icon?: string;
  group?: ContextMenuGroup;
  order?: number;
  shortcut?: string;
  targetType?: 'file' | 'folder' | 'empty' | 'any';
  fileMatches?: string[];
  onClick: (target: ContextMenuTarget) => void | Promise<void>;
  isVisible?: (target: ContextMenuTarget) => boolean;
  isEnabled?: (target: ContextMenuTarget) => boolean;
}

export type SecretType = 'password' | 'ssh_key' | 'token';
export type SecretScope = 'shared' | 'plugin';

export interface SecretMeta {
  id: string;
  title: string;
  type: SecretType;
  scope: SecretScope;
  pluginId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SecretItem extends SecretMeta {
  value?: string;
}

export interface SecretsStatus {
  backend: string;
  isAvailable: boolean;
  count: number;
  authEnabled: boolean;
  privilegedActive: boolean;
}

export interface PluginCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  requiresConfirm?: boolean;
  warning?: string;
  error?: string;
}

export interface SSHHost {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authType: 'password' | 'private_key' | 'vault';
  identityId?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  jumpHostId?: string;
  defaultPath?: string;
  tags?: string[];
  createdAt?: string;
}

export interface SSHTestResult {
  success: boolean;
  serverVersion?: string;
  latencyMs: number;
  error?: string;
}

export interface SSHKeyPair {
  type: string;
  publicKey: string;
  privateKey: string;
  fingerprint: string;
  comment: string;
}

export interface SFTPFileInfo {
  name: string;
  path: string;
  size: number;
  mode: string;
  isDir: boolean;
  modTime: string;
}

export interface SFTPRequest {
  host: string;
  port: number;
  user: string;
  authType?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  identityId?: string;
  jumpHost?: any;
  path?: string;
  content?: string;
  encoding?: string;
  isDir?: boolean;
  newPath?: string;
}

export interface MemoryInfo {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface DiskInfo {
  mountPoint: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface SystemMetrics {
  hostname: string;
  os: string;
  arch: string;
  numCpu: number;
  cpuPercent: number;
  uptimeSec: number;
  loadAvg: [number, number, number];
  memory: MemoryInfo;
  disks: DiskInfo[];
  collectedAt: string;
  version: string;
}

