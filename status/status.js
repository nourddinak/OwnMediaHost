/**
 * OwnMediaHost — Decoupled Public Status & Incident Communication Engine
 * Pure Vanilla JS, zero dependencies, out-of-band resilient execution
 */

(function () {
  'use strict';

  // Configuration & Defaults
  const POLL_INTERVAL_SECONDS = 30;
  let pollSecondsLeft = POLL_INTERVAL_SECONDS;
  let pollIntervalId = null;
  let isProbing = false;

  // DOM Elements
  const els = {
    banner: document.getElementById('system-status-banner'),
    headline: document.getElementById('status-headline'),
    description: document.getElementById('status-description'),
    metricLatency: document.getElementById('metric-latency'),
    metricChecked: document.getElementById('metric-checked'),
    pollCountdown: document.getElementById('poll-countdown'),
    pollBar: document.getElementById('poll-bar'),
    btnRefresh: document.getElementById('btn-refresh'),
    refreshIcon: document.getElementById('refresh-icon'),
    incidentsSection: document.getElementById('incidents-section'),
    incidentsList: document.getElementById('incidents-list'),
    incidentCountTag: document.getElementById('incident-count-tag'),
    historyList: document.getElementById('history-list'),
    currentYear: document.getElementById('current-year'),
    linkMainApp: document.getElementById('link-main-app'),
    linkHealth: document.getElementById('link-health'),
    // Subsystem pills
    pillWeb: document.getElementById('pill-web'),
    pillApi: document.getElementById('pill-api'),
    pillMedia: document.getElementById('pill-media'),
    pillDb: document.getElementById('pill-db'),
  };

  if (els.currentYear) {
    els.currentYear.textContent = new Date().getFullYear();
  }

  // Determine the primary API Base URL to probe
  function resolveApiBaseUrl(configData) {
    // 1. Query parameter override: ?api=https://media.example.com
    const params = new URLSearchParams(window.location.search);
    if (params.get('api')) {
      return params.get('api').replace(/\/+$/, '');
    }

    // 2. Explicitly configured in incidents.json
    if (configData && configData.api_endpoint && configData.api_endpoint.trim() !== '') {
      return configData.api_endpoint.trim().replace(/\/+$/, '');
    }

    // 3. Heuristic based on current domain
    const host = window.location.hostname;
    const protocol = window.location.protocol;

    if (host === 'localhost' || host === '127.0.0.1' || protocol === 'file:') {
      // Local development test
      if (window.location.port) {
        return `${protocol}//${host}:${window.location.port === '5173' || window.location.port === '3000' ? '5002' : window.location.port}`;
      }
      return 'http://127.0.0.1:5002';
    }

    if (host.startsWith('status.')) {
      // e.g. status.example.com -> probe https://example.com
      const rootDomain = host.substring(7);
      return `${protocol}//${rootDomain}`;
    }

    // Otherwise, probe the same origin
    return window.location.origin;
  }

  // Fetch incident configuration from static JSON
  async function fetchIncidentsData() {
    try {
      const res = await fetch(`incidents.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      localStorage.setItem('ownmediahost_incidents_cache', JSON.stringify(data));
      return data;
    } catch (err) {
      console.warn('Could not load incidents.json; reading from local cache:', err);
      const cached = localStorage.getItem('ownmediahost_incidents_cache');
      return cached ? JSON.parse(cached) : { incidents: [], past_incidents: [] };
    }
  }

  // Execute Live Telemetry Probe
  async function probeServices(apiBaseUrl) {
    const startTime = performance.now();
    let apiOk = false;
    let dbOk = false;
    let latencyMs = 0;
    let errorDetail = '';

    // Update footer link targets
    if (els.linkMainApp) els.linkMainApp.href = apiBaseUrl || '/';
    if (els.linkHealth) els.linkHealth.href = `${apiBaseUrl}/health`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);

      // Probe 1: Core /health
      const healthRes = await fetch(`${apiBaseUrl}/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      clearTimeout(timeoutId);
      latencyMs = Math.round(performance.now() - startTime);

      if (healthRes.ok) {
        apiOk = true;
      } else {
        errorDetail = `HTTP ${healthRes.status} ${healthRes.statusText}`;
      }

      // Probe 2: Readiness check for DB (/health/ready)
      if (apiOk) {
        try {
          const readyController = new AbortController();
          const readyTimeout = setTimeout(() => readyController.abort(), 4000);
          const readyRes = await fetch(`${apiBaseUrl}/health/ready`, {
            method: 'GET',
            cache: 'no-store',
            signal: readyController.signal,
            headers: { Accept: 'application/json' },
          });
          clearTimeout(readyTimeout);
          if (readyRes.ok) {
            dbOk = true;
          }
        } catch (_) {
          dbOk = false;
        }
      }
    } catch (err) {
      latencyMs = Math.round(performance.now() - startTime);
      errorDetail = err.name === 'AbortError' ? 'Connection Timed Out (>7s)' : 'Network Unreachable (502 / Host Offline)';
    }

    return { apiOk, dbOk, latencyMs, errorDetail };
  }

  // Update UI Subsystem status pill helper
  function updatePill(pillEl, status, text) {
    if (!pillEl) return;
    pillEl.className = `service-status-pill status-${status}`;
    const textEl = pillEl.querySelector('.pill-text');
    if (textEl) textEl.textContent = text;
  }

  // Render Incidents and History
  function renderIncidentsUI(data) {
    const activeIncidents = data.incidents || [];
    const pastIncidents = data.past_incidents || [];

    // 1. Active Incidents
    if (activeIncidents.length > 0) {
      els.incidentsSection.style.display = 'block';
      els.incidentCountTag.textContent = `${activeIncidents.length} Active`;
      els.incidentsList.innerHTML = activeIncidents
        .map((inc) => {
          const badgeClass = `badge-${inc.status || 'investigating'}`;
          const cardClass = inc.severity === 'critical' ? 'incident-critical' : inc.severity === 'maintenance' ? 'incident-maintenance' : 'incident-major';

          const updatesHtml = (inc.updates || [])
            .map(
              (u) => `
            <div class="timeline-step">
              <div class="timeline-meta">${escapeHtml(u.timestamp || '')} &bull; <span class="incident-badge badge-${u.status}">${capitalize(u.status || '')}</span></div>
              <div class="timeline-body">${escapeHtml(u.message || '')}</div>
            </div>
          `
            )
            .join('');

          return `
          <div class="incident-card ${cardClass}">
            <div class="incident-title-row">
              <span class="incident-title">${escapeHtml(inc.title)}</span>
              <span class="incident-badge ${badgeClass}">${capitalize(inc.status)}</span>
            </div>
            ${updatesHtml ? `<div class="incident-timeline">${updatesHtml}</div>` : ''}
          </div>
        `;
        })
        .join('');
    } else {
      els.incidentsSection.style.display = 'none';
      els.incidentsList.innerHTML = '';
    }

    // 2. Incident History
    if (pastIncidents.length > 0) {
      els.historyList.innerHTML = pastIncidents
        .map(
          (item) => `
        <div class="history-card">
          <div class="history-date">${escapeHtml(item.date || '')} ${item.duration ? `&bull; Duration: ${escapeHtml(item.duration)}` : ''}</div>
          <div class="history-title">${escapeHtml(item.title)}</div>
          <div class="history-summary">${escapeHtml(item.summary)}</div>
        </div>
      `
        )
        .join('');
    } else {
      els.historyList.innerHTML = `
        <div class="history-empty">
          No incidents recorded in the past 90 days. All systems performing nominally.
        </div>
      `;
    }
  }

  // Update Global Banner and Subsystems
  function updateStatusUI(telemetry, incidentsData) {
    const { apiOk, dbOk, latencyMs, errorDetail } = telemetry;
    const activeIncidents = incidentsData.incidents || [];
    const hasActiveMaintenance = activeIncidents.some((i) => i.status === 'maintenance' || i.severity === 'maintenance');

    // Update Telemetry Metrics
    if (els.metricLatency) {
      els.metricLatency.textContent = apiOk ? `${latencyMs} ms` : '-- ms';
      els.metricLatency.style.color = latencyMs > 300 ? 'var(--color-degraded)' : 'var(--text-primary)';
    }

    if (els.metricChecked) {
      const now = new Date();
      els.metricChecked.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    // Subsystem States
    if (apiOk && dbOk) {
      updatePill(els.pillWeb, 'operational', 'Operational');
      updatePill(els.pillApi, 'operational', 'Operational');
      updatePill(els.pillMedia, 'operational', 'Operational');
      updatePill(els.pillDb, 'operational', 'Operational');
    } else if (apiOk && !dbOk) {
      updatePill(els.pillWeb, 'operational', 'Operational');
      updatePill(els.pillApi, 'operational', 'Operational');
      updatePill(els.pillMedia, 'degraded', 'Degraded');
      updatePill(els.pillDb, 'degraded', 'Read-Only / Degraded');
    } else {
      updatePill(els.pillWeb, 'degraded', 'Degraded (API Down)');
      updatePill(els.pillApi, 'outage', 'Unreachable');
      updatePill(els.pillMedia, 'outage', 'Offline');
      updatePill(els.pillDb, 'outage', 'Offline');
    }

    // Overall Banner State
    els.banner.classList.remove('status-loading', 'status-operational', 'status-degraded', 'status-outage', 'status-maintenance');

    if (hasActiveMaintenance) {
      els.banner.classList.add('status-maintenance');
      els.headline.textContent = 'Scheduled System Maintenance in Progress';
      els.description.textContent = activeIncidents[0]?.title || 'Upgrades are underway. Services will resume shortly.';
    } else if (apiOk && dbOk && activeIncidents.length === 0) {
      els.banner.classList.add('status-operational');
      els.headline.textContent = 'All Systems Operational';
      els.description.textContent = 'All core services, media pipelines, and APIs are responding normally with low latency.';
    } else if (apiOk && (!dbOk || activeIncidents.length > 0)) {
      els.banner.classList.add('status-degraded');
      els.headline.textContent = 'Partial System Degradation';
      els.description.textContent = !dbOk
        ? 'Database connectivity issues detected. Web UI and media streaming may be temporarily impacted.'
        : activeIncidents[0]?.title || 'Our team is investigating an issue affecting some services.';
    } else {
      els.banner.classList.add('status-outage');
      els.headline.textContent = 'Service Disruption / Primary Host Unreachable';
      els.description.textContent = errorDetail
        ? `Primary API gateway is unreachable (${errorDetail}). The out-of-band incident team has been notified.`
        : 'The application backend is offline. We are actively working to restore services.';
    }
  }

  // Full Refresh Cycle
  async function runTelemetryCycle() {
    if (isProbing) return;
    isProbing = true;

    if (els.refreshIcon) els.refreshIcon.classList.add('spinning');

    try {
      const incidentsData = await fetchIncidentsData();
      renderIncidentsUI(incidentsData);

      const apiBaseUrl = resolveApiBaseUrl(incidentsData);
      const telemetry = await probeServices(apiBaseUrl);

      updateStatusUI(telemetry, incidentsData);
    } catch (err) {
      console.error('Status cycle error:', err);
    } finally {
      isProbing = false;
      if (els.refreshIcon) els.refreshIcon.classList.remove('spinning');
      resetPollTimer();
    }
  }

  // Polling Timer Management
  function resetPollTimer() {
    pollSecondsLeft = POLL_INTERVAL_SECONDS;
    updatePollTimerUI();
  }

  function updatePollTimerUI() {
    if (els.pollCountdown) els.pollCountdown.textContent = `${pollSecondsLeft}s`;
    if (els.pollBar) {
      const pct = Math.round((pollSecondsLeft / POLL_INTERVAL_SECONDS) * 100);
      els.pollBar.style.width = `${pct}%`;
    }
  }

  function initPolling() {
    if (pollIntervalId) clearInterval(pollIntervalId);
    pollIntervalId = setInterval(() => {
      pollSecondsLeft -= 1;
      if (pollSecondsLeft <= 0) {
        runTelemetryCycle();
      } else {
        updatePollTimerUI();
      }
    }, 1000);
  }

  // Helpers
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

  // Event Listeners
  if (els.btnRefresh) {
    els.btnRefresh.addEventListener('click', (e) => {
      e.preventDefault();
      runTelemetryCycle();
    });
  }

  // Initialize
  runTelemetryCycle();
  initPolling();
})();
