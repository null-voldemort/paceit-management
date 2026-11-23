// npm run upac:export
//
// UPAC forms are no longer stored: the website makes the form from the connection's details when someone downloads it.
// The forms that were attached in the past are still on disk (data/files/blobs). This copies every one of them into a
// plain folder, with a readable name, and checks each copy against its fingerprint. Nothing in the database or in
// data/files is changed. You can run it while the website is running, and run it again: files already copied are kept.
//
//   npm run upac:export                       copies into data/upac-export
//   npm run upac:export -- D:\PaceIT-old-forms  copies into the folder you give
//
// When it ends with "Export complete", the folder is the permanent copy of the old forms. Keep it somewhere safe,
// then run  npm run upac:cleanup -- <that folder>  (it refuses to remove anything that is not in this folder).
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { blobPath, blobRoot, hashFile, isSha, sniffAttachment } from '../server/blobs';
import { freeBytes } from '../server/backupCore';

const DATA = path.resolve(process.env.PACE_DATA_DIR || path.join(process.cwd(), 'data'));
const LIVE = path.join(DATA, 'pace_it.sqlite');
const args = process.argv.slice(2).filter((a: string) => !a.startsWith('--'));
const OUT = path.resolve(args[0] || path.join(DATA, 'upac-export'));
const FILES = path.join(OUT, 'files');
const say = (m = '') => console.log(m);

interface ExportEntry {
  logId: string;
  serial: number;
  nmsId: string;
  edcNo: string;
  customer: string;
  originalName: string;
  sha256: string;
  size: number;
  file: string;
  binned: boolean;
}

interface Row {
  log_id: string; sha256: string; size: number;
  log_no: number | null; nms_id: string | null; edc_no: string | null; customer_name: string | null;
  upac_form_name: string | null; deleted_at: string | null;
}

const EXT: Record<string, string> = {
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

/** A name that is safe on every file system, short enough to stay under path limits. */
function safePart(s: string, max: number): string {
  return s.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, max).trim();
}

function die(msg: string): never {
  console.error('\nEXPORT STOPPED: ' + msg);
  process.exit(1);
}

