// npm run upac:cleanup -- <export folder> [--apply]
//
// Removes the old attached UPAC forms from the database (the attachments table and the form name/size columns of the
// connections). It does that ONLY after proving that every one of them is in the folder made by `npm run upac:export`:
// each file is found, has the right size and its content matches its fingerprint.
//
//   npm run upac:cleanup -- <folder>           only checks and reports what it would do (changes nothing)
//   npm run upac:cleanup -- <folder> --apply   does it
//
// STOP THE WEBSITE FIRST for --apply. A copy of the database as it is now is kept next to it
// (pace_it.sqlite.before-upac-cleanup-<time>), and the whole change is one transaction: it happens completely or not at all.
//
// The form files themselves (data/files/blobs) are not deleted here. The nightly backup job removes files that no
// database row and no kept backup refers to any more, so they disappear as the old backups age out (see docs).
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { acquireMaintenance, releaseMaintenance } from '../server/maintenance';
import { hashFile, isSha } from '../server/blobs';
import { snapshotDb, verifySnapshot, freeBytes } from '../server/backupCore';

const DATA = path.resolve(process.env.PACE_DATA_DIR || path.join(process.cwd(), 'data'));
const LIVE = path.join(DATA, 'pace_it.sqlite');
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const folderArg = argv.find((a: string) => !a.startsWith('--')) || '';
const say = (m = '') => console.log(m);

let locked = false;
function unlock() { if (locked) { releaseMaintenance(DATA); locked = false; } }
process.on('exit', unlock);
function die(msg: string): never {
  console.error('\nCLEAN-UP STOPPED: ' + msg);
  console.error('Nothing was changed.');
  unlock();
  process.exit(1);
}

interface Entry { logId: string; sha256: string; size: number; file: string }

/** The website must not be running (it has the file open and keeps data in memory). Same check as `npm run restore`. */
function assertServerStopped() {
  let d: DatabaseSync | null = null;
  try {
    d = new DatabaseSync(LIVE);
    d.exec('PRAGMA busy_timeout = 1500');
    const row = d.prepare('PRAGMA journal_mode = DELETE').get() as Record<string, unknown>;
    if (String(Object.values(row)[0]).toLowerCase() === 'wal') throw Object.assign(new Error('database is locked'), { code: 'BUSY' });
  } catch (e: any) {
    if (/locked|busy/i.test(String(e?.message || e)) || e?.code === 'BUSY') die('The website is still running (the database is in use). Stop it first, then run this again.');
    die(`The database could not be opened (${e?.message || e}).`);
  } finally {
    try { d?.close(); } catch { /* closed */ }
  }
}

