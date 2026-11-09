import React, { useState } from 'react';
import {
  Shield,
  Cpu,
  Key,
  Copy,
  Check,
  ShieldCheck,
} from 'lucide-react';
import { Card, Input, Button, Toggle, Badge, SectionHeader } from '../../ui';

interface SecurityTabProps {
  authEnabled: boolean;
  setAuthEnabled: (v: boolean) => void;
  authUser: string;
  setAuthUser: (v: string) => void;
  authPass: string;
  setAuthPass: (v: string) => void;
  apiEnabled: boolean;
  setApiEnabled: (v: boolean) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  structureGuardEnabled: boolean;
  setStructureGuardEnabled: (v: boolean) => void;
  criticalPatterns: string;
  setCriticalPatterns: (v: string) => void;
  t: any;
}

export const SecurityTab: React.FC<SecurityTabProps> = ({
  authEnabled,
  setAuthEnabled,
  authUser,
  setAuthUser,
  authPass,
  setAuthPass,
  apiEnabled,
  setApiEnabled,
  apiKey,
  setApiKey,
  structureGuardEnabled,
  setStructureGuardEnabled,
  criticalPatterns,
  setCriticalPatterns,
  t,
}) => {
  const [copiedKey, setCopiedKey] = useState(false);

  const generateRandomKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'cs_';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setApiKey(result);
  };

  const handleCopyKey = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="p-6 space-y-5 overflow-y-auto flex-1 custom-scrollbar">
      {/* Direct Authentication Card */}
      <Card className="p-4 space-y-3">
        <SectionHeader
          icon={<Shield className="w-4 h-4" />}
          title={t.authSettings}
          rightElement={
            <Toggle
              checked={authEnabled}
              onChange={setAuthEnabled}
              size="md"
            />
          }
        />

        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          {t.authHelp}
        </p>

        {authEnabled && (
          <div className="space-y-3 pt-2 border-t border-base-border/60">
            <Input
              label={t.username}
              type="text"
              value={authUser}
              onChange={(e) => setAuthUser(e.target.value)}
              placeholder="admin"
            />
            <Input
              label={t.newPassword}
              type="password"
              placeholder="••••••••"
              value={authPass}
              onChange={(e) => setAuthPass(e.target.value)}
            />
          </div>
        )}
      </Card>

      {/* REST API Access Setting Card */}
      <Card className="p-4 space-y-3">
        <SectionHeader
          icon={<Cpu className="w-4 h-4" />}
          title={t.enableApi}
          rightElement={
            <Toggle
              checked={apiEnabled}
              onChange={(val) => {
                setApiEnabled(val);
                if (val && !apiKey) {
                  generateRandomKey();
                }
              }}
              size="md"
            />
          }
        />

        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          {t.enableApiHelp}
        </p>

        {apiEnabled ? (
          <div className="space-y-2 pt-2 border-t border-base-border/60">
            <label className="block text-[11px] font-medium text-gray-700 dark:text-gray-300">
              {t.apiKey}
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                readOnly
                value={apiKey}
                className="flex-1 px-3 py-1.5 bg-white dark:bg-black/30 border border-base-border rounded-xl text-xs font-mono text-gray-900 dark:text-white select-all focus:outline-none"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopyKey}
                icon={copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                title="Copy API Key"
              >
                {copiedKey ? t.copied : 'Copy'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={generateRandomKey}
                icon={<Key className="w-3.5 h-3.5 text-accent" />}
                title={t.generateApiKey}
              />
            </div>
            <p className="text-[10px] text-gray-400 font-mono">
              curl -H &quot;X-API-Key: {apiKey ? apiKey.substring(0, 10) + '...' : 'YOUR_KEY'}&quot; http://&lt;host&gt;:8080/api/fs/tree
            </p>
          </div>
        ) : (
          <div className="flex items-center space-x-2 text-[11px] text-emerald-600 dark:text-emerald-400 pt-1">
            <Check className="w-3.5 h-3.5" />
            <span>{t.apiDisabledNote}</span>
          </div>
        )}
      </Card>

      {/* Structure Guard (Deep Pre-Save Validation) Card */}
      <Card className="p-4 space-y-3">
        <SectionHeader
          icon={<ShieldCheck className="w-4 h-4 text-emerald-400" />}
          title="Structure Guard & Pre-Save Guard"
          rightElement={
            <Toggle
              checked={structureGuardEnabled}
              onChange={setStructureGuardEnabled}
              size="md"
            />
          }
        />

        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          {t.structureGuardDesc}
        </p>

        {structureGuardEnabled && (
          <div className="space-y-2 pt-2 border-t border-base-border/60">
            <label className="block text-[11px] font-medium text-gray-700 dark:text-gray-300">
              {t.criticalPatternsLabel}
            </label>
            <textarea
              rows={3}
              value={criticalPatterns}
              onChange={(e) => setCriticalPatterns(e.target.value)}
              placeholder="*.prod.json&#10;k8s/*.yaml&#10;my-service.conf"
              className="w-full px-3 py-2 bg-white dark:bg-black/30 border border-base-border rounded-xl text-xs font-mono text-gray-900 dark:text-white focus:outline-none focus:border-accent"
            />
            <p className="text-[10px] text-gray-400 leading-normal">
              {t.criticalPatternsHelp} <code>docker-compose*.yml</code>, <code>nginx.conf</code>, <code>*.service</code>, <code>.env.production</code>, <code>Caddyfile</code>, <code>*.prod.yaml</code>
            </p>
          </div>
        )}
      </Card>
    </div>
  );
};
