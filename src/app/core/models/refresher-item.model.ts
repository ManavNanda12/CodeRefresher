export interface RefresherItem {
  question: string;
  answer: string;
  codeExample?: string;
  simpleExample: string;
}

export interface RefresherModule {
  icon: string;
  questions: RefresherItem[];
}

export interface RefresherCategory {
  modules: Record<string, RefresherModule>;
}

export interface RefresherData {
  categories: Record<string, RefresherCategory>;
}
