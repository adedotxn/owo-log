export interface Transaction {
  date: string;
  time: string;
  amount: number;
  narration: string;
  balance: number;
  bank: string;
  direction: "debit" | "credit";
}

export interface CategorizedTransaction extends Transaction {
  category: string;
  flagged: boolean;
}

export type EmailParser = (subject: string, body: string) => Transaction | null;

export interface CategoryRule {
  category: string;
  keywords: string[];
}
