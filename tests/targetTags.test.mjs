import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeTagInput, isOverdue, daysBetween, fmtDay } from '../src/utils/targetTags.ts';

const require = createRequire(import.meta.url);
let tsxAvailable = true;
try { require.resolve('tsx'); } catch { tsxAvailable = false; }

const TODAY = '2026-10-27';

test('a promise needs a foreman; the expected date cannot be before the day it was promised', () => {
  assert.throws(() => normalizeTagInput({ kind: 'promised' }, TODAY), /foreman/i);
  assert.throws(() => normalizeTagInput({ kind: 'promised', foremanName: 'Salam', taggedOn: '2026-10-20', expectedBy: '2026-10-01' }, TODAY), /before/);
  const t = normalizeTagInput({ kind: 'promised', foremanId: 'f1', foremanName: ' Salam ', expectedBy: '2026-11-05', note: '  after   Eid ' }, TODAY);
  assert.deepEqual(t, { kind: 'promised', taggedOn: TODAY, foremanId: 'f1', foremanName: 'Salam', expectedBy: '2026-11-05', note: 'after Eid' });
});

test('a rejection defaults to the first stage and refuses an unknown one; a foreman is optional', () => {
  assert.equal(normalizeTagInput({ kind: 'rejected' }, TODAY).stage, 'Rejected');
  assert.equal(normalizeTagInput({ kind: 'rejected', stage: 'Application sent' }, TODAY).stage, 'Application sent');
  assert.throws(() => normalizeTagInput({ kind: 'rejected', stage: 'Whatever' }, TODAY), /stage/);
  assert.equal('expectedBy' in normalizeTagInput({ kind: 'rejected', expectedBy: '2026-12-01' }, TODAY), false, 'an expected date means nothing for a rejection');
});

test('bad kinds and impossible dates are refused', () => {
  assert.throws(() => normalizeTagInput(null, TODAY), /Choose/);
  assert.throws(() => normalizeTagInput({ kind: 'left' }, TODAY), /Promised or Rejected/);
  assert.throws(() => normalizeTagInput({ kind: 'rejected', taggedOn: '2026-02-31' }, TODAY), /date/);
  assert.throws(() => normalizeTagInput({ kind: 'rejected', taggedOn: '27/10/2026' }, TODAY), /date/);
});

test('overdue only applies to a promise whose expected day has passed', () => {
  const base = { edc: '1', taggedOn: '2026-10-01' };
  assert.equal(isOverdue({ ...base, kind: 'promised', foremanName: 'x', expectedBy: '2026-10-26' }, TODAY), true);
  assert.equal(isOverdue({ ...base, kind: 'promised', foremanName: 'x', expectedBy: '2026-10-27' }, TODAY), false, 'due today is not overdue yet');
  assert.equal(isOverdue({ ...base, kind: 'promised', foremanName: 'x' }, TODAY), false);
  assert.equal(isOverdue({ ...base, kind: 'rejected', expectedBy: '2026-10-01' }, TODAY), false);
  assert.equal(daysBetween('2026-10-20', TODAY), 7);
  assert.equal(fmtDay('2026-11-05'), '05 Nov 2026');
});

const childSource = String.raw`
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const origLog = console.log; console.log = () => {}; console.warn = () => {};
const load = (f) => import(pathToFileURL(path.resolve(f)).href);
let db;
try {
  ({ db } = await load('server/db.ts'));
  await db.ready();
  const { importTargets } = await load('server/targets.ts');
  const { buildTargetRows, computeStats } = await load('src/utils/targets.ts');
  const user = { id: 'u', username: 'u', displayName: 'Tester', role: 'user', disabled: false, createdAt: new Date().toISOString() };

  // the target list: 4 institutes in Balaganj
  importTargets([101, 102, 103, 104].map((n) => ({ edc: String(n), upazila: 'Balaganj', category: 'Primary Education', name: 'School ' + n, union: '', contact: '', mobile: '', emis: '' })), {});
  const targets = (await load('server/targets.ts')).loadTargets();
  assert.equal(targets.length, 4);

  // 101 promised, 102 rejected, 103 connected (record exists) but also promised -> the record wins, 104 untouched
  db.setTargetTags(['101', '103'], { kind: 'promised', foremanName: 'Salam', expectedBy: '2099-01-01' }, user);
  db.setTargetTags(['102'], { kind: 'rejected', stage: 'In process', note: 'application sent' }, user);
  const logs = [{ id: 'L1', logNo: 1, edcNo: '103', customerName: 'School 103', nmsId: 'N1', upazila: 'Balaganj', foremanName: 'Salam', date: '25 Oct 2026' }];
  const rows = buildTargetRows(targets, logs, db.listTargetTags());
  const by = Object.fromEntries(rows.map((r) => [r.edc, r]));
  assert.equal(by['101'].status, 'promised');
  assert.equal(by['102'].status, 'rejected');
  assert.equal(by['103'].status, 'connected', 'a connection record wins over a tag');
  assert.equal(by['103'].tag, undefined);
  assert.equal(by['104'].status, 'left');
  const o = computeStats(rows).overall;
  assert.deepEqual({ ...o }, { total: 4, connected: 1, promised: 1, rejected: 1, left: 1 });
  assert.equal(o.connected + o.promised + o.rejected + o.left, o.total, 'the four states add up to the total');

  // importing the workbook again (even replacing the list) keeps every tag
  importTargets([{ edc: '101', upazila: 'Balaganj', category: 'Primary Education', name: 'School 101', union: '', contact: '', mobile: '', emis: '' }], { replace: true });
  assert.equal(db.listTargetTags().length, 3);

  // tags survive a full backup + restore, and are in the backup at all
  const backup = db.exportFull();
  assert.ok(backup.tables.target_tags);
  db.removeTargetTags(['101', '102', '103'], user);
  assert.equal(db.listTargetTags().length, 0);
  await db.restoreFull(backup, user);
  assert.equal(db.listTargetTags().length, 3);

  // removing a mark sends the institute back to Left
  assert.equal(db.removeTargetTags(['101'], user).removed, 1);
  assert.equal(buildTargetRows(targets, logs, db.listTargetTags()).find((r) => r.edc === '101').status, 'left');

  // foreman's name comes from the directory, not from what the browser sent
  const f = db.getForemen()[0];
  db.setTargetTags(['104'], { kind: 'promised', foremanId: f.id, foremanName: 'Someone else' }, user);
  assert.equal(db.listTargetTags().find((t) => t.edc === '104').foremanName, f.name);

  // bad input changes nothing
  const before = db.listTargetTags().length;
  assert.throws(() => db.setTargetTags([], { kind: 'rejected' }, user), /at least one/);
  assert.throws(() => db.setTargetTags(['101'], { kind: 'promised' }, user), /foreman/i);
  assert.equal(db.listTargetTags().length, before);
} finally {
  if (db) { try { db.close(); } catch {} }
  console.log = origLog;
}
process.stdout.write('TARGET_TAGS_PASS\n');
`;

test('Promised / Rejected tags: statuses, import keeps them, backup and restore, foreman lookup', { skip: !tsxAvailable && 'tsx is not installed; install dependencies to run the real SQLite test' }, () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-tags-'));
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childSource], {
      cwd: process.cwd(), env: { ...process.env, PACE_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 90_000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(result.error, undefined, `child process could not run: ${result.error?.message}`);
    assert.equal(result.status, 0, `target tags test failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /TARGET_TAGS_PASS/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