async function main() {
  if (!fs.existsSync(LIVE)) die(`No database at ${LIVE}.`);
  const db = new DatabaseSync(LIVE, { readOnly: true });
  let rows: Row[];
  try {
    db.exec('PRAGMA busy_timeout = 60000');
    const hasSha = (db.prepare('PRAGMA table_info(attachments)').all() as { name: string }[]).some((c) => c.name === 'sha256');
    if (!hasSha) die('This database still keeps forms inside the database file. Start the website once with this version so it upgrades, then run this again.');
    rows = db.prepare(
      `SELECT a.log_id, a.sha256, a.size, l.log_no, l.nms_id, l.edc_no, l.customer_name, l.upac_form_name, l.deleted_at
         FROM attachments a LEFT JOIN logs l ON l.id = a.log_id
        ORDER BY l.log_no, a.log_id`,
    ).all() as unknown as Row[];
  } finally {
    db.close();
  }

  const totalBytes = rows.reduce((n, r) => n + Number(r.size || 0), 0);
  say(`Attached forms in the database: ${rows.length} (${(totalBytes / 1048576).toFixed(1)} MB)`);
  say(`Copying into: ${OUT}`);
  if (rows.length === 0) say('There is nothing to export. The old forms are already gone; you can skip the clean-up.');
  if (freeBytes(path.dirname(OUT)) < totalBytes * 1.05 + 50 * 1048576) die('There is not enough free space for the copy.');
  fs.mkdirSync(FILES, { recursive: true });

  const root = blobRoot(DATA);
  const used = new Set<string>();
  const entries: ExportEntry[] = [];
  const problems: string[] = [];
  let copied = 0, kept = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!isSha(r.sha256)) { problems.push(`form ${i + 1}: has no valid fingerprint`); continue; }
    const src = blobPath(root, r.sha256);
    if (!fs.existsSync(src)) { problems.push(`form ${i + 1}: the form file is missing from ${src}`); continue; }

    // name: <serial>_<NMS or EDC>_<original name>, never the same twice
    let head = '';
    try { const fd = fs.openSync(src, 'r'); const b = Buffer.alloc(1024); const n = fs.readSync(fd, b, 0, 1024, 0); fs.closeSync(fd); head = sniffAttachment(b.subarray(0, n)) || ''; } catch { /* no type */ }
    const original = (r.upac_form_name || '').trim();
    const ext = path.extname(original).toLowerCase() || EXT[head] || '.bin';
    const stem = safePart(path.basename(original, path.extname(original)), 60) || 'UPAC_Form';
    const who = safePart(r.nms_id || r.edc_no || '', 40) || 'no-id';
    const base = `${String(i + 1).padStart(5, '0')}_${who}_${stem}`;
    let name = `${base}${ext}`;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base}_${k}${ext}`;
    used.add(name.toLowerCase());

    const dest = path.join(FILES, name);
    let ok = false;
    try {
      if (fs.existsSync(dest) && (await hashFile(dest)) === r.sha256) { ok = true; kept++; }
      else {
        const tmp = `${dest}.part`;
        fs.copyFileSync(src, tmp);
        if ((await hashFile(tmp)) !== r.sha256) {
          fs.rmSync(tmp, { force: true });
          problems.push(`form ${i + 1}: the stored form is damaged (its content does not match its fingerprint)`);
        } else {
          fs.renameSync(tmp, dest);
          ok = true; copied++;
        }
      }
    } catch (e: any) {
      problems.push(`form ${i + 1}: could not copy (${e?.message || e})`);
    }
    if (ok) {
      entries.push({
        logId: r.log_id, serial: i + 1, nmsId: r.nms_id || '', edcNo: r.edc_no || '', customer: r.customer_name || '',
        originalName: original, sha256: r.sha256, size: Number(r.size), file: `files/${name}`, binned: Boolean(r.deleted_at) || r.log_no === null,
      });
    }
    if ((i + 1) % 100 === 0) say(`  ${i + 1} of ${rows.length} ...`);
  }

  const manifest = {
    format: 'pace-it-upac-export', version: 1, exportedAt: new Date().toISOString(), database: LIVE,
    complete: problems.length === 0, count: entries.length, expected: rows.length,
    bytes: entries.reduce((n, e) => n + e.size, 0), problems, entries,
  };
  const tmp = path.join(OUT, 'manifest.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmp, path.join(OUT, 'manifest.json'));

  // a list that opens in Excel
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['SL,NMS ID,EDC no,Institute,Original file name,File,Size (bytes),Deleted connection']
    .concat(entries.map((e) => [e.serial, q(e.nmsId), q(e.edcNo), q(e.customer), q(e.originalName), q(e.file), e.size, e.binned ? 'yes' : ''].join(',')));
  fs.writeFileSync(path.join(OUT, 'list.csv'), '\ufeff' + csv.join('\r\n') + '\r\n');

  say('');
  say(`Copied ${copied} new file(s), ${kept} were already there and checked.`);
  if (problems.length) {
    say(`\n${problems.length} PROBLEM(S) - the export is NOT complete:`);
    problems.slice(0, 50).forEach((p) => say('  - ' + p));
    if (problems.length > 50) say(`  ... and ${problems.length - 50} more`);
    say('\nNothing was changed in the database. Fix or restore the files named above (from a backup), then run this again.');
    process.exit(1);
  }
  say(`Export complete: ${entries.length} form(s) in ${OUT}`);
  say('Open list.csv to see which file belongs to which connection. Keep this folder safe.');
  say(`Next:  npm run upac:cleanup -- "${OUT}"`);
}

main().catch((e) => die(String(e?.message || e)));
