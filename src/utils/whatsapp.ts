import { LogEntry } from '../types';

export function waLink(phone?: string, message?: string): string | null {
  if (!phone) return null;
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  if (!cleanPhone || cleanPhone.length < 8) return null;

  const intlPhone = cleanPhone.startsWith('880')
    ? cleanPhone
    : cleanPhone.startsWith('0')
    ? '880' + cleanPhone.slice(1)
    : cleanPhone;

  const encodedMsg = message ? encodeURIComponent(message) : '';
  return `https://wa.me/${intlPhone}${encodedMsg ? `?text=${encodedMsg}` : ''}`;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const bn = (v: string | number) => String(v).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);

// Forms chase message: in Bangla, numbered, with the full list (never "and N more"). Only the NMS ID is in English digits.
export function chaseMessage(foremanName: string, logs: LogEntry[]): string {
  const greeting = foremanName ? `প্রিয় ${foremanName},` : 'প্রিয় ভাই,';
  const items = logs.map((l, i) => `${bn(i + 1)}. ${l.customerName || 'প্রতিষ্ঠান'} (NMS: ${l.nmsId || 'নেই'})`).join('\n');
  return `${greeting}\nআপনার কাছে বর্তমানে ${bn(logs.length)}টি প্রতিষ্ঠানের ফরম জমা দেওয়া বাকি রয়েছে।\n${items}\nঅনুগ্রহ করে যত দ্রুত সম্ভব ফরমগুলো জমা দেওয়ার ব্যবস্থা করবেন।\nধন্যবাদান্তে,\nপেইস আইটি`;
}

export function billChaseMessage(foremanName: string, logs: LogEntry[], monthText: string): string {
  const prefix = foremanName ? `Dear ${foremanName}, ` : 'Hello, ';
  if (logs.length === 1) {
    const l = logs[0];
    return `${prefix}please submit the ${monthText} bill for ${l.customerName || 'Institute'} (NMS: ${l.nmsId || 'N/A'}, EDC: ${l.edcNo || 'N/A'}). Thank you, Pace IT.`;
  }
  const count = logs.length;
  const items = logs.slice(0, 5).map((l) => `• ${l.customerName || 'Institute'} (NMS: ${l.nmsId || 'N/A'})`).join('\n');
  return `${prefix}you have ${count} pending ${monthText} bills awaiting submission:\n${items}${count > 5 ? `\n...and ${count - 5} more` : ''}\nPlease submit them at your earliest convenience. Thank you, Pace IT.`;
}

// wa.me puts the whole message in the link, and Bangla letters take about nine characters each once encoded,
// so a long list can exceed what WhatsApp accepts in a link. Past this size the message is copied instead.
const MAX_LINK = 4000;
export const waNeedsCopy = (phone: string | undefined, message: string) => (waLink(phone, message) || '').length > MAX_LINK;
