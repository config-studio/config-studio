/**
 * Remote Server Agent Plugin v2.0 for Config Studio
 * Multi-Server Fleet Orchestrator with Two-Tier TOTP Authentication
 * and Scoped Telemetry Tokens.
 */
(function() {
  const pluginId = 'remote-agent';
  if (!window.ConfigStudio) return;

  const storageKey = 'cs_remote_servers_v2';
  let servers = [];
  let activeServerId = localStorage.getItem('cs_active_server_id') || 'local';
  let totpTimer = null;

  // Load servers metadata from localStorage (legacy migration handled)
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      servers = JSON.parse(raw);
    } else {
      const legacy = localStorage.getItem('cs_remote_servers');
      if (legacy) {
        const parsed = JSON.parse(legacy);
        servers = parsed.map((s, idx) => ({
          id: 'srv_' + (idx + 1) + '_' + Math.random().toString(36).substring(2, 6),
          name: s.name || 'Remote Server ' + (idx + 1),
          url: (s.url || '').replace(/\/$/, ''),
          keyId: s.token ? s.token.split(':')[0] : 'cs_master',
          secret: s.token && s.token.includes(':') ? s.token.split(':')[1] : '',
          isRW: true,
          status: 'unknown',
          pingMs: null
        }));
        localStorage.removeItem('cs_remote_servers');
      }
    }
  } catch (e) {
    servers = [];
  }

  // --------------------------------------------------------------------------
  // Core Secrets Vault Integration (Zero-Secret Guarantee)
  // --------------------------------------------------------------------------
  function saveServers() {
    // Strip secret before persisting to localStorage: secrets live ONLY in Core Vault
    const sanitized = servers.map(s => {
      const copy = { ...s };
      delete copy.secret;
      return copy;
    });
    localStorage.setItem(storageKey, JSON.stringify(sanitized));
  }

  async function saveServerSecretToVault(srv) {
    if (!window.ConfigStudio?.secrets) return;
    try {
      await window.ConfigStudio.secrets.set({
        id: 'cs_agent_sec_' + srv.id,
        title: `Remote Agent: ${srv.name}`,
        type: 'token',
        scope: 'plugin',
        pluginId: pluginId,
        value: JSON.stringify({
          keyId: srv.keyId || '',
          secret: srv.secret || ''
        })
      });
    } catch (e) {
      console.warn(`[RemoteAgent] Failed to store credentials in Vault for ${srv.id}:`, e);
    }
  }

  async function deleteServerSecretFromVault(id) {
    if (!window.ConfigStudio?.secrets) return;
    try {
      await window.ConfigStudio.secrets.delete('cs_agent_sec_' + id);
    } catch (e) {
      console.warn(`[RemoteAgent] Failed to delete credentials from Vault for ${id}:`, e);
    }
  }

  // Hydrate credentials from Core Vault into memory on startup
  async function hydrateSecretsFromVault() {
    if (!window.ConfigStudio?.secrets) return;

    let needsLocalStorageClean = false;

    for (const srv of servers) {
      try {
        const val = await window.ConfigStudio.secrets.get('cs_agent_sec_' + srv.id);
        if (val) {
          try {
            const parsed = JSON.parse(val);
            if (parsed.keyId) srv.keyId = parsed.keyId;
            if (parsed.secret !== undefined) srv.secret = parsed.secret;
          } catch (_) {
            srv.secret = val;
          }
        } else if (srv.secret) {
          // Auto-migrate legacy secret into Core Vault
          await saveServerSecretToVault(srv);
          needsLocalStorageClean = true;
        }
      } catch (err) {
        // Not found in Vault: auto-migrate legacy secret if present in memory
        if (srv.secret) {
          await saveServerSecretToVault(srv);
          needsLocalStorageClean = true;
        }
      }

      // If srv object had secret loaded from raw localStorage, ensure it is cleaned
      if (srv.secret) {
        needsLocalStorageClean = true;
      }
    }

    if (needsLocalStorageClean) {
      saveServers(); // Persist sanitized metadata without secret
    }

    // Refresh active connection now that secrets are hydrated
    if (activeServerId !== 'local') {
      await refreshActiveAuthToken();
    }
    if (updateHeaderUI) updateHeaderUI();
  }

  // ==========================================================================
  // 1. WebCrypto TOTP Engine (RFC 6238 RFC compliant)
  // ==========================================================================
  function base32Decode(str) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let clean = (str || '').toUpperCase().replace(/[\s=-]/g, '');
    let bits = '';
    for (let i = 0; i < clean.length; i++) {
      const val = alphabet.indexOf(clean[i]);
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.substr(i, 8), 2));
    }
    return new Uint8Array(bytes);
  }

  async function generateTOTPWebCrypto(secret, timestampSeconds = Math.floor(Date.now() / 1000)) {
    if (!secret) return '';
    try {
      const keyBytes = base32Decode(secret);
      if (keyBytes.length === 0) return '';
      const counter = Math.floor(timestampSeconds / 30);
      const counterBuf = new ArrayBuffer(8);
      const counterView = new DataView(counterBuf);
      counterView.setBigUint64(0, BigInt(counter));

      const cryptoKey = await window.crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
      );
      const signature = await window.crypto.subtle.sign('HMAC', cryptoKey, counterBuf);
      const hash = new Uint8Array(signature);
      const offset = hash[hash.length - 1] & 0x0f;
      const dataView = new DataView(hash.buffer, hash.byteOffset);
      const binary = dataView.getUint32(offset) & 0x7fffffff;
      const otp = binary % 1000000;
      return otp.toString().padStart(6, '0');
    } catch (e) {
      console.warn('[RemoteAgent] TOTP generation error:', e);
      return '';
    }
  }

  // Scoped translation helper
  const i18n = window.ConfigStudio.i18n?.scoped?.(pluginId) || {
    t: (k, fb, p) => {
      let res = fb || k;
      if (p) {
        for (const [key, val] of Object.entries(p)) {
          res = res.replace(new RegExp(`\\{${key}\\}`, 'g'), String(val));
        }
      }
      return res;
    }
  };
  const t = typeof i18n === 'function' ? i18n : i18n.t.bind(i18n);

  // Background TOTP refresher to keep authorization alive on active remote server
  async function refreshActiveAuthToken() {
    if (activeServerId === 'local') return;
    const srv = servers.find(s => s.id === activeServerId);
    if (!srv) return;

    if (srv.isRW && srv.secret) {
      const otp = await generateTOTPWebCrypto(srv.secret);
      const compositeToken = `${srv.keyId}:${otp}`;
      window.ConfigStudio.setRemoteEndpoint(srv.url, compositeToken);
    } else {
      window.ConfigStudio.setRemoteEndpoint(srv.url, srv.keyId);
    }
  }

  if (activeServerId !== 'local') {
    refreshActiveAuthToken();
    totpTimer = setInterval(refreshActiveAuthToken, 15000); // refresh every 15s (within 30s step)
  }

  // ==========================================================================
  // 2. Interactive Header Switcher Component
  // ==========================================================================
  let updateHeaderUI = null;

  window.ConfigStudio.registerHeaderItem({
    id: 'remote-agent-switcher',
    pluginId: pluginId,
    order: 10,
    render: (container) => {
      container.innerHTML = '';
      container.style.position = 'relative';

      let isOpen = false;
      const wrapper = document.createElement('div');
      wrapper.className = 'flex items-center';

      const btn = document.createElement('button');
      btn.className = 'cs-remote-header-btn';

      function renderBtnContent() {
        if (activeServerId === 'local') {
          btn.innerHTML = `<span>🖥️</span> <span>Localhost</span> <span class="cs-remote-badge online">● HOST</span> <span style="font-size: 8px;">▾</span>`;
        } else {
          const s = servers.find(x => x.id === activeServerId);
          if (s) {
            const badgeClass = s.status === 'offline' ? 'offline' : (s.isRW ? 'online' : 'ro');
            const badgeLabel = s.status === 'offline' ? 'OFFLINE' : (s.isRW ? 'RW' : 'RO');
            const pingText = s.pingMs ? `${s.pingMs}ms • ` : '';
            btn.innerHTML = `<span>🌐</span> <span>${s.name}</span> <span class="cs-remote-badge ${badgeClass}">${pingText}${badgeLabel}</span> <span style="font-size: 8px;">▾</span>`;
          } else {
            btn.innerHTML = `<span>🖥️</span> <span>Localhost</span> <span style="font-size: 8px;">▾</span>`;
          }
        }
      }

      renderBtnContent();

      // Dropdown menu
      const dropdown = document.createElement('div');
      dropdown.className = 'cs-remote-dropdown';
      dropdown.style.display = 'none';

      function renderDropdown() {
        dropdown.innerHTML = '';

        // Localhost Item
        const localItem = document.createElement('div');
        localItem.className = `cs-remote-item ${activeServerId === 'local' ? 'active' : ''}`;
        localItem.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <span>🖥️</span>
            <div>
              <div style="font-size: 12px; font-weight: 500;">Localhost</div>
              <div style="font-size: 10px; opacity: 0.6;">Локальный хост Config Studio</div>
            </div>
          </div>
          <span class="cs-remote-badge online">HOST</span>
        `;
        localItem.onclick = () => {
          selectServer('local');
          closeDropdown();
        };
        dropdown.appendChild(localItem);

        // Server list section
        if (servers.length > 0) {
          const divHeader = document.createElement('div');
          divHeader.style.cssText = 'padding: 8px 10px 4px 10px; font-size: 10px; font-weight: 600; text-transform: uppercase; color: #8b949e; letter-spacing: 0.05em;';
          divHeader.textContent = `Удаленные серверы (${servers.length})`;
          dropdown.appendChild(divHeader);

          servers.forEach(srv => {
            const item = document.createElement('div');
            item.className = `cs-remote-item ${activeServerId === srv.id ? 'active' : ''}`;

            const badgeClass = srv.status === 'offline' ? 'offline' : (srv.isRW ? 'online' : 'ro');
            const badgeLabel = srv.status === 'offline' ? 'OFFLINE' : (srv.isRW ? 'RW' : 'RO');
            const pingText = srv.pingMs ? `${srv.pingMs}ms` : 'online';

            item.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <span>🌐</span>
                <div style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  <div style="font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis;">${srv.name}</div>
                  <div style="font-size: 10px; opacity: 0.6; overflow: hidden; text-overflow: ellipsis;">${srv.url}</div>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; shrink: 0;">
                <span class="cs-remote-badge ${badgeClass}">${srv.status === 'offline' ? 'OFF' : pingText} • ${badgeLabel}</span>
                <button class="cs-edit-btn" style="background: none; border: none; color: #8b949e; cursor: pointer; padding: 2px;" title="Редактировать">⚙️</button>
                <button class="cs-del-btn" style="background: none; border: none; color: #f85149; cursor: pointer; padding: 2px;" title="Удалить">🗑️</button>
              </div>
            `;

            item.onclick = (e) => {
              if (e.target.closest('.cs-edit-btn')) {
                e.stopPropagation();
                openServerModal(srv);
                closeDropdown();
                return;
              }
              if (e.target.closest('.cs-del-btn')) {
                e.stopPropagation();
                if (confirm(`Удалить сервер "${srv.name}" из списка?`)) {
                  deleteServer(srv.id);
                  renderDropdown();
                  renderBtnContent();
                }
                return;
              }
              selectServer(srv.id);
              closeDropdown();
            };

            dropdown.appendChild(item);
          });
        }

        // Actions Divider
        const divider = document.createElement('div');
        divider.style.cssText = 'height: 1px; background: rgba(255,255,255,0.08); margin: 6px 0;';
        dropdown.appendChild(divider);

        // Add server button
        const addBtn = document.createElement('div');
        addBtn.className = 'cs-remote-item';
        addBtn.style.color = '#00d2b4';
        addBtn.innerHTML = `<span>➕</span> <span style="font-size: 12px; font-weight: 500;">${t('addServer', 'Добавить сервер...')}</span>`;
        addBtn.onclick = () => {
          openServerModal(null);
          closeDropdown();
        };
        dropdown.appendChild(addBtn);

        // Scan LAN button
        const scanBtn = document.createElement('div');
        scanBtn.className = 'cs-remote-item';
        scanBtn.innerHTML = `<span>🔍</span> <span style="font-size: 12px; font-weight: 500;">${t('discoverBtn', 'Поиск агентов в сети')}</span>`;
        scanBtn.onclick = () => {
          closeDropdown();
          openDiscoveryModal();
        };
        dropdown.appendChild(scanBtn);

        // Scoped Monitoring Tokens button
        if (activeServerId !== 'local') {
          const tokensBtn = document.createElement('div');
          tokensBtn.className = 'cs-remote-item';
          tokensBtn.innerHTML = `<span>🛡️</span> <span style="font-size: 12px; font-weight: 500;">${t('manageTokens', 'Токены мониторинга...')}</span>`;
          tokensBtn.onclick = () => {
            openTokensModal();
            closeDropdown();
          };
          dropdown.appendChild(tokensBtn);
        }
      }

      function toggleDropdown() {
        isOpen = !isOpen;
        if (isOpen) {
          renderDropdown();
          dropdown.style.display = 'block';
          // Ping servers in background
          pingAllServers();
        } else {
          dropdown.style.display = 'none';
        }
      }

      function closeDropdown() {
        isOpen = false;
        dropdown.style.display = 'none';
      }

      btn.onclick = (e) => {
        e.stopPropagation();
        toggleDropdown();
      };

      document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
          closeDropdown();
        }
      });

      wrapper.appendChild(btn);
      wrapper.appendChild(dropdown);
      container.appendChild(wrapper);

      updateHeaderUI = () => {
        renderBtnContent();
        renderDropdown();
      };
    }
  });

  // Switch active server
  async function selectServer(id) {
    if (activeServerId === id) return;
    activeServerId = id;
    localStorage.setItem('cs_active_server_id', id);

    if (totpTimer) {
      clearInterval(totpTimer);
      totpTimer = null;
    }

    if (id === 'local') {
      window.ConfigStudio.setRemoteEndpoint(null);
      window.ConfigStudio.showNotification('Переключено на локальный хост', 'info');
      setTimeout(() => {
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('_t', String(Date.now()));
          window.location.href = url.toString();
        } catch (_) {
          window.location.reload();
        }
      }, 150);
      return;
    }

    const srv = servers.find(s => s.id === id);
    if (srv) {
      await refreshActiveAuthToken();
      totpTimer = setInterval(refreshActiveAuthToken, 15000);
      window.ConfigStudio.showNotification(`Подключение к ${srv.name}...`, 'info');
      setTimeout(() => {
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('_t', String(Date.now()));
          window.location.href = url.toString();
        } catch (_) {
          window.location.reload();
        }
      }, 150);
    }
  }

  async function deleteServer(id) {
    servers = servers.filter(s => s.id !== id);
    saveServers();
    await deleteServerSecretFromVault(id);
    if (activeServerId === id) {
      selectServer('local');
    }
  }

  // Ping check
  async function pingAllServers() {
    for (const srv of servers) {
      const start = performance.now();
      try {
        const res = await fetch(`/api/remote-proxy/health`, {
          method: 'GET',
          headers: {
            'X-ConfigStudio-Web': '1',
            'X-Remote-Target': srv.url
          },
          signal: AbortSignal.timeout(4000)
        });
        if (res.ok) {
          srv.status = 'online';
          srv.pingMs = Math.round(performance.now() - start);
        } else {
          srv.status = 'offline';
        }
      } catch (e) {
        srv.status = 'offline';
      }
    }
    saveServers();
    if (updateHeaderUI) updateHeaderUI();
  }

  // ==========================================================================
  // 3. LAN Broadcast & Subnet Discovery Engine
  // ==========================================================================
  function detectDefaultSubnet() {
    for (const s of servers) {
      const match = (s.url || '').match(/https?:\/\/(\d+\.\d+\.\d+)\.\d+/);
      if (match) return match[1];
    }
    const hostMatch = window.location.hostname.match(/^(\d+\.\d+\.\d+)\.\d+$/);
    if (hostMatch) return hostMatch[1];
    return '192.168.0';
  }

  let isScanning = false;
  async function scanSubnet(subnet = '192.168.0', onFound = null) {
    if (isScanning) return [];
    isScanning = true;
    const cleanSubnet = subnet.replace(/\.$/, '');
    const found = [];
    const batchSize = 32;

    for (let start = 1; start <= 254; start += batchSize) {
      const end = Math.min(start + batchSize - 1, 254);
      const batch = [];
      for (let i = start; i <= end; i++) {
        const ip = `${cleanSubnet}.${i}`;
        const targetUrl = `http://${ip}:8085`;
        batch.push(
          fetch(`/api/remote-proxy/health`, {
            headers: {
              'X-ConfigStudio-Web': '1',
              'X-Remote-Target': targetUrl
            },
            signal: AbortSignal.timeout(650)
          })
          .then(async (res) => {
            if (res.ok) {
              const data = await res.json().catch(() => null);
              if (data && data.status === 'ok') {
                const item = {
                  ip,
                  url: targetUrl,
                  hostname: data.hostname || ip,
                  version: data.version,
                  uptime: data.uptime,
                  adopted: data.adopted === undefined ? true : !!data.adopted
                };
                found.push(item);
                if (typeof onFound === 'function') onFound(item);
              }
            }
          })
          .catch(() => {})
        );
      }
      await Promise.allSettled(batch);
    }

    isScanning = false;
    return found;
  }

  // 1-Click Adopt Handshake
  async function adoptServer(agent) {
    try {
      window.ConfigStudio.showNotification(
        t('adopting', `Сопряжение с узлом ${agent.hostname}...`, { name: agent.hostname }),
        'info'
      );

      const res = await fetch(`/api/remote-proxy/api/adopt`, {
        method: 'POST',
        headers: {
          'X-ConfigStudio-Web': '1',
          'X-Remote-Target': agent.url,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        const errText = await res.text();
        let errMsg = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed.error) errMsg = parsed.error;
        } catch (_) {
          if (errText) errMsg = errText;
        }
        throw new Error(errMsg);
      }

      const data = await res.json();
      if (!data.keyId || !data.secret) {
        throw new Error('Узел не предоставил учетные данные');
      }

      const newServer = {
        id: 'srv_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
        name: data.hostname || agent.hostname || agent.ip,
        url: agent.url,
        keyId: data.keyId,
        secret: data.secret,
        isRW: true,
        status: 'online',
        pingMs: 1
      };

      // Save credentials into Core Vault (OS Keychain / AES-256 Vault)
      await saveServerSecretToVault(newServer);

      // Add to fleet and save metadata to localStorage
      servers.push(newServer);
      saveServers();

      window.ConfigStudio.showNotification(
        t('serverAdopted', `Узел ${newServer.name} успешно принят во флот и готов к работе!`, { name: newServer.name }),
        'success'
      );

      // Switch to newly adopted server immediately!
      selectServer(newServer.id);
    } catch (e) {
      console.error('[RemoteAgent] 1-Click Adopt failed:', e);
      alert(`Ошибка сопряжения: ${e.message}`);
    }
  }

  // Discovery Modal
  function openDiscoveryModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'cs-remote-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'cs-remote-modal-content';
    modal.style.maxWidth = '520px';

    const defaultSubnet = detectDefaultSubnet();

    modal.innerHTML = `
      <div class="cs-remote-modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 16px;">🔍</span>
          <span style="font-weight: 600; font-size: 14px; color: #fff;">${t('discoverTitle', 'Автообнаружение агентов в сети')}</span>
        </div>
        <button class="cs-close-modal" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 16px;">✕</button>
      </div>

      <div class="cs-remote-modal-body">
        <p style="font-size: 12px; color: #8b949e; margin: 0;">
          Сканирование локальной подсети на наличие сервисов <code>config-studio-agent</code> (порт 8085) с поддержкой 1-Click сопряжения (Adopt).
        </p>

        <!-- Subnet input bar -->
        <div style="display: flex; gap: 8px; align-items: center; background: rgba(0,0,0,0.25); padding: 8px 12px; border: 1px solid #30363d; border-radius: 10px;">
          <div style="font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase;">${t('subnetLabel', 'Подсеть')}:</div>
          <div style="display: flex; align-items: center; gap: 4px; flex: 1;">
            <input type="text" id="cs-inp-subnet" class="cs-remote-input" style="padding: 4px 8px; width: 140px; font-family: monospace;" value="${defaultSubnet}">
            <span style="font-family: monospace; color: #8b949e; font-size: 12px;">.1..254</span>
          </div>
          <button type="button" id="cs-btn-start-scan" class="cs-remote-btn cs-remote-btn-primary" style="padding: 6px 14px; font-size: 11px;">
            <span id="cs-scan-spinner" style="display: none;" class="cs-scan-pulse"></span>
            <span id="cs-scan-text">${t('scanLan', 'Сканировать LAN')}</span>
          </button>
        </div>

        <!-- Scan Status & Results -->
        <div id="cs-discovery-status" style="font-size: 11px; color: #8b949e; min-height: 16px;"></div>

        <div id="cs-discovery-results" style="display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto;">
          <div style="text-align: center; color: #8b949e; padding: 24px; font-size: 12px; background: rgba(255,255,255,0.02); border-radius: 8px; border: 1px dashed #30363d;">
            Нажмите «Сканировать LAN» для поиска доступных серверов
          </div>
        </div>
      </div>

      <div style="padding: 12px 20px; border-top: 1px solid #21262d; display: flex; justify-content: flex-end; background: rgba(0,0,0,0.2);">
        <button type="button" class="cs-remote-btn cs-remote-btn-secondary cs-close-modal">${t('cancel', 'Закрыть')}</button>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const closeModal = () => backdrop.remove();
    modal.querySelectorAll('.cs-close-modal').forEach(b => b.onclick = closeModal);

    const scanBtn = modal.querySelector('#cs-btn-start-scan');
    const scanText = modal.querySelector('#cs-scan-text');
    const scanSpinner = modal.querySelector('#cs-scan-spinner');
    const statusBox = modal.querySelector('#cs-discovery-status');
    const resultsBox = modal.querySelector('#cs-discovery-results');
    const subnetInput = modal.querySelector('#cs-inp-subnet');

    async function triggerScan() {
      const subnet = subnetInput.value.trim().replace(/\.$/, '');
      if (!subnet) return;

      scanBtn.disabled = true;
      scanSpinner.style.display = 'inline-block';
      scanText.textContent = 'Поиск...';
      statusBox.innerHTML = `<span style="color: #00d2b4;">${t('scanning', `Сканирование ${subnet}.1..254...`, { subnet })}</span>`;
      resultsBox.innerHTML = '';

      let foundCount = 0;

      const renderDiscoveredItem = (item) => {
        foundCount++;
        const card = document.createElement('div');
        card.className = 'cs-discovered-item';

        const isAlreadyConfigured = servers.some(s => s.url === item.url || (s.url && s.url.includes(item.ip)));

        let actionBtnHtml = '';
        if (isAlreadyConfigured) {
          actionBtnHtml = `<span class="cs-remote-badge online" style="font-size: 11px;">✓ ${t('alreadyInFleet', 'Во флоте')}</span>`;
        } else if (!item.adopted) {
          actionBtnHtml = `<button class="cs-remote-btn cs-remote-btn-primary cs-btn-adopt-act" style="padding: 4px 10px; font-size: 11px;">${t('adoptBtn', '⚡ Принять (Adopt)')}</button>`;
        } else {
          actionBtnHtml = `<button class="cs-remote-btn cs-remote-btn-secondary cs-btn-add-act" style="padding: 4px 10px; font-size: 11px;">+ ${t('addServer', 'Добавить')}</button>`;
        }

        const badgeState = !item.adopted ? '<span class="cs-remote-badge unadopted">✨ UNADOPTED</span>' : '<span class="cs-remote-badge ro">ADOPTED</span>';

        card.innerHTML = `
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
            <span style="font-size: 18px;">🌐</span>
            <div style="min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-weight: 600; color: #fff; font-size: 13px;">${item.hostname}</span>
                ${badgeState}
              </div>
              <div style="font-family: monospace; font-size: 11px; color: #8b949e;">${item.url} • v${item.version || '2.0'}</div>
            </div>
          </div>
          <div>${actionBtnHtml}</div>
        `;

        const adoptBtn = card.querySelector('.cs-btn-adopt-act');
        if (adoptBtn) {
          adoptBtn.onclick = async () => {
            adoptBtn.disabled = true;
            adoptBtn.textContent = 'Принятие...';
            closeModal();
            await adoptServer(item);
          };
        }

        const manualAddBtn = card.querySelector('.cs-btn-add-act');
        if (manualAddBtn) {
          manualAddBtn.onclick = () => {
            closeModal();
            openServerModal({ name: item.hostname, url: item.url, keyId: '', secret: '', isRW: true });
          };
        }

        resultsBox.appendChild(card);
      };

      try {
        await scanSubnet(subnet, renderDiscoveredItem);
        if (foundCount === 0) {
          resultsBox.innerHTML = `
            <div style="text-align: center; color: #8b949e; padding: 24px; font-size: 12px; background: rgba(255,255,255,0.02); border-radius: 8px;">
              ${t('noNodesFound', `Узлы config-studio-agent не обнаружены в подсети ${subnet}.*`, { subnet })}
            </div>
          `;
          statusBox.textContent = 'Сканирование завершено (0 узлов)';
        } else {
          statusBox.innerHTML = `<span style="color: #3fb950;">✓ Найдено активных узлов: ${foundCount}</span>`;
        }
      } catch (e) {
        statusBox.innerHTML = `<span style="color: #f85149;">Ошибка сканирования: ${e.message}</span>`;
      } finally {
        scanBtn.disabled = false;
        scanSpinner.style.display = 'none';
        scanText.textContent = t('scanLan', 'Сканировать LAN');
      }
    }

    scanBtn.onclick = triggerScan;
    // Auto-trigger scan on modal open
    setTimeout(triggerScan, 100);
  }

  // ==========================================================================
  // 4. Modal: Add / Edit Remote Server
  // ==========================================================================
  async function openServerModal(editServer = null) {
    const isEdit = !!editServer;
    if (isEdit && !editServer.secret && window.ConfigStudio?.secrets) {
      try {
        const val = await window.ConfigStudio.secrets.get('cs_agent_sec_' + editServer.id);
        if (val) {
          try {
            const parsed = JSON.parse(val);
            if (parsed.secret) editServer.secret = parsed.secret;
          } catch (_) {
            editServer.secret = val;
          }
        }
      } catch (_) {}
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'cs-remote-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'cs-remote-modal-content';

    modal.innerHTML = `
      <div class="cs-remote-modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 16px;">🌐</span>
          <span style="font-weight: 600; font-size: 14px; color: #fff;">${isEdit ? t('modalTitleEdit', 'Настройка удаленного сервера') : t('modalTitleAdd', 'Подключение удаленного сервера')}</span>
        </div>
        <button class="cs-close-modal" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 16px;">✕</button>
      </div>

      <div class="cs-remote-modal-body">
        ${!isEdit ? `
        <div style="background: rgba(0, 210, 180, 0.08); border: 1px dashed rgba(0, 210, 180, 0.3); border-radius: 8px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 11px; color: #c9d1d9;">Автоматический поиск нового сервера:</div>
          <button type="button" id="cs-modal-quick-scan" class="cs-remote-btn cs-remote-btn-primary" style="padding: 4px 10px; font-size: 11px;">🔍 Поиск в LAN (1-Click Adopt)</button>
        </div>
        ` : ''}
        <div class="cs-remote-input-group">
          <label class="cs-remote-label">${t('nameLabel', 'Название сервера')}</label>
          <input type="text" id="cs-inp-name" class="cs-remote-input" placeholder="${t('namePlaceholder', 'Например: Production Debian VPS')}" value="${editServer ? editServer.name : ''}">
        </div>

        <div class="cs-remote-input-group">
          <label class="cs-remote-label">${t('urlLabel', 'URL агента')}</label>
          <input type="text" id="cs-inp-url" class="cs-remote-input" placeholder="${t('urlPlaceholder', 'http://192.168.1.100:8085')}" value="${editServer ? editServer.url : ''}">
        </div>

        <div class="cs-remote-input-group">
          <label class="cs-remote-label">${t('keyLabel', 'Мастер-ключ ID (Key ID)')}</label>
          <input type="text" id="cs-inp-key" class="cs-remote-input" placeholder="${t('keyPlaceholder', 'cs_master_...')}" value="${editServer ? editServer.keyId : ''}">
        </div>

        <div class="cs-remote-input-group">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label class="cs-remote-label">${t('secretLabel', 'TOTP Секрет (Base32)')}</label>
            <span style="font-size: 10px; color: #8b949e;">из agent.yaml</span>
          </div>
          <div style="position: relative;">
            <input type="password" id="cs-inp-secret" class="cs-remote-input" style="padding-right: 32px;" placeholder="${t('secretPlaceholder', 'Base32 секрет')}" value="${editServer ? (editServer.secret || '') : ''}">
            <button type="button" id="cs-toggle-pwd" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #8b949e; cursor: pointer;">👁️</button>
          </div>
          <div style="font-size: 11px; color: #00d2b4; display: flex; align-items: center; gap: 4px; margin-top: 2px;">
            <span>🔒</span>
            <span>${t('vaultProtected', 'Ключ защищен шифрованием ядра (OS Keychain / AES-256 Vault)')}</span>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
          <input type="checkbox" id="cs-chk-rw" ${!editServer || editServer.isRW ? 'checked' : ''} style="accent-color: #00d2b4; cursor: pointer;">
          <label for="cs-chk-rw" style="font-size: 12px; color: #e6edf3; cursor: pointer;">${t('enableRwLabel', 'Включить полный доступ (RW) через динамический TOTP')}</label>
        </div>

        <!-- Ping Status Box -->
        <div id="cs-ping-status" style="display: none; padding: 10px; border-radius: 8px; font-size: 12px; margin-top: 4px;"></div>
      </div>

      <div style="padding: 16px 20px; border-top: 1px solid #21262d; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2);">
        <button type="button" id="cs-btn-test" class="cs-remote-btn cs-remote-btn-secondary">${t('testPing', '⚡ Проверить связь')}</button>
        <div style="display: flex; gap: 8px;">
          <button type="button" id="cs-btn-cancel" class="cs-remote-btn cs-remote-btn-secondary">${t('cancel', 'Отмена')}</button>
          <button type="button" id="cs-btn-save" class="cs-remote-btn cs-remote-btn-primary">${t('save', 'Сохранить')}</button>
        </div>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Toggle password eye
    const pwdInput = modal.querySelector('#cs-inp-secret');
    modal.querySelector('#cs-toggle-pwd').onclick = () => {
      pwdInput.type = pwdInput.type === 'password' ? 'text' : 'password';
    };

    // Close handlers
    const closeModal = () => {
      backdrop.remove();
    };
    modal.querySelector('.cs-close-modal').onclick = closeModal;
    modal.querySelector('#cs-btn-cancel').onclick = closeModal;

    const quickScan = modal.querySelector('#cs-modal-quick-scan');
    if (quickScan) {
      quickScan.onclick = () => {
        closeModal();
        openDiscoveryModal();
      };
    }

    // Test Ping handler
    const pingStatus = modal.querySelector('#cs-ping-status');
    modal.querySelector('#cs-btn-test').onclick = async () => {
      const url = modal.querySelector('#cs-inp-url').value.trim().replace(/\/$/, '');
      const keyId = modal.querySelector('#cs-inp-key').value.trim();
      const secret = modal.querySelector('#cs-inp-secret').value.trim();
      const isRW = modal.querySelector('#cs-chk-rw').checked;

      if (!url) {
        alert('Введите URL агента!');
        return;
      }

      pingStatus.style.display = 'block';
      pingStatus.style.background = 'rgba(255,255,255,0.05)';
      pingStatus.style.color = '#c9d1d9';
      pingStatus.textContent = t('pingTesting', 'Проверка подключения...');

      const start = performance.now();
      try {
        let authHeader = `Bearer ${keyId}`;
        if (isRW && secret) {
          const otp = await generateTOTPWebCrypto(secret);
          authHeader = `Bearer ${keyId}:${otp}`;
        }

        const res = await fetch(`/api/remote-proxy/api/status`, {
          method: 'GET',
          headers: {
            'X-ConfigStudio-Web': '1',
            'Authorization': authHeader,
            'X-Remote-Target': url
          },
          signal: AbortSignal.timeout(5000)
        });

        const elapsed = Math.round(performance.now() - start);
        if (res.ok) {
          const data = await res.json();
          pingStatus.style.background = 'rgba(63, 185, 80, 0.15)';
          pingStatus.style.color = '#3fb950';
          pingStatus.style.border = '1px solid rgba(63, 185, 80, 0.3)';
          pingStatus.innerHTML = `✓ Связь установлена (${elapsed} ms) • Режим: <b>${data.accessLevel === 'read_write' ? 'Read-Write (Admin)' : 'Read-Only'}</b> (v${data.version})`;
        } else {
          const err = await res.text();
          pingStatus.style.background = 'rgba(248, 81, 73, 0.15)';
          pingStatus.style.color = '#f85149';
          pingStatus.style.border = '1px solid rgba(248, 81, 73, 0.3)';
          pingStatus.textContent = `Ошибка проверки (HTTP ${res.status}): ${err}`;
        }
      } catch (e) {
        pingStatus.style.background = 'rgba(248, 81, 73, 0.15)';
        pingStatus.style.color = '#f85149';
        pingStatus.style.border = '1px solid rgba(248, 81, 73, 0.3)';
        pingStatus.textContent = `Не удалось связаться с агентом: ${e.message}`;
      }
    };

    // Save handler
    modal.querySelector('#cs-btn-save').onclick = async () => {
      const name = modal.querySelector('#cs-inp-name').value.trim() || 'Remote VPS';
      const url = modal.querySelector('#cs-inp-url').value.trim().replace(/\/$/, '');
      const keyId = modal.querySelector('#cs-inp-key').value.trim();
      const secret = modal.querySelector('#cs-inp-secret').value.trim();
      const isRW = modal.querySelector('#cs-chk-rw').checked;

      if (!url) {
        alert('Укажите URL агента!');
        return;
      }

      if (isEdit) {
        editServer.name = name;
        editServer.url = url;
        editServer.keyId = keyId;
        editServer.secret = secret;
        editServer.isRW = isRW;
        await saveServerSecretToVault(editServer);
        saveServers();
        window.ConfigStudio.showNotification(t('serverUpdated', `Настройки сервера ${name} обновлены`, { name }), 'success');
      } else {
        const newServer = {
          id: 'srv_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
          name,
          url,
          keyId,
          secret,
          isRW,
          status: 'unknown',
          pingMs: null
        };
        servers.push(newServer);
        await saveServerSecretToVault(newServer);
        saveServers();
        window.ConfigStudio.showNotification(t('serverAdded', `Сервер ${name} успешно подключен!`, { name }), 'success');
        selectServer(newServer.id);
      }

      closeModal();
      if (updateHeaderUI) updateHeaderUI();
    };
  }

  // ==========================================================================
  // 4. Modal: Scoped Telemetry Tokens Management
  // ==========================================================================
  async function openTokensModal() {
    const srv = servers.find(s => s.id === activeServerId);
    if (!srv) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'cs-remote-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'cs-remote-modal-content';
    modal.style.maxWidth = '540px';

    modal.innerHTML = `
      <div class="cs-remote-modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 16px;">🛡️</span>
          <span style="font-weight: 600; font-size: 14px; color: #fff;">Токены мониторинга (${srv.name})</span>
        </div>
        <button class="cs-close-modal" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 16px;">✕</button>
      </div>

      <div class="cs-remote-modal-body">
        <p style="font-size: 12px; color: #8b949e; margin: 0;">
          Изолированные Read-Only токены для Prometheus, Zabbix, Grafana или CI/CD. Имеют доступ только к выбранным топикам и не могут изменить файлы.
        </p>

        <!-- New Token Form -->
        <div style="padding: 12px; background: rgba(0,0,0,0.3); border: 1px solid #30363d; border-radius: 10px; display: flex; flex-direction: column; gap: 10px;">
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #00d2b4;">+ Создать токен мониторинга</div>
          <div style="display: flex; gap: 8px;">
            <input type="text" id="cs-new-tok-id" class="cs-remote-input" placeholder="ID (например: prometheus)">
            <input type="text" id="cs-new-tok-desc" class="cs-remote-input" placeholder="Описание">
          </div>
          <div style="display: flex; gap: 16px; font-size: 12px; color: #c9d1d9;">
            <label style="cursor: pointer;"><input type="checkbox" id="top-metrics" checked style="accent-color: #00d2b4;"> metrics (Prometheus)</label>
            <label style="cursor: pointer;"><input type="checkbox" id="top-health" checked style="accent-color: #00d2b4;"> health (Uptime)</label>
          </div>
          <button type="button" id="cs-btn-create-tok" class="cs-remote-btn cs-remote-btn-primary" style="align-self: flex-start; padding: 6px 12px; font-size: 11px;">Сгенерировать токен</button>
        </div>

        <!-- Token list container -->
        <div id="cs-tokens-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto;">
          <div style="text-align: center; color: #8b949e; padding: 10px; font-size: 12px;">Загрузка списка токенов...</div>
        </div>
      </div>

      <div style="padding: 12px 20px; border-top: 1px solid #21262d; display: flex; justify-content: flex-end; background: rgba(0,0,0,0.2);">
        <button type="button" class="cs-remote-btn cs-remote-btn-secondary cs-close-modal">Закрыть</button>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    modal.querySelectorAll('.cs-close-modal').forEach(btn => btn.onclick = () => backdrop.remove());

    const listContainer = modal.querySelector('#cs-tokens-list');

    async function loadTokens() {
      listContainer.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 10px; font-size: 12px;">Загрузка списка токенов...</div>';
      try {
        let authHeader = `Bearer ${srv.keyId}`;
        if (srv.isRW && srv.secret) {
          const otp = await generateTOTPWebCrypto(srv.secret);
          authHeader = `Bearer ${srv.keyId}:${otp}`;
        }

        const res = await fetch(`/api/remote-proxy/api/tokens`, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'X-Remote-Target': srv.url
          }
        });

        if (res.ok) {
          const data = await res.json();
          renderTokens(data.tokens || []);
        } else {
          listContainer.innerHTML = `<div style="color: #f85149; font-size: 12px;">Не удалось загрузить токены: HTTP ${res.status}</div>`;
        }
      } catch (e) {
        listContainer.innerHTML = `<div style="color: #f85149; font-size: 12px;">Ошибка связи: ${e.message}</div>`;
      }
    }

    function renderTokens(tokens) {
      if (tokens.length === 0) {
        listContainer.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 10px; font-size: 12px;">Нет созданных токенов мониторинга</div>';
        return;
      }
      listContainer.innerHTML = '';
      tokens.forEach(tok => {
        const item = document.createElement('div');
        item.style.cssText = 'padding: 8px 10px; background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; font-size: 12px;';
        item.innerHTML = `
          <div style="min-width: 0; display: flex; flex-direction: column; gap: 2px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-weight: 600; color: #e6edf3;">${tok.id}</span>
              <span class="cs-remote-badge ro">${(tok.topics || []).join(', ')}</span>
            </div>
            <div style="font-family: monospace; font-size: 11px; color: #8b949e;">${tok.token}</div>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="cs-copy-tok" style="background: none; border: 1px solid #30363d; border-radius: 6px; padding: 3px 8px; font-size: 11px; color: #00d2b4; cursor: pointer;">Копировать</button>
            <button class="cs-del-tok" style="background: none; border: 1px solid rgba(248,81,73,0.4); border-radius: 6px; padding: 3px 8px; font-size: 11px; color: #f85149; cursor: pointer;">Удалить</button>
          </div>
        `;

        item.querySelector('.cs-copy-tok').onclick = () => {
          navigator.clipboard.writeText(tok.token);
          window.ConfigStudio.showNotification('Токен скопирован в буфер обмена!', 'success');
        };

        item.querySelector('.cs-del-tok').onclick = async () => {
          if (confirm(`Удалить токен ${tok.id}?`)) {
            let authHeader = `Bearer ${srv.keyId}`;
            if (srv.isRW && srv.secret) {
              const otp = await generateTOTPWebCrypto(srv.secret);
              authHeader = `Bearer ${srv.keyId}:${otp}`;
            }
            await fetch(`/api/remote-proxy/api/tokens/${encodeURIComponent(tok.id)}`, {
              method: 'DELETE',
              headers: {
                'Authorization': authHeader,
                'X-Remote-Target': srv.url
              }
            });
            loadTokens();
          }
        };

        listContainer.appendChild(item);
      });
    }

    // Create token click
    modal.querySelector('#cs-btn-create-tok').onclick = async () => {
      const id = modal.querySelector('#cs-new-tok-id').value.trim();
      const desc = modal.querySelector('#cs-new-tok-desc').value.trim();
      const topics = [];
      if (modal.querySelector('#top-metrics').checked) topics.push('metrics');
      if (modal.querySelector('#top-health').checked) topics.push('health');

      if (!id) {
        alert('Укажите ID токена (например: prometheus)');
        return;
      }

      let authHeader = `Bearer ${srv.keyId}`;
      if (srv.isRW && srv.secret) {
        const otp = await generateTOTPWebCrypto(srv.secret);
        authHeader = `Bearer ${srv.keyId}:${otp}`;
      }

      const res = await fetch(`/api/remote-proxy/api/tokens`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'X-Remote-Target': srv.url
        },
        body: JSON.stringify({ id, description: desc, topics })
      });

      if (res.ok) {
        window.ConfigStudio.showNotification(`Токен ${id} создан!`, 'success');
        modal.querySelector('#cs-new-tok-id').value = '';
        modal.querySelector('#cs-new-tok-desc').value = '';
        loadTokens();
      } else {
        const err = await res.text();
        alert('Ошибка создания токена: ' + err);
      }
    };

    loadTokens();
  }

  // ==========================================================================
  // 5. Register in Global Settings Tab
  // ==========================================================================
  if (typeof window.ConfigStudio.registerPluginSettings === 'function') {
    window.ConfigStudio.registerPluginSettings(pluginId, {
      render: (container) => {
        container.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h3 style="font-size: 14px; font-weight: 600; color: #fff; margin: 0;">Удаленные серверы (Fleet Management)</h3>
                <p style="font-size: 12px; color: #8b949e; margin: 4px 0 0 0;">Подключенные экземпляры серверов с двухсоставной TOTP защитой</p>
              </div>
              <div style="display: flex; gap: 8px;">
                <button id="cs-settings-scan-srv" class="cs-remote-btn cs-remote-btn-secondary">🔍 Поиск в LAN</button>
                <button id="cs-settings-add-srv" class="cs-remote-btn cs-remote-btn-primary">+ Добавить сервер</button>
              </div>
            </div>
            <div id="cs-settings-srv-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
          </div>
        `;

        container.querySelector('#cs-settings-scan-srv').onclick = () => openDiscoveryModal();
        container.querySelector('#cs-settings-add-srv').onclick = () => openServerModal(null);

        const list = container.querySelector('#cs-settings-srv-list');
        if (servers.length === 0) {
          list.innerHTML = '<div style="padding: 16px; text-align: center; color: #8b949e; font-size: 12px; background: rgba(0,0,0,0.2); border-radius: 8px;">Нет добавленных серверов. Нажмите «+ Добавить сервер».</div>';
        } else {
          servers.forEach(srv => {
            const card = document.createElement('div');
            card.style.cssText = 'padding: 12px; background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 10px; display: flex; justify-content: space-between; align-items: center;';
            card.innerHTML = `
              <div>
                <div style="font-weight: 600; color: #fff; font-size: 13px;">${srv.name}</div>
                <div style="font-size: 11px; color: #8b949e; font-family: monospace;">${srv.url} • Key: ${srv.keyId} • ${srv.isRW ? 'RW (TOTP)' : 'RO'}</div>
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="cs-cfg-edit cs-remote-btn cs-remote-btn-secondary" style="padding: 4px 10px; font-size: 11px;">Редактировать</button>
                <button class="cs-cfg-del cs-remote-btn cs-remote-btn-danger" style="padding: 4px 10px; font-size: 11px;">Удалить</button>
              </div>
            `;
            card.querySelector('.cs-cfg-edit').onclick = () => openServerModal(srv);
            card.querySelector('.cs-cfg-del').onclick = () => {
              if (confirm(`Удалить ${srv.name}?`)) {
                deleteServer(srv.id);
                card.remove();
              }
            };
            list.appendChild(card);
          });
        }
      }
    });
  }

  // ==========================================================================
  // Context Menu Integration: Send File to Remote Agent or Localhost
  // ==========================================================================
  async function sendFileToAgent(srv, filename, content, targetDir = '/opt/test') {
    let authHeader = `Bearer ${srv.keyId}`;
    if (srv.isRW && srv.secret) {
      const otp = await generateTOTPWebCrypto(srv.secret);
      authHeader = `Bearer ${srv.keyId}:${otp}`;
    }

    const cleanDir = targetDir.replace(/\/+$/, '') || '/';
    const fullRemotePath = cleanDir === '/' ? `/${filename}` : `${cleanDir}/${filename}`;

    const res = await fetch('/api/remote-proxy/api/fs/file', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'X-Remote-Target': srv.url,
        'X-ConfigStudio-Web': '1',
      },
      body: JSON.stringify({
        path: fullRemotePath,
        content: content,
        force: true,
      }),
    });

    if (res.ok) {
      localStorage.setItem('cs_agent_last_dir_' + srv.id, cleanDir);
      window.ConfigStudio.showNotification?.(
        `✅ Файл "${filename}" успешно передан в папку "${fullRemotePath}" агента "${srv.name || srv.url}"!`,
        'success'
      );
      try {
        if (typeof window.ConfigStudio?.refreshTree === 'function') {
          window.ConfigStudio.refreshTree();
        }
      } catch (_) {}
    } else {
      const err = await res.text();
      let msg = err;
      try {
        const parsed = JSON.parse(err);
        if (parsed.error) msg = parsed.error;
      } catch (_) {}
      alert('Ошибка отправки файла на агент: ' + msg);
      throw new Error(msg);
    }
  }

  async function sendFileToLocalhost(filename, content, targetDir = '') {
    const cleanDir = targetDir.replace(/^\/+/, '').replace(/\/+$/, '');
    const localRelPath = cleanDir ? `${cleanDir}/${filename}` : filename;

    const res = await fetch('/api/fs/file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ConfigStudio-Web': '1',
      },
      body: JSON.stringify({
        path: localRelPath,
        content: content,
        force: true,
      }),
    });

    if (res.ok) {
      localStorage.setItem('cs_agent_last_dir_local', cleanDir);
      window.ConfigStudio.showNotification?.(
        `✅ Файл "${filename}" успешно сохранен на локальный хост в "${localRelPath || '/'}"!`,
        'success'
      );
      try {
        if (typeof window.ConfigStudio?.refreshTree === 'function') {
          window.ConfigStudio.refreshTree();
        }
      } catch (_) {}
    } else {
      const err = await res.text();
      let msg = err;
      try {
        const parsed = JSON.parse(err);
        if (parsed.error) msg = parsed.error;
      } catch (_) {}
      alert('Ошибка сохранения файла на локальный хост: ' + msg);
      throw new Error(msg);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function openSelectAgentModal(filename, content, preselectedServer) {
    const modal = document.createElement('div');
    modal.className = 'cs-remote-modal-backdrop';

    let workspacesList = [];
    try {
      const wsRes = await fetch('/api/workspaces', { headers: { 'X-ConfigStudio-Web': '1' } });
      if (wsRes.ok) {
        const wsData = await wsRes.json();
        workspacesList = Array.isArray(wsData) ? wsData : (wsData.workspaces || []);
      }
    } catch (_) {}

    // Form list of available destination targets (excluding current active instance)
    const availableTargets = [];
    if (activeServerId === 'local') {
      // Currently on Localhost -> destinations are all remote agents
      servers.forEach(s => {
        availableTargets.push({
          id: s.id,
          name: s.name || s.url,
          label: `🌐 ${s.name || s.url} (${s.url})`,
          isLocal: false,
          server: s,
        });
      });
    } else {
      // Currently on a Remote Agent -> destinations are:
      // 1. Localhost (Host)
      availableTargets.push({
        id: 'local',
        name: 'Localhost',
        label: '🖥️ Localhost (Основной хост)',
        isLocal: true,
        server: null,
      });
      // 2. Any other remote agents (peers)
      servers.filter(s => s.id !== activeServerId).forEach(s => {
        availableTargets.push({
          id: s.id,
          name: s.name || s.url,
          label: `🌐 ${s.name || s.url} (${s.url})`,
          isLocal: false,
          server: s,
        });
      });
    }

    if (availableTargets.length === 0) {
      window.ConfigStudio.showNotification?.('Нет доступных целевых серверов для отправки.', 'info');
      return;
    }

    function getSuggestedDir(target) {
      if (!target) return '';
      if (target.isLocal) {
        return localStorage.getItem('cs_agent_last_dir_local') || '';
      }
      const srv = target.server;
      if (!srv) return '/opt/test';
      const lastDir = localStorage.getItem('cs_agent_last_dir_' + srv.id);
      if (lastDir) return lastDir;
      if (srv.defaultDir) return srv.defaultDir;
      const matchedWs = workspacesList.find(w => w.server && srv.url && (w.server.replace(/\/+$/, '') === srv.url.replace(/\/+$/, '')));
      if (matchedWs && matchedWs.path) return matchedWs.path;
      return '/opt/test';
    }

    let currentSelectedTarget = null;
    if (preselectedServer && availableTargets.find(t => t.id === preselectedServer.id)) {
      currentSelectedTarget = availableTargets.find(t => t.id === preselectedServer.id);
    } else {
      currentSelectedTarget = availableTargets[0];
    }

    let serverOptions = availableTargets.map(t => `
      <option value="${t.id}" ${currentSelectedTarget && currentSelectedTarget.id === t.id ? 'selected' : ''}>
        ${escapeHtml(t.label)}
      </option>
    `).join('');

    const initialDir = getSuggestedDir(currentSelectedTarget);
    const initialPlaceholder = currentSelectedTarget.isLocal ? 'Корень рабочей области (или подпапка)' : '/opt/test';
    const initialLabel = currentSelectedTarget.isLocal ? 'Рабочая папка назначения на хосте (Localhost)' : 'Рабочая папка назначения на агенте';

    modal.innerHTML = `
      <div class="cs-remote-modal-content" style="max-width: 520px;">
        <div class="cs-remote-modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">🚀</span>
            <span style="font-weight: 600; font-size: 14px; color: #e6edf3;">Отправить файл на узел / хост</span>
          </div>
          <button class="cs-remote-btn-close" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 16px;">✕</button>
        </div>
        <div class="cs-remote-modal-body">
          <div class="cs-remote-input-group">
            <label class="cs-remote-label">Файл для отправки</label>
            <input class="cs-remote-input" value="${escapeHtml(filename)}" readonly style="opacity: 0.7;" />
          </div>
          <div class="cs-remote-input-group">
            <label class="cs-remote-label">Целевой узел назначения</label>
            <select class="cs-remote-input" id="cs-agent-target-select">${serverOptions}</select>
          </div>
          <div class="cs-remote-input-group">
            <label class="cs-remote-label" id="cs-agent-dest-dir-label">${escapeHtml(initialLabel)}</label>
            <div style="display: flex; gap: 8px;">
              <input class="cs-remote-input" id="cs-agent-dest-dir" value="${escapeHtml(initialDir)}" placeholder="${escapeHtml(initialPlaceholder)}" style="flex: 1;" />
              <button class="cs-remote-btn cs-remote-btn-secondary" id="cs-agent-browse-btn" type="button" title="Выбрать папку">📂 Обзор...</button>
            </div>
            <div id="cs-agent-folder-picker" style="display: none;" class="cs-remote-folder-picker">
              <div id="cs-agent-picker-crumbs" class="cs-remote-breadcrumbs"></div>
              <div id="cs-agent-picker-items" style="display: flex; flex-direction: column; gap: 2px;"></div>
            </div>
          </div>
          <div class="cs-remote-input-group">
            <label class="cs-remote-label">Имя файла на целевом узле</label>
            <input class="cs-remote-input" id="cs-agent-dest-filename" value="${escapeHtml(filename)}" />
          </div>
        </div>
        <div style="padding: 16px 20px; border-top: 1px solid #21262d; display: flex; justify-content: flex-end; gap: 10px;">
          <button class="cs-remote-btn cs-remote-btn-secondary" id="cs-agent-cancel">Отмена</button>
          <button class="cs-remote-btn cs-remote-btn-primary" id="cs-agent-submit">🚀 Отправить</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    const closeModal = () => modal.remove();
    modal.querySelector('.cs-remote-btn-close').onclick = closeModal;
    modal.querySelector('#cs-agent-cancel').onclick = closeModal;

    const select = modal.querySelector('#cs-agent-target-select');
    const destDirLabel = modal.querySelector('#cs-agent-dest-dir-label');
    const destDirInput = modal.querySelector('#cs-agent-dest-dir');
    const destFilenameInput = modal.querySelector('#cs-agent-dest-filename');
    const browseBtn = modal.querySelector('#cs-agent-browse-btn');
    const pickerContainer = modal.querySelector('#cs-agent-folder-picker');
    const pickerCrumbs = modal.querySelector('#cs-agent-picker-crumbs');
    const pickerItems = modal.querySelector('#cs-agent-picker-items');
    const submitBtn = modal.querySelector('#cs-agent-submit');

    select.onchange = () => {
      const target = availableTargets.find(t => t.id === select.value);
      if (target) {
        destDirLabel.textContent = target.isLocal
          ? 'Рабочая папка назначения на хосте (Localhost)'
          : 'Рабочая папка назначения на агенте';
        destDirInput.value = getSuggestedDir(target);
        destDirInput.placeholder = target.isLocal ? 'Корень рабочей области (или подпапка)' : '/opt/test';
        if (pickerActive) {
          loadFolderPicker(destDirInput.value || (target.isLocal ? '' : '/'));
        }
      }
    };

    let pickerActive = false;
    browseBtn.onclick = () => {
      pickerActive = !pickerActive;
      pickerContainer.style.display = pickerActive ? 'block' : 'none';
      if (pickerActive) {
        const curTarget = availableTargets.find(t => t.id === select.value);
        loadFolderPicker(destDirInput.value.trim() || (curTarget?.isLocal ? '' : '/'));
      }
    };

    async function loadFolderPicker(dirPath) {
      const target = availableTargets.find(t => t.id === select.value);
      if (!target) return;
      pickerItems.innerHTML = '<div style="color: #8b949e; font-size: 11px; padding: 4px;">Загрузка папок...</div>';

      try {
        let res;
        if (target.isLocal) {
          const cleanLocalPath = (dirPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
          const query = cleanLocalPath ? `?path=${encodeURIComponent(cleanLocalPath)}` : '';
          res = await fetch(`/api/fs/tree${query}`, {
            headers: { 'X-ConfigStudio-Web': '1' }
          });
        } else {
          const srv = target.server;
          let authHeader = `Bearer ${srv.keyId}`;
          if (srv.isRW && srv.secret) {
            const otp = await generateTOTPWebCrypto(srv.secret);
            authHeader = `Bearer ${srv.keyId}:${otp}`;
          }

          res = await fetch(`/api/remote-proxy/api/fs/tree?path=${encodeURIComponent(dirPath || '/')}`, {
            headers: {
              'Authorization': authHeader,
              'X-Remote-Target': srv.url,
              'X-ConfigStudio-Web': '1'
            }
          });
        }

        if (!res.ok) {
          pickerItems.innerHTML = `<div style="color: #ff7b72; font-size: 11px; padding: 4px;">Ошибка: HTTP ${res.status}</div>`;
          return;
        }

        const data = await res.json();
        const items = data.items || [];
        const dirs = items.filter(i => i.isDir);

        pickerCrumbs.innerHTML = '';
        pickerItems.innerHTML = '';

        if (target.isLocal) {
          const cleanLocal = (dirPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
          const parts = cleanLocal ? cleanLocal.split('/') : [];

          // Root crumb for localhost
          const rootCrumb = document.createElement('span');
          rootCrumb.className = 'cs-remote-crumb';
          rootCrumb.textContent = '📁 [Корень]';
          rootCrumb.onclick = () => {
            destDirInput.value = '';
            loadFolderPicker('');
          };
          pickerCrumbs.appendChild(rootCrumb);

          let curAcc = '';
          parts.forEach(p => {
            curAcc += (curAcc ? '/' : '') + p;
            const linkPath = curAcc;
            const crumb = document.createElement('span');
            crumb.className = 'cs-remote-crumb';
            crumb.textContent = p;
            crumb.onclick = () => {
              destDirInput.value = linkPath;
              loadFolderPicker(linkPath);
            };
            pickerCrumbs.appendChild(crumb);
          });

          if (parts.length > 0) {
            const upDiv = document.createElement('div');
            upDiv.className = 'cs-remote-folder-item';
            upDiv.innerHTML = '<span>⬆️</span> <span>[ Наверх ]</span>';
            upDiv.onclick = () => {
              const parentDir = parts.slice(0, -1).join('/');
              destDirInput.value = parentDir;
              loadFolderPicker(parentDir);
            };
            pickerItems.appendChild(upDiv);
          }

          if (dirs.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.style.cssText = 'color: #8b949e; font-size: 11px; padding: 4px;';
            emptyDiv.textContent = 'Подпапок нет';
            pickerItems.appendChild(emptyDiv);
          } else {
            dirs.forEach(d => {
              const folderDiv = document.createElement('div');
              folderDiv.className = 'cs-remote-folder-item';
              folderDiv.innerHTML = `<span>📁</span> <span>${escapeHtml(d.name)}</span>`;
              folderDiv.onclick = () => {
                const newPath = cleanLocal ? `${cleanLocal}/${d.name}` : d.name;
                destDirInput.value = newPath;
                loadFolderPicker(newPath);
              };
              pickerItems.appendChild(folderDiv);
            });
          }
        } else {
          // Remote Agent folder browsing
          const cleanDir = (dirPath || '/').replace(/\/+$/, '') || '/';
          const parts = cleanDir === '/' ? [''] : cleanDir.split('/');
          let accPath = '';
          parts.forEach((part, idx) => {
            if (idx === 0) {
              accPath = '/';
            } else {
              accPath += (accPath === '/' ? '' : '/') + part;
            }
            const crumb = document.createElement('span');
            crumb.className = 'cs-remote-crumb';
            crumb.textContent = part || '/';
            const p = accPath;
            crumb.onclick = () => {
              destDirInput.value = p;
              loadFolderPicker(p);
            };
            pickerCrumbs.appendChild(crumb);
          });

          if (cleanDir !== '/') {
            const upDiv = document.createElement('div');
            upDiv.className = 'cs-remote-folder-item';
            upDiv.innerHTML = '<span>⬆️</span> <span>[ Наверх ]</span>';
            upDiv.onclick = () => {
              const parentDir = cleanDir.substring(0, cleanDir.lastIndexOf('/')) || '/';
              destDirInput.value = parentDir;
              loadFolderPicker(parentDir);
            };
            pickerItems.appendChild(upDiv);
          }

          if (dirs.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.style.cssText = 'color: #8b949e; font-size: 11px; padding: 4px;';
            emptyDiv.textContent = 'Подпапок нет';
            pickerItems.appendChild(emptyDiv);
          } else {
            dirs.forEach(d => {
              const folderDiv = document.createElement('div');
              folderDiv.className = 'cs-remote-folder-item';
              folderDiv.innerHTML = `<span>📁</span> <span>${escapeHtml(d.name)}</span>`;
              folderDiv.onclick = () => {
                const newPath = cleanDir === '/' ? `/${d.name}` : `${cleanDir}/${d.name}`;
                destDirInput.value = newPath;
                loadFolderPicker(newPath);
              };
              pickerItems.appendChild(folderDiv);
            });
          }
        }
      } catch (e) {
        pickerItems.innerHTML = `<div style="color: #ff7b72; font-size: 11px; padding: 4px;">Ошибка: ${escapeHtml(e.message)}</div>`;
      }
    }

    submitBtn.onclick = async () => {
      const target = availableTargets.find(t => t.id === select.value);
      if (!target) return;
      const targetDir = destDirInput.value.trim();
      const targetFilename = destFilenameInput.value.trim() || filename;

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Отправка...';

      try {
        if (target.isLocal) {
          await sendFileToLocalhost(targetFilename, content, targetDir);
        } else {
          await sendFileToAgent(target.server, targetFilename, content, targetDir || '/opt/test');
        }
        closeModal();
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = '🚀 Отправить';
      }
    };
  }

  if (typeof window.ConfigStudio.registerContextMenu === 'function') {
    window.ConfigStudio.registerContextMenu({
      id: 'remote-agent-send-file',
      pluginId: pluginId,
      label: '🚀 Отправить на узел / агент (Remote Agent)',
      icon: 'server',
      group: 'tools',
      order: 25,
      targetType: 'file',
      onClick: async (target) => {
        if (activeServerId === 'local' && servers.length === 0) {
          window.ConfigStudio.showNotification('Нет подключенных серверов-агентов. Сначала добавьте сервер в шапке.', 'error');
          openServerModal(null);
          return;
        }

        let content = '';
        try {
          const rootParam = target.root ? `&root=${encodeURIComponent(target.root)}` : '';
          let fileRes;
          if (activeServerId !== 'local') {
            const currentSrv = servers.find(s => s.id === activeServerId);
            if (currentSrv) {
              let authHeader = `Bearer ${currentSrv.keyId}`;
              if (currentSrv.isRW && currentSrv.secret) {
                const otp = await generateTOTPWebCrypto(currentSrv.secret);
                authHeader = `Bearer ${currentSrv.keyId}:${otp}`;
              }
              fileRes = await fetch(`/api/remote-proxy/api/fs/file?path=${encodeURIComponent(target.path)}${rootParam}`, {
                headers: {
                  'Authorization': authHeader,
                  'X-Remote-Target': currentSrv.url,
                  'X-ConfigStudio-Web': '1'
                }
              });
            }
          }
          if (!fileRes) {
            fileRes = await fetch(`/api/fs/file?path=${encodeURIComponent(target.path)}${rootParam}`, {
              headers: { 'X-ConfigStudio-Web': '1' }
            });
          }
          if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
          const fileData = await fileRes.json();
          content = fileData.content !== undefined ? fileData.content : '';
        } catch (e) {
          const activeFile = window.ConfigStudio.getActiveFile?.();
          if (activeFile && (activeFile.path === target.path || activeFile.name === target.name)) {
            content = window.ConfigStudio.getActiveContent?.() || activeFile.content || '';
          } else {
            alert('Ошибка чтения исходного файла: ' + e.message);
            return;
          }
        }

        openSelectAgentModal(target.name, content, null);
      }
    });
  }

  // Initialize Vault hydration in background
  hydrateSecretsFromVault().catch(e => console.warn('[RemoteAgent] Error hydrating secrets from Vault:', e));

  console.log(`[RemoteAgent v2.0] Initialized with ${servers.length} servers (Active: ${activeServerId}).`);
})();