async function main() {
  if (!folderArg) die('Give the folder made by the export:  npm run upac:cleanup -- <folder>');
  const folder = path.resolve(folderArg);
  const manifestFile = path.join(folder, 'manifest.json');
  if (!fs.existsSync(LIVE)) die(`No database at ${LIVE}.`);
  if (!fs.existsSync(manifestFile)) die(`${manifestFile} does not exist. Run  npm run upac:export  first.`);

  let manifest: any;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')); } catch { die('The export manifest could not be read.'); }
  if (manifest?.format !== 'pace-it-upac-export' || !Array.isArray(manifest.entries)) die('That folder is not an export made by npm run upac:export.');
  if (manifest.complete !== true) die('That export reported problems. Run  npm run upac:export  again until it says "Export complete".');

  // 1. what the database holds right now
  const ro = new DatabaseSync(LIVE, { readOnly: true });
  let rows: { log_id: string; sha256: string; size: number }[];
  let named = 0;
  try {
    ro.exec('PRAGMA busy_timeout = 60000');
    rows = ro.prepare('SELECT log_id, sha256, size FROM attachments').all() as any;
    named = Number((ro.prepare("SELECT COUNT(*) AS c FROM logs WHERE upac_form_name IS NOT NULL AND upac_form_name <> ''").get() as any)?.c || 0);
  } finally {
    ro.close();
  }
  const unique = new Map<string, number>();
  for (const r of rows) if (isSha(r.sha256)) unique.set(r.sha256, Number(r.size));
  const bytes = [...unique.values()].reduce((a, b) => a + b, 0);
  say(`In the database: ${rows.length} attached form(s) (${unique.size} different file(s), ${(bytes / 1048576).toFixed(1)} MB), ${named} connection(s) listing a form name.`);

  // 2. prove every one of them is in the export folder, byte for byte
  const byKey = new Map<string, Entry>();
  for (const e of manifest.entries as Entry[]) byKey.set(`${e.logId}|${e.sha256}`, e);
  const problems: string[] = [];
  const checked = new Set<string>();
  say('Checking the exported copies (this reads every file once) ...');
  let i = 0;
  for (const r of rows) {
    const e = byKey.get(`${r.log_id}|${r.sha256}`);
    if (!e) { problems.push(`a form of connection ${r.log_id} is not in the export (it was attached after the export was made)`); continue; }
    if (!checked.has(e.file)) {
      checked.add(e.file);
      const f = path.join(folder, e.file);
      try {
        const st = fs.statSync(f);
        if (st.size !== Number(r.size)) problems.push(`${e.file}: wrong size`);
        else if ((await hashFile(f)) !== r.sha256) problems.push(`${e.file}: content does not match its fingerprint`);
      } catch { problems.push(`${e.file}: missing from the export folder`); }
    }
    if (++i % 200 === 0) say(`  ${i} of ${rows.length} ...`);
  }
  if (problems.length) {
    problems.slice(0, 30).forEach((p) => console.error('  - ' + p));
    if (problems.length > 30) console.error(`  ... and ${problems.length - 30} more`);
    die(`${problems.length} form(s) are not safely in the export folder. Run  npm run upac:export  again (it only copies what is missing), then retry.`);
  }
  say(`All ${rows.length} form(s) are in ${folder} and match their fingerprints.`);

  if (!apply) {
    say('\nThis was only a check. To remove the forms from the database:');
    say(`  1. stop the website`);
    say(`  2. npm run upac:cleanup -- "${folder}" --apply`);
    return;
  }

  // 3. do it
  assertServerStopped();
  if (!acquireMaintenance(DATA, 'cleanup')) die('Another maintenance job is running. Wait for it to end.');
  locked = true;

  const copy = `${LIVE}.before-upac-cleanup-${Date.now()}`;
  if (freeBytes(DATA) < fs.statSync(LIVE).size * 1.2 + 50 * 1048576) die('There is not enough free space for a safety copy of the database.');
  say(`Making a safety copy: ${copy}`);
  try { snapshotDb(LIVE, copy); verifySnapshot(copy); } catch (e: any) { fs.rmSync(copy, { force: true }); die(`The safety copy failed its check (${e?.message || e}).`); }

  const db = new DatabaseSync(LIVE);
  try {
    db.exec('PRAGMA busy_timeout = 60000');
    db.exec('BEGIN IMMEDIATE');
    try {
      // re-check inside the transaction: nothing may have been attached since the check above
      const now = Number((db.prepare('SELECT COUNT(*) AS c FROM attachments').get() as any).c);
      if (now !== rows.length) throw new Error(`The number of attached forms changed (${rows.length} then ${now}). Run the export again.`);
      db.exec('DELETE FROM attachments');
      db.exec(`UPDATE logs SET upac_form_name = NULL, upac_form_type = NULL, upac_form_size = NULL, upac_form_uploaded_at = NULL, upac_form_data = NULL
                WHERE upac_form_name IS NOT NULL OR upac_form_type IS NOT NULL OR upac_form_size IS NOT NULL OR upac_form_uploaded_at IS NOT NULL OR upac_form_data IS NOT NULL`);
      const left = Number((db.prepare('SELECT COUNT(*) AS c FROM attachments').get() as any).c);
      const listed = Number((db.prepare("SELECT COUNT(*) AS c FROM logs WHERE upac_form_name IS NOT NULL AND upac_form_name <> ''").get() as any).c);
      if (left !== 0 || listed !== 0) throw new Error('The check after the change failed.');
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
      throw e;
    }
    const verdict = String((db.prepare('PRAGMA quick_check').get() as any)?.quick_check);
    if (verdict !== 'ok') console.error(`WARNING: the database check says "${verdict}". Restore ${copy} if anything looks wrong.`);
  } catch (e: any) {
    db.close();
    die(`${e?.message || e} (the database was not changed).`);
  }
  db.close();

  say(`\nDone. Removed ${rows.length} attached form(s) from the database and cleared ${named} form name(s).`);
  say(`Safety copy kept at: ${copy}`);
  say('Start the website again. The UPAC buttons now make the form from each connection.');
  say(`\nThe ${(bytes / 1048576).toFixed(1)} MB of form files in data/files/blobs are freed by the nightly backup job once no kept backup refers to them`);
  say('(the daily and weekly backups still list them until they age out - by default that takes up to 26 weeks).');
  if (fs.existsSync(path.join(DATA, 'files', 'upac'))) say('Old plain copies also exist in data/files/upac. After you have checked the export folder you can delete that folder by hand.');
}

main().catch((e) => die(String(e?.message || e)));
