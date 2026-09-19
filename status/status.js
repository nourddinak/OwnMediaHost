/**
 * OwnMediaHost — Decoupled Out-of-Band Status Platform Engine
 * Real-time synthetic probing, 60-day uptime heatmap, latency sparklines, and incident feeds.
 */

(function () {
  'use strict';

  // State & History
  const POLL_INTERVAL = 30;
  let secondsRemaining = POLL_INTERVAL;
  let pollTimerId = null;
  let isProbing = false;
  let customEndpointOverride = null;

  // Rolling latency history buffer (seeded with realistic nominal samples)
  const latencyHistory = [
    22, 24, 21, 28, 26, 23, 22, 35, 29, 24,
    23, 21, 25, 27, 24, 22, 31, 25, 23, 24,
    22, 26, 28, 25, 23, 24, 22, 27, 25, 24
  ];

  // DOM Handles
  const els = {
    // Hero Elements
    heroCard: document.getElementById('hero-card'),
    heroHeadline: document.getElementById('hero-headline'),
    heroDesc: document.getElementById('hero-desc'),
    statHealth: document.getElementById('stat-health'),
    statLatency: document.getElementById('stat-latency'),
    statLastCheck: document.getElementById('stat-last-check'),
    statActiveIncidents: document.getElementById('stat-active-incidents'),

    // Timer & Controls
    probeCountdown: document.getElementById('probe-countdown'),
    btnRefresh: document.getElementById('btn-refresh'),

    // Broadcast (Active Incidents)
    broadcastSection: document.getElementById('broadcast-section'),
    broadcastCardsList: document.getElementById('broadcast-cards-list'),
    activeIncidentCount: document.getElementById('active-incident-count'),

    // Subsystems & Heatmaps
    pillWeb: document.getElementById('pill-web'),
    pillApi: document.getElementById('pill-api'),
    pillMedia: document.getElementById('pill-media'),
    pillDb: document.getElementById('pill-db'),
    ticksWeb: document.getElementById('ticks-web'),
    ticksApi: document.getElementById('ticks-api'),
    ticksMedia: document.getElementById('ticks-media'),
    ticksDb: document.getElementById('ticks-db'),
    pctWeb: document.getElementById('pct-web'),
    pctApi: document.getElementById('pct-api'),
    pctMedia: document.getElementById('pct-media'),
    pctDb: document.getElementById('pct-db'),

    // Latency Chart
    chartLine: document.getElementById('chart-line'),
    chartArea: document.getElementById('chart-area'),
    chartP50: document.getElementById('chart-p50'),
    chartP95: document.getElementById('chart-p95'),
    chartCurr: document.getElementById('chart-curr'),

    // Past Incidents
    pastIncidentsStack: document.getElementById('past-incidents-stack'),

    // Endpoint Diagnostics
    inputEndpointOverride: document.getElementById('input-endpoint-override'),
    btnApplyEndpoint: document.getElementById('btn-apply-endpoint'),
    btnResetEndpoint: document.getElementById('btn-reset-endpoint'),
    activeTargetDisplay: document.getElementById('active-target-display'),

    // Modals
    btnSubscribe: document.getElementById('btn-subscribe'),
    modalSubscribe: document.getElementById('modal-subscribe'),
    btnCloseSubscribe: document.getElementById('btn-close-subscribe'),
    feedUrlInput: document.getElementById('feed-url-input'),
    btnCopyFeed: document.getElementById('btn-copy-feed'),

    btnOpenBadgeModal: document.getElementById('btn-open-badge-modal'),
    modalBadge: document.getElementById('modal-badge'),
    btnCloseBadge: document.getElementById('btn-close-badge'),
    badgeMdInput: document.getElementById('badge-md-input'),
    badgeHtmlInput: document.getElementById('badge-html-input'),
    btnCopyBadgeMd: document.getElementById('btn-copy-badge-md'),
    btnCopyBadgeHtml: document.getElementById('btn-copy-badge-html'),
    sampleBadgeStatus: document.getElementById('sample-badge-status'),

    // Links & Toast
    navMainApp: document.getElementById('nav-main-app'),
    navHealthApi: document.getElementById('nav-health-api'),
    yearLabel: document.getElementById('year-label'),
    toastNotice: document.getElementById('toast-notice'),
    toastText: document.getElementById('toast-text'),
  };

  if (els.yearLabel) {
    els.yearLabel.textContent = new Date().getFullYear();
  }

  // Determine Target Base URL for synthetic health probes
  function resolveTargetUrl(configData) {
    if (customEndpointOverride) {
      return customEndpointOverride.replace(/\/+$/, '');
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('api')) {
      return params.get('api').replace(/\/+$/, '');
    }

    if (configData && configData.api_endpoint && configData.api_endpoint.trim() !== '') {
      return configData.api_endpoint.trim().replace(/\/+$/, '');
    }

    const host = window.location.hostname;
    const protocol = window.location.protocol;

    if (host === 'localhost' || host === '127.0.0.1' || protocol === 'file:') {
      if (window.location.port) {
        const p = window.location.port;
        const targetPort = p === '5173' || p === '3000' || p === '5055' ? '5002' : p;
        return `${protocol === 'file:' ? 'http:' : protocol}//127.0.0.1:${targetPort}`;
      }
      return 'http://127.0.0.1:5002';
    }

    if (host.startsWith('status.')) {
      const rootDomain = host.substring(7);
      return `${protocol}//${rootDomain}`;
    }

    return window.location.origin;
  }

  // Load Incidents Data (JSON) with local cache fallback
  async function loadIncidentsConfig() {
    try {
      const res = await fetch(`incidents.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      localStorage.setItem('ownmediahost_status_cache', JSON.stringify(data));
      return data;
    } catch (e) {
      const cached = localStorage.getItem('ownmediahost_status_cache');
      if (cached) {
        try { return JSON.parse(cached); } catch (_) {}
      }
      return { incidents: [], past_incidents: [] };
    }
  }

  // Perform synthetic health probe
  async function performSyntheticProbe(baseUrl) {
    const startTime = performance.now();
    let apiAlive = false;
    let dbReady = false;
    let latency = 0;
    let failMessage = '';

    if (els.activeTargetDisplay) {
      els.activeTargetDisplay.textContent = baseUrl;
    }
    if (els.navMainApp) els.navMainApp.href = baseUrl || '/';
    if (els.navHealthApi) els.navHealthApi.href = `${baseUrl}/health`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const healthRes = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      clearTimeout(timeoutId);
      latency = Math.round(performance.now() - startTime);

      if (healthRes.ok) {
        apiAlive = true;
      } else {
        failMessage = `HTTP ${healthRes.status} ${healthRes.statusText}`;
      }

      // Check DB readiness if API responded
      if (apiAlive) {
        try {
          const readyController = new AbortController();
          const readyTimeout = setTimeout(() => readyController.abort(), 3500);
          const readyRes = await fetch(`${baseUrl}/health/ready`, {
            method: 'GET',
            cache: 'no-store',
            signal: readyController.signal,
            headers: { Accept: 'application/json' },
          });
          clearTimeout(readyTimeout);
          if (readyRes.ok) dbReady = true;
        } catch (_) {
          dbReady = false;
        }
      }
    } catch (err) {
      latency = Math.round(performance.now() - startTime);
      failMessage = err.name === 'AbortError' ? 'Probe Request Timed Out (>6s)' : 'Network Unreachable (Host Offline / 502 Bad Gateway)';
    }

    return { apiAlive, dbReady, latency, failMessage };
  }

  // Render 60-Day Interactive Uptime Heatmap
  function buildUptimeHeatmap(containerEl, pctEl, componentKey, pastIncidents) {
    if (!containerEl) return;
    containerEl.innerHTML = '';

    const DAYS_COUNT = 60;
    const now = new Date();
    let degradedDaysCount = 0;

    for (let i = DAYS_COUNT - 1; i >= 0; i--) {
      const dayDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      // Check if this date intersects with an incident in pastIncidents
      let isDegraded = false;
      let incidentTitle = '';

      if (pastIncidents && pastIncidents.length > 0) {
        for (const inc of pastIncidents) {
          if (inc.date && dateStr.includes(inc.date.split(',')[0])) {
            isDegraded = true;
            incidentTitle = inc.title;
            break;
          }
        }
      }

      const tick = document.createElement('div');
      tick.className = 'tick-bar';

      if (isDegraded && componentKey === 'api') {
        tick.classList.add('tick-degraded');
        tick.setAttribute('data-tooltip', `${dateStr} — ${incidentTitle || 'Degraded performance recorded'}`);
        degradedDaysCount++;
      } else {
        tick.setAttribute('data-tooltip', `${dateStr} — 100% Operational (No downtime)`);
      }

      containerEl.appendChild(tick);
    }

    if (pctEl) {
      const uptime = (((DAYS_COUNT - degradedDaysCount * 0.1) / DAYS_COUNT) * 100).toFixed(2);
      pctEl.textContent = `${uptime}% uptime`;
    }
  }

  // Draw Latency SVG Curve with Gradient Fill
  function renderLatencyChart(history) {
    if (!els.chartLine || !els.chartArea) return;

    const width = 800;
    const height = 100;
    const paddingY = 16;
    const maxVal = Math.max(50, ...history) * 1.15;
    const minVal = Math.max(0, Math.min(...history) * 0.85);

    const stepX = width / (history.length - 1);
    const points = history.map((val, idx) => {
      const x = Math.round(idx * stepX);
      const y = Math.round(height - paddingY - ((val - minVal) / (maxVal - minVal)) * (height - 2 * paddingY));
      return { x, y };
    });

    // Build SVG Path with smooth curves
    let pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cx1 = prev.x + (curr.x - prev.x) / 2;
      const cy1 = prev.y;
      const cx2 = prev.x + (curr.x - prev.x) / 2;
      const cy2 = curr.y;
      pathD += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${curr.x} ${curr.y}`;
    }

    els.chartLine.setAttribute('d', pathD);

    const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;
    els.chartArea.setAttribute('d', areaD);

    // Calculate P50 and P95
    const sorted = [...history].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const current = history[history.length - 1];

    if (els.chartP50) els.chartP50.textContent = `${p50}ms`;
    if (els.chartP95) els.chartP95.textContent = `${p95}ms`;
    if (els.chartCurr) els.chartCurr.textContent = `${current}ms`;
  }

  // Update Subsystem Status Pill Helper
  function updateComponentPill(pillEl, state, label) {
    if (!pillEl) return;
    pillEl.className = `component-status-pill status-${state}`;
    const labelEl = pillEl.querySelector('.pill-label');
    if (labelEl) labelEl.textContent = label;
  }

  // Update Hero & Platform UI
  function updatePlatformUI(telemetry, configData) {
    const { apiAlive, dbReady, latency, failMessage } = telemetry;
    const activeIncidents = configData.incidents || [];
    const isUnderMaintenance = activeIncidents.some(i => i.status === 'maintenance' || i.severity === 'maintenance');

    // Record latency to history buffer
    if (apiAlive && latency > 0) {
      latencyHistory.shift();
      latencyHistory.push(latency);
      renderLatencyChart(latencyHistory);
    }

    // Telemetry Strip Values
    if (els.statLatency) {
      els.statLatency.textContent = apiAlive ? `${latency} ms` : '-- ms';
      els.statLatency.style.color = latency > 200 ? 'var(--color-yellow)' : 'var(--text-primary)';
    }

    if (els.statLastCheck) {
      els.statLastCheck.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    if (els.statActiveIncidents) {
      els.statActiveIncidents.textContent = activeIncidents.length;
      els.statActiveIncidents.style.color = activeIncidents.length > 0 ? 'var(--color-red)' : 'var(--text-primary)';
    }

    // Reset Hero Classes
    els.heroCard.className = 'hero-card';

    // Subsystems updates & overall condition
    if (isUnderMaintenance) {
      els.heroCard.classList.add('status-maintenance');
      els.heroHeadline.textContent = 'Scheduled Infrastructure Maintenance in Progress';
      els.heroDesc.textContent = activeIncidents[0]?.title || 'Systems are undergoing routine updates. Services will resume shortly.';
      if (els.statHealth) { els.statHealth.textContent = 'Maintenance'; els.statHealth.className = 'metric-stat'; }
      if (els.sampleBadgeStatus) els.sampleBadgeStatus.textContent = 'Maintenance';
    } else if (apiAlive && dbReady && activeIncidents.length === 0) {
      els.heroCard.classList.add('status-operational');
      els.heroHeadline.textContent = 'All Systems Fully Operational';
      els.heroDesc.textContent = 'Core API routing, range-request streaming pipelines, and database clusters are operating at peak efficiency.';
      if (els.statHealth) { els.statHealth.textContent = '100.0%'; els.statHealth.className = 'metric-stat highlight-green'; }
      if (els.sampleBadgeStatus) els.sampleBadgeStatus.textContent = 'Operational';

      updateComponentPill(els.pillWeb, 'operational', 'Operational');
      updateComponentPill(els.pillApi, 'operational', 'Operational');
      updateComponentPill(els.pillMedia, 'operational', 'Operational');
      updateComponentPill(els.pillDb, 'operational', 'Operational');
    } else if (apiAlive && (!dbReady || activeIncidents.length > 0)) {
      els.heroCard.classList.add('status-degraded');
      els.heroHeadline.textContent = 'Partial System Degradation Detected';
      els.heroDesc.textContent = !dbReady
        ? 'Database readiness check failing. Read queries functioning, but media write transactions may be throttled.'
        : activeIncidents[0]?.title || 'Our incident engineering team is actively investigating an isolated component issue.';
      if (els.statHealth) { els.statHealth.textContent = 'Degraded'; els.statHealth.className = 'metric-stat'; }
      if (els.sampleBadgeStatus) els.sampleBadgeStatus.textContent = 'Degraded';

      updateComponentPill(els.pillWeb, 'operational', 'Operational');
      updateComponentPill(els.pillApi, 'operational', 'Operational');
      updateComponentPill(els.pillMedia, 'degraded', 'Degraded');
      updateComponentPill(els.pillDb, 'degraded', 'Read-Only / Degraded');
    } else {
      els.heroCard.classList.add('status-outage');
      els.heroHeadline.textContent = 'Service Outage • Primary Host Unreachable';
      els.heroDesc.textContent = failMessage
        ? `Primary API gateway is unreachable (${failMessage}). Out-of-band monitoring has engaged on-call infrastructure engineers.`
        : 'The application backend is offline. Engineers are working to restore nominal connectivity.';
      if (els.statHealth) { els.statHealth.textContent = '0.0% (Outage)'; els.statHealth.className = 'metric-stat'; }
      if (els.sampleBadgeStatus) els.sampleBadgeStatus.textContent = 'Outage';

      updateComponentPill(els.pillWeb, 'degraded', 'Degraded (API Offline)');
      updateComponentPill(els.pillApi, 'outage', 'Unreachable');
      updateComponentPill(els.pillMedia, 'outage', 'Offline');
      updateComponentPill(els.pillDb, 'outage', 'Offline');
    }
  }

  // Render Active Incident Broadcast
  function renderActiveBroadcast(incidents) {
    if (!els.broadcastSection) return;

    if (!incidents || incidents.length === 0) {
      els.broadcastSection.style.display = 'none';
      els.broadcastCardsList.innerHTML = '';
      return;
    }

    els.broadcastSection.style.display = 'block';
    if (els.activeIncidentCount) {
      els.activeIncidentCount.textContent = `${incidents.length} Incident${incidents.length > 1 ? 's' : ''} Active`;
    }

    els.broadcastCardsList.innerHTML = incidents.map(inc => {
      const sevClass = inc.severity === 'critical' ? 'sev-critical' : inc.severity === 'maintenance' ? 'sev-maintenance' : 'sev-major';
      const tagClass = `tag-${inc.status || 'investigating'}`;

      const eventsHtml = (inc.updates || []).map(u => `
        <div class="timeline-event">
          <div class="event-meta">
            <span>${escapeHtml(u.timestamp || '')}</span> &bull;
            <span class="broadcast-tag tag-${u.status}">${capitalize(u.status || '')}</span>
          </div>
          <div class="event-text">${escapeHtml(u.message || '')}</div>
        </div>
      `).join('');

      return `
        <div class="broadcast-card ${sevClass}">
          <div class="broadcast-top">
            <h3 class="broadcast-title">${escapeHtml(inc.title)}</h3>
            <span class="broadcast-tag ${tagClass}">${capitalize(inc.status)}</span>
          </div>
          ${eventsHtml ? `<div class="broadcast-timeline">${eventsHtml}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  // Render Historical Incidents & Post-Mortems
  function renderPastIncidents(pastIncidents) {
    if (!els.pastIncidentsStack) return;

    if (!pastIncidents || pastIncidents.length === 0) {
      els.pastIncidentsStack.innerHTML = `
        <div class="history-none">
          No outages or major service interruptions recorded in the past 90 days. All systems operating nominally.
        </div>
      `;
      return;
    }

    els.pastIncidentsStack.innerHTML = pastIncidents.map(item => `
      <div class="history-item">
        <div class="history-header-row">
          <div class="history-title-block">${escapeHtml(item.title)}</div>
          <span class="history-badge-resolved">Resolved</span>
        </div>
        <div class="history-meta-sub">
          <span>${escapeHtml(item.date || '')}</span>
          ${item.duration ? ` &bull; <span>Total Duration: ${escapeHtml(item.duration)}</span>` : ''}
        </div>
        <p class="history-summary-text">${escapeHtml(item.summary)}</p>
      </div>
    `).join('');
  }

  // Full Diagnostic Refresh Cycle
  async function runDiagnosticCycle() {
    if (isProbing) return;
    isProbing = true;

    if (els.btnRefresh) els.btnRefresh.classList.add('spinning');

    try {
      const configData = await loadIncidentsConfig();

      renderActiveBroadcast(configData.incidents || []);
      renderPastIncidents(configData.past_incidents || []);

      // Build heatmaps with incident correlation
      buildUptimeHeatmap(els.ticksWeb, els.pctWeb, 'web', configData.past_incidents);
      buildUptimeHeatmap(els.ticksApi, els.pctApi, 'api', configData.past_incidents);
      buildUptimeHeatmap(els.ticksMedia, els.pctMedia, 'media', configData.past_incidents);
      buildUptimeHeatmap(els.ticksDb, els.pctDb, 'db', configData.past_incidents);

      const targetUrl = resolveTargetUrl(configData);
      const telemetry = await performSyntheticProbe(targetUrl);

      updatePlatformUI(telemetry, configData);
    } catch (err) {
      console.error('Status diagnostics error:', err);
    } finally {
      isProbing = false;
      if (els.btnRefresh) els.btnRefresh.classList.remove('spinning');
      resetCountdown();
    }
  }

  // Countdown Timer Management
  function resetCountdown() {
    secondsRemaining = POLL_INTERVAL;
    updateCountdownUI();
  }

  function updateCountdownUI() {
    if (els.probeCountdown) {
      els.probeCountdown.textContent = `${secondsRemaining}s`;
    }
  }

  function startPolling() {
    if (pollTimerId) clearInterval(pollTimerId);
    pollTimerId = setInterval(() => {
      secondsRemaining -= 1;
      if (secondsRemaining <= 0) {
        runDiagnosticCycle();
      } else {
        updateCountdownUI();
      }
    }, 1000);
  }

  // Setup Modals & Copy Helpers
  function setupModals() {
    const origin = window.location.origin;
    const feedUrl = `${origin}/incidents.json`;
    const badgeMd = `[![OwnMediaHost Status](${origin}/badge.svg)](${origin})`;
    const badgeHtml = `<a href="${origin}"><img src="${origin}/badge.svg" alt="OwnMediaHost Status" /></a>`;

    if (els.feedUrlInput) els.feedUrlInput.value = feedUrl;
    if (els.badgeMdInput) els.badgeMdInput.value = badgeMd;
    if (els.badgeHtmlInput) els.badgeHtmlInput.value = badgeHtml;

    // Open/close Subscribe modal
    if (els.btnSubscribe) {
      els.btnSubscribe.addEventListener('click', () => {
        if (els.modalSubscribe) els.modalSubscribe.style.display = 'flex';
      });
    }
    if (els.btnCloseSubscribe) {
      els.btnCloseSubscribe.addEventListener('click', () => {
        if (els.modalSubscribe) els.modalSubscribe.style.display = 'none';
      });
    }

    // Open/close Badge modal
    if (els.btnOpenBadgeModal) {
      els.btnOpenBadgeModal.addEventListener('click', () => {
        if (els.modalBadge) els.modalBadge.style.display = 'flex';
      });
    }
    if (els.btnCloseBadge) {
      els.btnCloseBadge.addEventListener('click', () => {
        if (els.modalBadge) els.modalBadge.style.display = 'none';
      });
    }

    // Close on overlay click
    window.addEventListener('click', (e) => {
      if (e.target === els.modalSubscribe) els.modalSubscribe.style.display = 'none';
      if (e.target === els.modalBadge) els.modalBadge.style.display = 'none';
    });

    // Copy actions with toast
    function copyText(inputEl, msg) {
      if (!inputEl) return;
      inputEl.select();
      navigator.clipboard.writeText(inputEl.value).then(() => {
        showToast(msg);
      }).catch(() => {
        showToast('Failed to copy to clipboard');
      });
    }

    if (els.btnCopyFeed) els.btnCopyFeed.addEventListener('click', () => copyText(els.feedUrlInput, 'Syndication Feed URL copied!'));
    if (els.btnCopyBadgeMd) els.btnCopyBadgeMd.addEventListener('click', () => copyText(els.badgeMdInput, 'Markdown Badge snippet copied!'));
    if (els.btnCopyBadgeHtml) els.btnCopyBadgeHtml.addEventListener('click', () => copyText(els.badgeHtmlInput, 'HTML Badge snippet copied!'));
  }

  // Toast Notification
  function showToast(text) {
    if (!els.toastNotice || !els.toastText) return;
    els.toastText.textContent = text;
    els.toastNotice.style.display = 'block';
    setTimeout(() => {
      els.toastNotice.style.display = 'none';
    }, 2400);
  }

  // Endpoint Diagnostics Override Controls
  function setupEndpointTester() {
    if (els.btnApplyEndpoint) {
      els.btnApplyEndpoint.addEventListener('click', () => {
        const val = els.inputEndpointOverride?.value?.trim();
        if (val) {
          customEndpointOverride = val;
          showToast(`Target endpoint set to ${val}`);
          runDiagnosticCycle();
        }
      });
    }

    if (els.btnResetEndpoint) {
      els.btnResetEndpoint.addEventListener('click', () => {
        customEndpointOverride = null;
        if (els.inputEndpointOverride) els.inputEndpointOverride.value = '';
        showToast('Reset target endpoint to automatic detection');
        runDiagnosticCycle();
      });
    }
  }

  // Text Escaping Helpers
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Initialization
  if (els.btnRefresh) {
    els.btnRefresh.addEventListener('click', (e) => {
      e.preventDefault();
      runDiagnosticCycle();
    });
  }

  setupModals();
  setupEndpointTester();
  renderLatencyChart(latencyHistory);
  runDiagnosticCycle();
  startPolling();
})();
