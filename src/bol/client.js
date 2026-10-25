'use strict';
// bol API-client: alleen-lezen. Hergebruikt tokens (bol blokkeert IP's die te vaak een token vragen),
// beperkt het tempo en wacht bij 429 (rate limit) of tijdelijke fouten.
// Deze client bevat bewust GEEN schrijfacties (geen prijs-, voorraad-, campagne- of orderwijzigingen).

const TOKEN_URL = 'https://login.bol.com/token';
const API = 'https://api.bol.com';
const MIN_INTERVAL_MS = 350; // ruim onder de richtwaarde van 4 verzoeken/seconde
const MAX_RETRIES = 5;

class BolError extends Error {
  constructor(message, status, detail) { super(message); this.status = status; this.detail = detail; }
}

function createClient({ id, secret }, { fetchImpl = fetch, label = 'retailer' } = {}) {
  let token = null; // { value, expiresAt }
  let lastCall = 0;

  async function getToken() {
    if (token && Date.now() < token.expiresAt - 30000) return token.value;
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      throw new BolError(res.status === 401
        ? `Inloggen bij bol mislukt (${label}): ID of secret klopt niet`
        : `Inloggen bij bol mislukt (${label}): HTTP ${res.status}`, res.status);
    }
    const j = await res.json();
    token = { value: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 299) * 1000 };
    return token.value;
  }

  /** Niet-geheime informatie uit het token (om te controleren welk account gekoppeld is). */
  async function tokenInfo() {
    const t = await getToken();
    try {
      const payload = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));
      const safe = {};
      for (const [k, v] of Object.entries(payload)) {
        if (/retailer|client_name|name|account|sub|exp/i.test(k) && typeof v !== 'object') safe[k] = v;
      }
      return { claims: safe, scopes: payload.scope || payload.scopes || null };
    } catch { return { claims: {}, scopes: null }; }
  }

  async function throttle() {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
  }

  /**
   * GET op de bol API.
   * @param {string} path bv. '/retailer/orders'
   * @param {object} q queryparameters
   * @param {string} accept bv. 'application/vnd.retailer.v10+json'
   */
  async function get(path, q = {}, accept = 'application/vnd.retailer.v10+json', { raw = false } = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      await throttle();
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${await getToken()}`, Accept: accept } });
      if (res.status === 401 && attempt === 0) { token = null; continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(60000, 1000 * 2 ** attempt));
        continue;
      }
      if (res.status === 404) return raw ? '' : null;
      if (!res.ok) {
        let detail = null;
        try { detail = await res.json(); } catch { /* geen json */ }
        throw new BolError(`bol API ${path}: HTTP ${res.status}${detail && detail.title ? ` (${detail.title})` : ''}`, res.status, detail);
      }
      if (raw) return res.text();
      const txt = await res.text();
      return txt ? JSON.parse(txt) : {};
    }
  }

  return { get, getToken, tokenInfo };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = { createClient, BolError, V10: 'application/vnd.retailer.v10+json', V11: 'application/vnd.retailer.v11+json' };
