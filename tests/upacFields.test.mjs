import test from 'node:test';
import assert from 'node:assert/strict';
import { coerceFormFields, logToFormFields, parseLogDate, formDateOf, hasFormContent, FORM_FIELDS, ROUTER_MODELS, CABLE_BRANDS } from '../server/upacFields.ts';
import { validateFullBackupShape } from '../server/validation.ts';

test('log dates in the app format and ISO are read; anything else is not', () => {
  assert.equal(parseLogDate('05 Oct 2026'), '2026-10-05');
  assert.equal(parseLogDate('5 October 2026'), '2026-10-05');
  assert.equal(parseLogDate('2026-10-05'), '2026-10-05');
  assert.equal(parseLogDate('2026-10-05T10:00:00.000Z'), '2026-10-05');
  assert.equal(parseLogDate('31 Feb 2026'), '');
  assert.equal(parseLogDate('yesterday'), '');
  assert.equal(parseLogDate(''), '');
  assert.equal(parseLogDate(undefined), '');
});

test('the form date is the connection date, or today when it cannot be read', () => {
  const now = new Date(2026, 9, 28, 12, 0, 0);
  assert.equal(formDateOf({ date: '05 Oct 2026' }, now), '2026-10-05');
  assert.equal(formDateOf({ date: 'garbage' }, now), '2026-10-28');
  assert.equal(formDateOf({}, now), '2026-10-28');
});

test('coerceFormFields fills every field, trims, and only accepts listed router and cable values', () => {
  const f = coerceFormFields({ name: '  School  ', router_model: 'Unknown X', cable_brand: 'OFS', cable_qty: '' });
  assert.deepEqual(Object.keys(f), FORM_FIELDS.map((x) => x.key));
  assert.equal(f.name, 'School');
  assert.equal(f.router_model, ROUTER_MODELS[0]);
  assert.equal(f.cable_brand, 'OFS');
  assert.equal(f.cable_qty, '1500');
  assert.equal(coerceFormFields(null).name, '');
  assert.equal(hasFormContent(coerceFormFields({})), false);
  assert.equal(hasFormContent(coerceFormFields({ source_no: '12' })), true);
});

test('a record made by the Form Maker gives back the same form fields', () => {
  // what FormMaker.tsx saves into the record after a download, and what it had typed into the form
  const typed = {
    name: 'Beanibazar Govt. College', mobile: '01712345678', union: 'Dobhag', upazila: 'বিয়ানীবাজার', source_no: '19',
    connection_nms: 'NMS-1', institution_code: '123456', lat_long: '24.9, 91.8', router_serial: 'SN1', router_mac: 'AA:BB:CC:DD:EE:FF',
    router_model: 'TP-Link - AX15', cable_brand: 'Corning', cable_qty: '900',
  };
  const record = {
    customerName: typed.name, headTeacherPhone: typed.mobile, unionName: typed.union, upazila: 'Beanibazar', edcNo: typed.source_no,
    nmsId: typed.connection_nms, emisEiinDghs: typed.institution_code, lat: '24.9', long: '91.8', routerSerial: typed.router_serial,
    mac: typed.router_mac, routerModel: typed.router_model, cableBrand: typed.cable_brand, fiberLength: typed.cable_qty,
  };
  assert.deepEqual(logToFormFields(record), coerceFormFields(typed));
});

test('an old record without router or cable gets the standard ones; an unknown upazila is kept as written', () => {
  const f = logToFormFields({ customerName: 'X', upazila: 'Somewhere Else', lat: '24.1' });
  assert.equal(f.router_model, ROUTER_MODELS[0]);
  assert.equal(f.cable_brand, CABLE_BRANDS[0]);
  assert.equal(f.upazila, 'Somewhere Else');
  assert.equal(f.lat_long, '24.1');
});

// --- backup files made before the router / cable columns existed still restore ---
const logsCols = ['id', 'log_no', 'date', 'foreman_name', 'request_type', 'customer_name', 'status', 'router_model', 'cable_brand'];
const usersCols = ['id', 'username', 'display_name', 'password', 'role', 'disabled'];
function backup(logColumns) {
  const tables = {
    users: { columns: usersCols, rows: [['u1', 'a', 'A', 'x', 'admin', 0]] },
    logs: { columns: logColumns, rows: [] },
  };
  return { format: 'pace-it-full-backup', version: 5, appName: 'Pace IT', exportedAt: new Date().toISOString(), counts: { users: 1, logs: 0 }, tables };
}
const opts = { knownTables: ['users', 'logs'], columnsByTable: { users: usersCols, logs: logsCols } };

test('a version 5 backup without the later columns is accepted; one with a missing or unknown other column is not', () => {
  assert.doesNotThrow(() => validateFullBackupShape(backup(logsCols), opts));
  assert.doesNotThrow(() => validateFullBackupShape(backup(logsCols.slice(0, 7)), opts));
  assert.throws(() => validateFullBackupShape(backup(logsCols.filter((c) => c !== 'status')), opts), /version 5 schema|required columns/);
  assert.throws(() => validateFullBackupShape(backup([...logsCols, 'surprise']), opts), /version 5 schema/);
});

// --- router model: one list for the browser and the server ---
import { matchChoice, ROUTER_MODELS as LIST } from '../src/utils/formChoices.ts';

test('a pasted router model is matched to the listed name; unclear or unknown values are not', () => {
  assert.equal(matchChoice('H3C - NX30', LIST), 'H3C - NX30');
  assert.equal(matchChoice('h3c nx30', LIST), 'H3C - NX30');
  assert.equal(matchChoice('NX30', LIST), 'H3C - NX30');
  assert.equal(matchChoice(' tp-link ax15 ', LIST), 'TP-Link - AX15');
  assert.equal(matchChoice('ax15', LIST), 'TP-Link - AX15');
  assert.equal(matchChoice('H3C', LIST), null, 'too short to be sure');
  assert.equal(matchChoice('Huawei X1', LIST), null);
  assert.equal(matchChoice('', LIST), null);
  assert.equal(matchChoice(undefined, LIST), null);
  assert.equal(matchChoice('x', ['Alpha One', 'Alpha Two']), null);
  assert.equal(matchChoice('alpha', ['Alpha One', 'Alpha Two']), null, 'fits two choices');
});

test('a form made from a record with a short or messy router model still prints the listed one', () => {
  assert.equal(logToFormFields({ customerName: 'X', routerModel: 'ax15' }).router_model, 'TP-Link - AX15');
  assert.equal(logToFormFields({ customerName: 'X', routerModel: 'something else' }).router_model, LIST[0]);
});

import { routerKeyOf, NO_ROUTER } from '../src/utils/formChoices.ts';

test('the router filter groups connections by listed model, "not set", or the name as written', () => {
  assert.equal(routerKeyOf('H3C - NX30'), 'H3C - NX30');
  assert.equal(routerKeyOf(' nx30 '), 'H3C - NX30');
  assert.equal(routerKeyOf('ax15'), 'TP-Link - AX15');
  assert.equal(routerKeyOf(''), NO_ROUTER);
  assert.equal(routerKeyOf(undefined), NO_ROUTER);
  assert.equal(routerKeyOf('Old Custom Router'), 'Old Custom Router', 'a name not on the list is kept, not hidden');
});
