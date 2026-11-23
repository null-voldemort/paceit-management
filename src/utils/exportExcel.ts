import { billMonthsOf } from './bills';
import { monthLabel } from './months';
import { downloadRowsXlsx } from './xlsxWrite';
import { LogEntry } from '../types';

export async function exportBatchLogsExcel(logs: LogEntry[]): Promise<void> {
  const rows = logs.map((l, i) => ({
    'SL': i + 1,
    'Date': l.date,
    'Institute Name (Customer)': l.customerName,
    'Institute Name (Bangla)': l.nameBn || '',
    'Institute Name (English)': l.nameEn || '',
    'Foreman Name': l.foremanName,
    'Foreman Phone': l.foremanPhone || '',
    'Head Teacher / In-Charge Name': l.headTeacherName || '',
    'Head Teacher / In-Charge Phone': l.headTeacherPhone || '',
    'NMS ID': l.nmsId,
    'EDC Book No': l.edcNo || '',
    'Emis / EIIN / DGHS': l.emisEiinDghs || '',
    'Upazila': l.upazila || '',
    'Union / Ward': l.unionName || '',
    'Latitude': l.lat || '',
    'Longitude': l.long || '',
    'MAC Address': l.mac || '',
    'Router Serial': l.routerSerial || '',
    'Router Model': l.routerModel || '',
    'ONU (Qty)': l.onu || '',
    'Termination Box / TJ Box (Qty)': l.terminationBox || '',
    'Fiber Patch Cord / Patch Cord (Qty)': l.patchCord || '',
    'Optical Fiber Length (meters)': l.fiberLength || '',
    'Request Type': l.requestType,
    'Status': l.status,
    'Issue Found': l.issueFound || '',
    'Missing/Wrong Details': l.missingWrongDetails || '',
    'Action Taken': l.actionTaken || '',
    'Reason For Action': l.reasonForAction || '',
    'Foreman Informed': l.foremanInformed || '',
    'Follow Up Needed': l.followUpNeeded || '',
    'Follow Up Date': l.followUpDate || '',
    'Supervisor Informed': l.supervisorInformed || '',
    'Remarks': l.remarks || '',
    'Form Received At': l.formReceivedAt || '',
    'Bill Received Months': billMonthsOf(l).map((m) => monthLabel(m)).join(', '),
    'Created At': l.createdAt || '',
    'Created By': l.createdBy || '',
  }));

  await downloadRowsXlsx(`Pace_IT_Records_${new Date().toISOString().slice(0, 10)}.xlsx`, 'Pace IT Connections', rows);
}

export async function exportSingleLogExcel(log: LogEntry): Promise<void> {
  const data = [
    { Field: 'Date', Value: log.date },
    { Field: 'Institute Name (Customer)', Value: log.customerName },
    { Field: 'Foreman Name', Value: log.foremanName },
    { Field: 'Foreman Phone', Value: log.foremanPhone || '' },
    { Field: 'Head Teacher / In-Charge Name', Value: log.headTeacherName || '' },
    { Field: 'Head Teacher Phone', Value: log.headTeacherPhone || '' },
    { Field: 'Upazila / City Corporation', Value: log.upazila || '' },
    { Field: 'Union / Ward', Value: log.unionName || '' },
    { Field: 'Coordinates (Lat, Long)', Value: [log.lat, log.long].filter(Boolean).join(', ') },
    { Field: 'NMS ID', Value: log.nmsId },
    { Field: 'EDC Book No.', Value: log.edcNo || '' },
    { Field: 'Emis / EIIN / DGHS', Value: log.emisEiinDghs || '' },
    { Field: 'Router Serial No.', Value: log.routerSerial || '' },
    { Field: 'Router Model', Value: log.routerModel || '' },
    { Field: 'ONU (Qty)', Value: log.onu || '' },
    { Field: 'Termination Box / TJ Box (Qty)', Value: log.terminationBox || '' },
    { Field: 'Fiber Patch Cord / Patch Cord (Qty)', Value: log.patchCord || '' },
    { Field: 'MAC Address', Value: log.mac || '' },
    { Field: 'Optical Fiber Cable Length (meters)', Value: log.fiberLength || '' },
    { Field: 'Request Type', Value: log.requestType },
    { Field: 'Status', Value: log.status },
    { Field: 'Issue Found', Value: log.issueFound || '' },
    { Field: 'Missing / Wrong Details', Value: log.missingWrongDetails || '' },
    { Field: 'Action Taken', Value: log.actionTaken || '' },
    { Field: 'Reason For Action', Value: log.reasonForAction || '' },
    { Field: 'Foreman Informed', Value: log.foremanInformed || '' },
    { Field: 'Follow-up Needed', Value: log.followUpNeeded || '' },
    { Field: 'Follow-up Date', Value: log.followUpDate || '' },
    { Field: 'Supervisor Informed', Value: log.supervisorInformed || '' },
    { Field: 'Remarks', Value: log.remarks || '' },
    { Field: 'Form Received At', Value: log.formReceivedAt || '' },
    { Field: 'Bill Received Months', Value: billMonthsOf(log).map((m) => monthLabel(m)).join(', ') },
    { Field: 'Created At', Value: log.createdAt || '' },
    { Field: 'Created By', Value: log.createdBy || '' },
  ];

  await downloadRowsXlsx(`Pace_IT_Connection_${(log.nameEn || log.nmsId || 'record').toString().replace(/[^a-zA-Z0-9]+/g, '_')}.xlsx`, 'Connection', data);
}

/** Connection Records "Simple list": the server fills the records into template/End User Connections List.xlsx
 *  (the End User Connections List Format), so the layout is exactly the template's. */
export async function exportConnectionsTemplateXlsx(logs: LogEntry[]): Promise<void> {
  const res = await fetch('/api/logs/export-connections', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: logs.map((l) => l.id) }),
  });
  if (!res.ok) {
    let msg = 'Export failed.';
    try { msg = (await res.json())?.error || msg; } catch { /* keep the default */ }
    throw new Error(msg);
  }
  const name = decodeURIComponent(res.headers.get('X-Filename') || '') || `End_User_Connections_List_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
