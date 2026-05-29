export interface Salesperson {
  name: string;
  email: string;
  phone?: string;
}

export interface Branch {
  name: string;
  headName: string;
  headEmail: string;
  headPhone: string;
  salespeople: Salesperson[];
}

export interface Claim {
  id: string;
  claimDate: string;
  submitDate: string;
  claimantName: string;
  claimantEmail: string;
  title: string;
  amount: number;
  category: string;
  branch: string;
  description: string;
  attachmentUrl?: string; // Google Drive url
  status: 'Pending' | 'Approved' | 'Rejected' | 'Processed' | 'Released' | 'Payment Process On Going';
  remarks?: string;
  rowIndex?: number;
  sheetName?: string;
  approved?: string;
  approvedDetails?: string;
  paymentProcess?: string;
  processedBy?: string;
  paymentRelease?: string;
  releasedBy?: string;
  totalAmount?: number;
  holdItemIndexes?: number[];
  items?: Array<{
    title: string;
    description: string;
    amount: number | string;
    category: string;
    claimDate: string;
    attachmentUrl?: string;
  }>;
}
