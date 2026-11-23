export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  phoneNumber?: string;
  email?: string;
  photoUrl?: string;
  disabled?: boolean;
  createdAt?: string;
}

export interface StoredUser extends AppUser {
  password?: string;
}

export interface SecurityEvent {
  id: string;
  at: string;
  type: string;
  username: string;
  ip: string;
  detail: string;
  meta?: {
    browser?: string; os?: string; device?: string; ua?: string; deviceId?: string; screen?: string; tz?: string; lang?: string;
    host?: string; mac?: string; newDevice?: boolean;
  } | null;
}

export interface AdminUserSummary {
  id: string;
  username: string;
  displayName: string;
  role: string;
  phoneNumber?: string;
  email?: string;
  photoUrl?: string;
  disabled: boolean;
  createdAt: string;
  logCount?: number;
}

export interface LogChange {
  at: string;
  by: string;
  action: 'created' | 'edited';
  changes?: { field: string; from: string; to: string }[];
}

export interface LogEntry {
  id: string;
  logNo: number | string;
  date: string;
  foremanName: string;
  foremanPhone?: string; // Foreman phone number
  requestType: string;
  customerName: string; // Institute / School / Client name
  headTeacherName?: string; // Head Teacher / In-Charge Name
  headTeacherPhone?: string; // Head Teacher / In-Charge Phone
  nmsId: string; // NMS ID / Connection ID
  edcNo?: string; // EDC Book No. / সুত্র নং
  emisEiinDghs?: string; // EMIS / EIIN / DGHS institution code
  routerSerial?: string;
  mac: string;
  lat?: string; // Latitude
  long?: string; // Longitude
  unionName?: string; // Union / Ward / Pouroshova
  upazila?: string; // Upazila / City Corporation
  fiberLength?: string; // Fiber cable length in meters
  category?: string; // e.g. 01.Primary Education, 02.Secondary and Higher Secondary Education, etc.
  nameBn?: string; // Institute name in Bangla - this is the name shown in the logs
  nameEn?: string; // Institute name in English - kept for reference, not shown in the logs
  issueFound: string;
  missingWrongDetails: string;
  actionTaken: string;
  reasonForAction: string;
  foremanInformed: string;
  followUpNeeded: string;
  status: string;
  supervisorInformed: string;
  remarks: string;
  formReceivedAt?: string;
  billReceivedAt?: string;
  billMonths?: string[];
  term?: string; // e.g. 'First Term', 'Second Term'
  foremanId?: string;
  followUpDate?: string;
  routerModel?: string; // router on the UPAC form (the form itself is made on download, never stored)
  cableBrand?: string; // optical fiber cable brand on the UPAC form
  onu?: string; // quantity of ONU sent (whole number)
  terminationBox?: string; // quantity of termination boxes / TJ boxes sent
  patchCord?: string; // quantity of fiber patch cords / patch cords sent
  deletedAt?: string;
  deletedBy?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  history?: LogChange[];
}

export type MarkKind = 'form' | 'bill';
export type MarkAction = 'received' | 'not_received';

export interface ApprovalRequest {
  id: string;
  logId: string;
  logNo?: number | string;
  customer?: string;
  kind: MarkKind;
  action: MarkAction;
  requestedBy: string;
  requestedById?: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string;
  decidedAt?: string;
  month?: string;
  receivedOn?: string;
}

export interface ImportRequest {
  id: string;
  requestedBy: string;
  requestedById?: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string;
  decidedAt?: string;
  count: number;
  sample?: string;
}

export interface Foreman {
  id: string;
  name: string;
  area: string;
  phone: string;
  photoUrl?: string;
  active: boolean;
  roam?: boolean;
  roamAreas?: string[];
  createdAt: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface TeamMember {
  id: string;
  foremanId: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
  createdAt: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface ActivityEvent {
  id: string;
  at: string;
  by: string;
  action: string;
  logNo?: number | string;
  customer?: string;
  detail?: string;
}

export type LogFieldKey =
  | 'foremanName'
  | 'foremanPhone'
  | 'requestType'
  | 'customerName'
  | 'nmsId'
  | 'issueFound'
  | 'missingWrongDetails'
  | 'actionTaken'
  | 'reasonForAction'
  | 'foremanInformed'
  | 'followUpNeeded'
  | 'status'
  | 'supervisorInformed'
  | 'remarks'
  | 'mac'
  | 'upazila'
  | 'unionName'
  | 'category';

export type FieldSuggestionsMap = Record<string, string[]>;
