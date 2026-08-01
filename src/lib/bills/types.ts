import type { RecurrenceRule, AmountType, Payment } from './billsEngine';

export interface BillRecord {
  id: string;
  store: string;
  vendor: string;
  category: string;
  recurrence: RecurrenceRule;
  amountType: AmountType;
  amountValue: number;
  payment: Payment;
  account: string | null;
  paidFrom: string | null;
  anchor: string | null;
  end: string | null;
  notes: string | null;
  active: boolean;
}
