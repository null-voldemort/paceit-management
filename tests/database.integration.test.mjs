import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let tsxAvailable = true;
try { require.resolve('tsx'); } catch { tsxAvailable = false; }

const childSource = String.raw`
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const originalLog = console.log;
const originalWarn = console.warn;
console.log = () => {};
console.warn = () => {};
let db;
try {
  ({ db } = await import(pathToFileURL(path.resolve('server/db.ts')).href));
  await db.ready();
  const user = { id: 'test-user', username: 'test_user', displayName: 'Test Operator', role: 'user', disabled: false, createdAt: new Date().toISOString() };
  const now = new Date().toISOString();
  const entry = {
    id: crypto.randomUUID(), logNo: 1, date: '25 Oct 2026', foremanName: 'Test Foreman', requestType: 'New User ID',
    customerName: 'Atomic Baseline School', nmsId: 'NMS-TEST-1', issueFound: '', missingWrongDetails: '', actionTaken: '',
    reasonForAction: '', foremanInformed: '', followUpNeeded: '', status: 'In Progress', supervisorInformed: '', remarks: '',
    mac: '', createdAt: now, updatedAt: now,
  };
  const created = db.saveLog(entry, user);
  assert.equal(db.getLogs().some((x) => x.id === created.id), true, 'saved row is persisted');

  // Forms are no longer attached: an older browser tab that still sends the attachment fields is not an error, and nothing is stored.
  const fromOldTab = db.saveLog({ ...created, customerName: 'Old Tab Save', upacFormName: 'old.pdf', upacFormData: '%%%not-base64' }, user, created.id);
  assert.equal(fromOldTab.upacFormData, undefined, 'retired attachment fields are not kept');
  assert.equal(db.getLogById(created.id).customerName, 'Old Tab Save');
  assert.equal(Number(db.sqlite.scalar('SELECT COUNT(*) FROM attachments')), 0, 'no attachment row is created');
  db.saveLog({ ...created, customerName: 'Atomic Baseline School' }, user, created.id);

  // router model and cable brand: stored, kept when a save does not carry them, cleared by an empty value
  db.saveLog({ ...created, routerModel: 'TP-Link - AX15', cableBrand: 'OFS' }, user, created.id);
  assert.equal(db.getLogById(created.id).routerModel, 'TP-Link - AX15');
  db.saveLog({ ...created, customerName: 'Atomic Baseline School' }, user, created.id);
  assert.equal(db.getLogById(created.id).cableBrand, 'OFS', 'a save without them keeps the stored values');
  db.saveLog({ ...created, routerModel: '', cableBrand: '' }, user, created.id);
  assert.equal(db.getLogById(created.id).routerModel, undefined, 'an empty value clears it');

  // ONU, termination box / TJ box and patch cord: stored, kept when a save does not carry them, cleared by an empty value, bulk-fillable
  db.saveLog({ ...created, onu: '1', terminationBox: '4', patchCord: '5' }, user, created.id);
  const withParts = db.getLogById(created.id);
  assert.deepEqual([withParts.onu, withParts.terminationBox, withParts.patchCord], ['1', '4', '5']);
  db.saveLog({ ...created, customerName: 'Atomic Baseline School' }, user, created.id);
  assert.equal(db.getLogById(created.id).onu, '1', 'a save without them keeps the stored values');
  assert.deepEqual(db.bulkFillField('terminationBox', [{ id: created.id, value: '০৬' }], user), { updated: 1, unchanged: 0, missing: 0 });
  assert.equal(db.getLogById(created.id).terminationBox, '6');
  assert.throws(() => db.saveLog({ ...created, onu: 'two' }, user, created.id), /whole number/);
  assert.equal(db.getLogById(created.id).onu, '1', 'a rejected save changes nothing');
  assert.ok(db.getLogById(created.id).history.some((h) => (h.changes || []).some((c) => c.field === 'patchCord')), 'the change is in the connection history');
  db.saveLog({ ...created, onu: '', terminationBox: '', patchCord: '' }, user, created.id);
  assert.equal(db.getLogById(created.id).onu, undefined, 'an empty value clears it');
  assert.equal(db.getLogById(created.id).patchCord, undefined);
  assert.equal(db.getLogById('no-such-id'), null);

  // bulk fill of the router model: short forms are stored as the listed name; an unknown model rejects the whole batch
  const bulk = db.bulkFillField('routerModel', [{ id: created.id, value: 'nx30' }], user);
  assert.deepEqual(bulk, { updated: 1, unchanged: 0, missing: 0 });
  assert.equal(db.getLogById(created.id).routerModel, 'H3C - NX30');
  assert.deepEqual(db.bulkFillField('routerModel', [{ id: created.id, value: 'H3C - NX30' }], user), { updated: 0, unchanged: 1, missing: 0 });
  assert.throws(() => db.bulkFillField('routerModel', [{ id: created.id, value: 'ax15' }, { id: created.id, value: 'Mystery 9' }], user), /not a known router model/);
  assert.equal(db.getLogById(created.id).routerModel, 'H3C - NX30', 'a rejected batch changes nothing');
  // the selection bar's Router menu: set for many, short forms accepted, unknown rejected, empty clears
  assert.deepEqual(db.bulkSetField([created.id], 'routerModel', 'AX15', user), { updated: 1, unchanged: 0, missing: 0 });
  assert.equal(db.getLogById(created.id).routerModel, 'TP-Link - AX15');
  assert.deepEqual(db.bulkSetField([created.id, 'gone'], 'routerModel', 'TP-Link - AX15', user), { updated: 0, unchanged: 1, missing: 1 });
  assert.throws(() => db.bulkSetField([created.id], 'routerModel', 'Mystery 9', user), /not a known router model/);
  assert.deepEqual(db.bulkSetField([created.id], 'routerModel', '', user), { updated: 1, unchanged: 0, missing: 0 });
  assert.equal(db.getLogById(created.id).routerModel, undefined);
  db.bulkSetField([created.id], 'routerModel', 'nx30', user);
  assert.ok(db.getLogById(created.id).history.some((h) => (h.changes || []).some((c) => c.field === 'routerModel')), 'the change is in the connection history');

  const malformed = structuredClone(db.exportFull());
  malformed.tables.logs.columns = [];
  malformed.tables.logs.rows = [];
  malformed.counts.logs = 0;
  await assert.rejects(db.restoreFull(malformed, user), /invalid columns/);
  assert.equal(db.getLogs().find((x) => x.id === created.id)?.customerName, 'Atomic Baseline School', 'malformed restore leaves live row untouched');

  const interrupted = structuredClone(db.exportFull());
  interrupted.tables.settings.rows.push([...interrupted.tables.settings.rows[0]]);
  interrupted.counts.settings = interrupted.tables.settings.rows.length;
  await assert.rejects(db.restoreFull(interrupted, user), /constraint failed|UNIQUE/i);
  assert.equal(db.getLogs().find((x) => x.id === created.id)?.customerName, 'Atomic Baseline School', 'mid-restore SQL failure rolls every table back');

  db.saveLog({ ...entry, id: crypto.randomUUID(), logNo: 2, customerName: 'Second Row' }, user);
  const restore = await db.restoreFull(db.exportFull(), user);
  assert.equal(restore.counts.logs, 2, 'a version-5 full backup round-trips through SQLite restore');

  // bulk status / follow-up / bin from the Connection Records selection bar
  const admin = { ...user, role: 'admin' };
  const second = db.getLogs().find((x) => x.customerName === 'Second Row');
  const pair = [created.id, second.id];
  assert.deepEqual(db.bulkSetField(pair, 'status', 'On Hold', user), { updated: 2, unchanged: 0, missing: 0 }, 'bulk status updates every selected row');
  assert.deepEqual(db.bulkSetField(pair, 'status', 'On Hold', user), { updated: 0, unchanged: 2, missing: 0 }, 'repeating the same bulk status changes nothing');
  assert.equal(db.getLogs().find((x) => x.id === created.id).status, 'On Hold');
  db.bulkSetField(pair, 'followUpDate', '2026-11-05', user);
  const followed = db.getLogs().find((x) => x.id === created.id);
  assert.equal(followed.followUpDate, '2026-11-05', 'bulk follow-up date is stored');
  assert.equal(followed.followUpNeeded, 'Yes', 'a follow-up date switches follow-up on');
  db.bulkSetField(pair, 'status', 'Resolved', user);
  const resolved = db.getLogs().find((x) => x.id === created.id);
  assert.equal(resolved.followUpNeeded, 'No', 'resolving in bulk switches follow-up off');
  assert.ok(!resolved.followUpDate, 'resolving in bulk clears the follow-up date');
  assert.ok(resolved.history.some((h) => h.changes?.some((c) => c.field === 'status' && c.to === 'Resolved')), 'bulk status change is written to the log history');
  assert.throws(() => db.bulkSetField(pair, 'status', '   ', user), /Choose a status/);
  assert.throws(() => db.bulkSetField(pair, 'followUpDate', 'tomorrow', user), /Follow-up date/);
  assert.throws(() => db.bulkSetField(pair, 'remarks', 'x', user), /cannot be changed in bulk/);
  assert.deepEqual(db.bulkSoftDelete([second.id, 'does-not-exist'], admin), { deleted: 1, missing: 1 }, 'bulk bin counts found and missing rows');
  assert.equal(db.getLogs().some((x) => x.id === second.id), false, 'a row moved to the bin by bulk delete leaves the list');

  db.softDeleteLog(created.id, { ...user, role: 'admin' });
  assert.throws(() => db.saveLog({ ...created, customerName: 'Hidden Row Mutation' }, user, created.id), /in the Bin/);
  assert.equal(db.getLogs().some((x) => x.id === created.id), false, 'a direct upsert cannot edit a soft-deleted row');
} finally {
  if (db) { try { db.close(); } catch {} }
  console.log = originalLog;
  console.warn = originalWarn;
}
process.stdout.write('DB_INTEGRATION_PASS\n');
`;

test('SQLite writes and full restore are atomic in an isolated temporary data directory', { skip: !tsxAvailable && 'tsx is not installed; install dependencies to run the real SQLite integration test' }, () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-db-integration-'));
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childSource], {
      cwd: process.cwd(),
      env: { ...process.env, PACE_DATA_DIR: dataDir },
      encoding: 'utf8',
      timeout: 90_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(result.error, undefined, `database child process could not run: ${result.error?.message}`);
    assert.equal(result.status, 0, `database integration failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /DB_INTEGRATION_PASS/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
