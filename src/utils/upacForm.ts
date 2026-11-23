import { LogEntry } from '../types';
import { expectsForm } from './forms';
import { requestPdf, saveBlob, PdfCancelledError } from './pdfStream';

// The UPAC form is not stored anywhere. The server fills the form template from the connection's own details each
// time someone downloads it (the same way the Form Maker does) and turns it into a PDF, so there is nothing to attach,
// lose or back up. While it works, a window shows the real stage (see components/PdfProgress.tsx).

/** Connections that have a form (a new user ID, a form request or an EDC number) and enough details to fill it. */
export function canMakeUpacForm(log: LogEntry): boolean {
  return expectsForm(log) && Boolean(`${log.customerName || ''}${log.edcNo || ''}${log.nmsId || ''}`.trim());
}

/** Downloads the UPAC form of a saved connection. Rejects with a readable message when the form cannot be made;
 *  resolves quietly when the person cancels. */
export async function downloadUpacForm(log: Pick<LogEntry, 'id' | 'logNo'> & { customerName?: string }): Promise<void> {
  try {
    const { blob, filename } = await requestPdf(
      `/api/logs/${encodeURIComponent(log.id)}/upac-form?stream=1`,
      {},
      log.customerName || (log.logNo ? `connection ${log.logNo}` : 'this connection'),
    );
    saveBlob(blob, filename);
  } catch (e) {
    if (e instanceof PdfCancelledError) return;
    throw e;
  }
}
