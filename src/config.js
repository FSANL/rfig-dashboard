'use strict';
// Leest .env (zonder externe pakketten). Geheimen worden nooit gelogd of naar de browser gestuurd.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function loadEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

const fileEnv = loadEnvFile(path.join(ROOT, '.env'));
const env = (k, d = '') => process.env[k] ?? fileEnv[k] ?? d;

const retailer = { id: env('BOL_RETAILER_CLIENT_ID'), secret: env('BOL_RETAILER_CLIENT_SECRET') };
const advertising = { id: env('BOL_ADVERTISING_CLIENT_ID'), secret: env('BOL_ADVERTISING_CLIENT_SECRET') };
const hasRetailer = !!(retailer.id && retailer.secret);
const forceDemo = env('DEMO_MODE', '').toLowerCase() === 'true';

const config = {
  root: ROOT,
  port: Number(env('PORT', '3010')),
  host: '127.0.0.1', // alleen bereikbaar vanaf deze pc
  mode: forceDemo || !hasRetailer ? 'DEMO' : 'LIVE',
  dataDir: path.resolve(ROOT, env('DATA_DIR', 'data')),
  backupDir: env('BACKUP_DIR', ''),
  agentExportDir: env('AGENT_EXPORT_DIR', ''), // map voor RFIG agent-export.xlsx (live); leeg = BACKUP_DIR\Agent-export
  syncIntervalMinutes: Number(env('SYNC_INTERVAL_MINUTES', '60')),
  priceGapHours: Number(env('PRICE_GAP_HOURS', '36')),
  vatRate: Number(env('VAT_RATE', '0.21')),
  commissionIncludesVat: env('COMMISSION_INCLUDES_VAT', 'true').toLowerCase() !== 'false',
  historyDays: Math.min(90, Number(env('ORDER_HISTORY_DAYS', '90'))),
  credentials: { retailer, advertising },
  hasRetailer,
  hasAdvertising: !!(advertising.id && advertising.secret),
};
config.dbFile = path.join(config.dataDir, config.mode === 'DEMO' ? 'rfig-demo.sqlite' : 'rfig.sqlite');

/** Veilige weergave voor de UI: nooit de waarden zelf. */
config.publicView = () => ({
  mode: config.mode,
  port: config.port,
  retailerCredentials: config.hasRetailer ? 'ingesteld' : 'ontbreekt',
  advertisingCredentials: config.hasAdvertising ? 'ingesteld' : 'ontbreekt',
  backupDir: config.backupDir || null,
  syncIntervalMinutes: config.syncIntervalMinutes,
  priceGapHours: config.priceGapHours,
  vatRate: config.vatRate,
  dbFile: path.basename(config.dbFile),
});

module.exports = config;
