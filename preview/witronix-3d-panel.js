// Witronix 3D Custom Panel for Home Assistant
// Sandboxed Iframe Architecture with Native HA Service & Menu Integration

class Witronix3DPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = {};
    this._iframe = null;
    this._readyReceived = false;
    this._statesScheduled = false;

    this._handleWindowMessage = this._handleWindowMessage.bind(this);
  }

  set hass(hass) {
    this._hass = hass;
    this._scheduleStatesToIframe();
  }

  set panel(panel) {
    if (panel && panel.config) {
      this._config = panel.config;
    }
  }

  setConfig(config) {
    this._config = config || {};
  }

  _scheduleStatesToIframe() {
    if (this._statesScheduled) return;
    this._statesScheduled = true;
    requestAnimationFrame(() => {
      this._statesScheduled = false;
      this._sendStatesToIframe();
    });
  }

  _sendStatesToIframe() {
    if (!this._iframe || !this._iframe.contentWindow || !this._hass || !this._hass.states) {
      return;
    }
    try {
      const safeStates = {};
      for (const id in this._hass.states) {
        const entity = this._hass.states[id];
        if (entity) {
          safeStates[id] = {
            entity_id: entity.entity_id,
            state: entity.state,
            attributes: entity.attributes || {},
            last_changed: entity.last_changed,
            last_updated: entity.last_updated,
          };
        }
      }

      this._iframe.contentWindow.postMessage(
        {
          type: 'HA_STATES',
          states: safeStates,
        },
        '*'
      );
    } catch (err) {
      console.warn('[Witronix 3D] Error forwarding HA_STATES:', err);
    }
  }

  _handleWindowMessage(event) {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'HA_READY') {
      this._readyReceived = true;
      this._sendStatesToIframe();
      return;
    }

    if (data.type === 'HA_TOGGLE_MENU') {
      this.dispatchEvent(
        new Event('hass-toggle-menu', {
          bubbles: true,
          composed: true,
        })
      );
      return;
    }

    if (data.type === 'HA_CALL_SERVICE' && this._hass) {
      const { domain, service, serviceData } = data;
      this._hass.callService(domain || 'switch', service || 'toggle', serviceData || {});
      return;
    }

    if (data.type === 'call-service' && this._hass) {
      const { domain, service, service_data } = data;
      this._hass.callService(domain, service, service_data || {});
      return;
    }
  }

  connectedCallback() {
    window.addEventListener('message', this._handleWindowMessage);

    if (!this.shadowRoot.querySelector('iframe')) {
      const cacheBust = Date.now();
      const appUrl = (this._config && this._config.app_url) ? this._config.app_url : `/local/witronix-3d/index.html?v=${cacheBust}`;

      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block !important;
            position: relative !important;
            width: 100% !important;
            height: 100vh !important;
            min-height: 100vh !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            background: #070b14 !important;
          }
          iframe {
            width: 100% !important;
            height: 100% !important;
            border: 0 !important;
            display: block !important;
            background: #070b14 !important;
          }
        </style>
        <iframe
          src="${appUrl}"
          allow="accelerometer; camera; gyroscope; vr"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        ></iframe>
      `;
      this._iframe = this.shadowRoot.querySelector('iframe');
    }
  }

  disconnectedCallback() {
    window.removeEventListener('message', this._handleWindowMessage);
    this._iframe = null;
  }
}

if (!customElements.get('witronix-3d-panel')) {
  customElements.define('witronix-3d-panel', Witronix3DPanel);
}

console.log('[Witronix 3D] Custom panel <witronix-3d-panel> registered successfully.');
