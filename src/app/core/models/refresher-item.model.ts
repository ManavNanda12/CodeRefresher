export interface RefresherItem {
  question: string;
  answer: string;
  codeExample: string;
  simpleExample: string;
}

export interface RefresherData {
  categories: Record<string, RefresherItem[]>;
}
