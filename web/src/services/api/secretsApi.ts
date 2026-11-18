import {
  SecretsStatus,
  SecretMeta,
  SecretItem,
  AuditEvent,
  AuditQueryResponse,
  StudioProfile,
  ProfilePreview,
  ProfileImportResult,
} from '../../types';
import { webFetch, PreSaveGuardError, remoteEndpoint } from './client';

export const secretsApi = {

  async getAuditLogs(params: {
    limit?: number;
    offset?: number;
    action?: string;
    category?: string;
    source?: string;
    severity?: string;
    search?: string;
  } = {}): Promise<AuditQueryResponse> {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    if (params.action) query.set('action', params.action);
    if (params.category) query.set('category', params.category);
    if (params.source) query.set('source', params.source);
    if (params.severity) query.set('severity', params.severity);
    if (params.search) query.set('search', params.search);

    const res = await webFetch(`/api/audit/logs?${query.toString()}`);
    if (!res.ok) return { events: [], total: 0 };
    return res.json();
  },

  async ingestAuditEvents(events: Partial<AuditEvent>[]): Promise<void> {
    if (!events || events.length === 0) return;
    try {
      await webFetch('/api/audit/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      });
    } catch {
      // Best-effort ingestion, must not break caller
    }
  },

  async exportAuditLogs(): Promise<Blob> {
    const res = await webFetch('/api/audit/export');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to export audit logs');
    }
    return res.blob();
  },

  getAuditExportUrl(): string {
    return `/api/audit/export?web=1`;
  },


  async previewProfile(fileContent: string): Promise<ProfilePreview> {
    const res = await webFetch('/api/profile/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fileContent,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Invalid profile JSON');
    }
    return res.json();
  },

  async importProfile(req: {
    profile: StudioProfile;
    applySettings: boolean;
    importSources: boolean;
    autoInstallPlugins: boolean;
  }): Promise<ProfileImportResult> {
    const res = await webFetch('/api/profile/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to import profile');
    }
    return res.json();
  },

  // Secrets Management APIs
  async getSecretsStatus(): Promise<SecretsStatus> {
    const res = await webFetch('/api/secrets/status');
    if (!res.ok) {
      return {
        backend: 'Unknown',
        isAvailable: false,
        count: 0,
        authEnabled: false,
        privilegedActive: false,
      };
    }
    return res.json();
  },

  async listSecrets(): Promise<SecretMeta[]> {
    const res = await webFetch('/api/secrets');
    if (!res.ok) return [];
    return res.json();
  },

  async listSharedSecrets(): Promise<SecretMeta[]> {
    const res = await webFetch('/api/secrets/shared');
    if (!res.ok) return [];
    return res.json();
  },

  async unlockSecrets(password: string): Promise<{ success: boolean; expiresIn: number }> {
    const res = await webFetch('/api/secrets/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to unlock secrets');
    }
    return res.json();
  },

  async getSecretValue(id: string): Promise<string> {
    const res = await webFetch('/api/secrets/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to retrieve secret value');
    }
    const data = await res.json();
    return data.value || '';
  },

  async saveSecret(item: SecretItem): Promise<void> {
    const res = await webFetch('/api/secrets/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save secret');
    }
  },

  async deleteSecret(id: string): Promise<void> {
    const res = await webFetch(`/api/secrets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete secret');
    }
  },

};
