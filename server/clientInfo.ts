import { execFile } from 'child_process';
import dns from 'dns';
import os from 'os';

export interface ClientMeta {
  browser?: string;
  os?: string;
  device?: string;
  ua?: string;
  deviceId?: string;
  screen?: string;
  tz?: string;
  lang?: string;
  host?: string;
  mac?: string;
  newDevice?: boolean;
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, n) : '');

export function parseUserAgent(ua: string): { browser: string; os: string; device: string } {
  const m = (re: RegExp) => ua.match(re);
  let browser = 'Unknown browser';
  let t: RegExpMatchArray | null;
  if ((t = m(/Edg(?:e|A|iOS)?\/([\d.]+)/))) browser = `Edge ${t[1].split('.')[0]}`;
  else if ((t = m(/OPR\/([\d.]+)/))) browser = `Opera ${t[1].split('.')[0]}`;
  else if ((t = m(/(?:Firefox|FxiOS)\/([\d.]+)/))) browser = `Firefox ${t[1].split('.')[0]}`;
  else if ((t = m(/(?:Chrome|CriOS)\/([\d.]+)/))) browser = `Chrome ${t[1].split('.')[0]}`;
  else if ((t = m(/Version\/([\d.]+).*Safari/))) browser = `Safari ${t[1].split('.')[0]}`;
  else if (/curl\//i.test(ua)) browser = 'curl';

  let osName = 'Unknown OS';
  if ((t = m(/Windows NT ([\d.]+)/))) osName = `Windows ${({ '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' } as Record<string, string>)[t[1]] || t[1]}`;
  else if ((t = m(/Android ([\d.]+)/))) osName = `Android ${t[1]}`;
  else if ((t = m(/(?:iPhone|CPU) OS ([\d_]+)/)) && /iPhone|iPad/.test(ua)) osName = `iOS ${t[1].replace(/_/g, '.')}`;
  else if (/Mac OS X/.test(ua)) osName = 'macOS';
  else if (/CrOS/.test(ua)) osName = 'ChromeOS';
  else if (/Linux/.test(ua)) osName = 'Linux';

  const device = /iPad|Tablet/.test(ua) ? 'Tablet' : /Mobi|iPhone|Android/.test(ua) ? 'Phone' : 'Computer';
  return { browser, os: osName, device };
}

const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;

/** What the request itself says about the device. Nothing here is trusted for security; it only helps recognise a device. */
export function clientMeta(headers: Record<string, any>, body?: any): ClientMeta {
  const ua = clip(headers['user-agent'], 300);
  const meta: ClientMeta = { ...parseUserAgent(ua), ua };
  const id = clip(headers['x-device-id'], 64);
  if (DEVICE_ID.test(id)) meta.deviceId = id;
  const d = body && typeof body === 'object' ? body : null;
  if (d) {
    const screen = clip(d.screen, 20), tz = clip(d.tz, 60), lang = clip(d.lang, 20);
    if (screen) meta.screen = screen;
    if (tz) meta.tz = tz;
    if (lang) meta.lang = lang;
  }
  return meta;
}

const isLoopback = (ip: string) => ip === '127.0.0.1' || ip === '::1';
const SAFE_IP = /^[0-9a-fA-F:.]{3,45}$/;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    try { execFile(cmd, args, { timeout: 1500, windowsHide: true }, (_e, out) => resolve(String(out || ''))); } catch { resolve(''); }
  });
}

const cache = new Map<string, { at: number; host?: string; mac?: string }>();
const CACHE_MS = 10 * 60 * 1000;

/** Best-effort: the computer's name (reverse DNS) and hardware (MAC) address, only available for computers on the same office network. */
export async function lookupNetworkIdentity(ip: string): Promise<{ host?: string; mac?: string }> {
  if (isLoopback(ip)) return { host: os.hostname() };
  if (!SAFE_IP.test(ip)) return {};
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < CACHE_MS) return { host: hit.host, mac: hit.mac };

  const hostP = Promise.race([
    dns.promises.reverse(ip).then((r) => r[0]).catch(() => undefined),
    new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500)),
  ]);
  const macP = (async () => {
    let out = '';
    if (process.platform === 'win32') out = await run('arp', ['-a', ip]);
    else if (process.platform === 'darwin') out = await run('arp', ['-n', ip]);
    else out = await run('ip', ['neigh', 'show', ip]);
    const m = out.match(/\b([0-9a-f]{2}(?:[:-][0-9a-f]{2}){5})\b/i);
    return m ? m[1].toUpperCase().replace(/-/g, ':') : undefined;
  })();
  const [host, mac] = await Promise.all([hostP, macP]);
  const found = { host: host ? clip(host, 120) : undefined, mac: mac && mac !== '00:00:00:00:00:00' ? mac : undefined };
  cache.set(ip, { at: Date.now(), ...found });
  return found;
}
