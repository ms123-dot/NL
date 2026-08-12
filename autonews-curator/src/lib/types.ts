
export type Category = 
  | "Corporate"
  | "Electrification"
  | "New Product"
  | "Auto Ancillary"
  | "Service"
  | "Govt"
  | "Global";

export interface NewsItem {
  id: string;
  date: string; // ISO string or YYYY-MM-DD
  category: Category;
  news: string;
  side: "l" | "r";
  remark: string;
  sourceLink?: string;
  originalHeadline?: string;
  fullText?: string;
  isEV?: boolean;
  weekday?: string;
}

export interface CurationResult {
  items: NewsItem[];
  summary: {
    totalRawRead: number;
    totalShortlisted: number;
    countsPerCategory: Record<Category, number>;
    flaggedDoubtful: { news: string; reason: string }[];
  };
}
