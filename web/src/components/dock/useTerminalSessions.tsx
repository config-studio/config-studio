import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Terminal, Server } from 'lucide-react';
import { SSHHost } from '../../types';
import { sshHostService } from '../../services/sshHosts';
import { PillTabItem } from '@config-studio/ui';
import type { XTerminalHandle } from '../terminal/XTerminal';

export interface TerminalSession {
  id: string;
  hostId: string;
  host: SSHHost;
  title: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
}

export function useTerminalSessions(setSshHosts: (hosts: SSHHost[]) => void) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('launcher');
  const [hostToDelete, setHostToDelete] = useState<SSHHost | null>(null);
  const termRefs = useRef<Record<string, XTerminalHandle | null>>({});

  const handleSelectHost = useCallback((host: SSHHost) => {
    setSessions((prev) => {
      const existingForHost = prev.filter((s) => s.hostId === host.id);
      const title =
        existingForHost.length > 0
          ? `${host.name || host.host} (${existingForHost.length + 1})`
          : host.name || host.host;

      const newSess: TerminalSession = {
        id: 'sess-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        hostId: host.id,
        host,
        title,
        status: 'connecting',
      };
      setActiveSessionId(newSess.id);
      sshHostService.setLastActiveHostId(host.id);
      return [...prev, newSess];
    });
  }, []);

  const handleCloseSession = useCallback(
    (sessionId: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== sessionId);
        delete termRefs.current[sessionId];
        if (activeSessionId === sessionId) {
          if (next.length > 0) {
            setActiveSessionId(next[next.length - 1].id);
          } else {
            setActiveSessionId('launcher');
          }
        }
        return next;
      });
    },
    [activeSessionId]
  );

  const handleReconnectActive = useCallback(() => {
    if (activeSessionId && activeSessionId !== 'launcher') {
      termRefs.current[activeSessionId]?.reconnect();
    }
  }, [activeSessionId]);

  const handleClearActive = useCallback(() => {
    if (activeSessionId && activeSessionId !== 'launcher') {
      termRefs.current[activeSessionId]?.clear();
    }
  }, [activeSessionId]);

  const handleSessionStatusChange = useCallback(
    (sessionId: string, status: TerminalSession['status'], error?: string) => {
      setSessions((prev) => {
        const target = prev.find((s) => s.id === sessionId);
        if (target && target.status === status && target.errorMessage === (error || '')) {
          return prev;
        }
        return prev.map((s) =>
          s.id === sessionId ? { ...s, status, errorMessage: error || '' } : s
        );
      });
    },
    []
  );

  const handleDeleteHost = useCallback((host: SSHHost) => {
    setHostToDelete(host);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (hostToDelete) {
      sshHostService.delete(hostToDelete.id);
      setSessions((prev) => {
        const next = prev.filter((s) => s.hostId !== hostToDelete.id);
        if (next.length === 0) {
          setActiveSessionId('launcher');
        } else if (!next.some((s) => s.id === activeSessionId)) {
          setActiveSessionId(next[next.length - 1].id);
        }
        return next;
      });
      setHostToDelete(null);
    }
  }, [hostToDelete, activeSessionId]);

  useEffect(() => {
    const handleOpenSSH = (e: any) => {
      const detail = e.detail;
      const hosts = sshHostService.list();
      setSshHosts(hosts);
      if (detail && detail.id) {
        const match = hosts.find((h) => h.id === detail.id);
        if (match) handleSelectHost(match);
      } else if (detail && detail.host) {
        const match = hosts.find((h) => h.host === detail.host);
        if (match) handleSelectHost(match);
      }
    };
    window.addEventListener('cs:open-ssh-terminal', handleOpenSSH);
    return () => window.removeEventListener('cs:open-ssh-terminal', handleOpenSSH);
  }, [handleSelectHost, setSshHosts]);

  const terminalSessionTabs = useMemo<PillTabItem[]>(() => {
    const items: PillTabItem[] = [
      {
        id: 'launcher',
        label: 'Хосты',
        icon: <Server size={12} />,
        closable: false,
      },
    ];

    sessions.forEach((s) => {
      let statusDot: PillTabItem['statusDot'] = 'amber';
      if (s.status === 'connected') statusDot = 'green';
      else if (s.status === 'connecting') statusDot = 'amber';
      else if (s.status === 'disconnected' || s.status === 'error') statusDot = 'red';

      items.push({
        id: s.id,
        label: s.title,
        icon: <Terminal size={12} />,
        statusDot,
        closable: true,
      });
    });

    return items;
  }, [sessions]);

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    termRefs,
    hostToDelete,
    setHostToDelete,
    handleSelectHost,
    handleCloseSession,
    handleReconnectActive,
    handleClearActive,
    handleSessionStatusChange,
    handleDeleteHost,
    handleConfirmDelete,
    terminalSessionTabs,
  };
}
