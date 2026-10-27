/** Source records remain lossless. User changes live in a separate IndexedDB store. */
export interface Style {
  color?: string; size?: string; bold?: boolean; underline?: boolean;
  indent?: number | string; [key: string]: unknown;
}
export interface Segment {
  id: string; type: string; text?: string; stars?: number; answer_id?: string;
  style?: Style; [key: string]: unknown;
}
export interface Note {
  id: string; segments: Segment[]; marker?: string; style?: Style; order?: number;
  [key: string]: unknown;
}
export interface Answer {
  id: string; question_id: string; blank_id: string; text: string; fill_text?: string;
  display_order?: number; style?: Style; [key: string]: unknown;
}
export interface Question {
  id: string; page_id: string; printed_number: string; kind: string;
  parent_id?: string | null; parent_printed_number?: string | null;
  chapter_number: number; importance_stars: number | null; order?: number;
  segments: Segment[]; notes: Note[]; answer_ids: string[];
  [key: string]: unknown;
}
export interface Page {
  id: string; page_number: number; era?: string; chapter?: string; section?: string;
  question_ids: string[]; chapter_candidates?: {number: number; title: string}[];
  [key: string]: unknown;
}
export interface SourceTable {
  id: string; page_id: string; related_question_id?: string | null;
  heading?: string; title?: string; columns?: string[]; rows?: unknown[][];
  [key: string]: unknown;
}
export interface PageExtra {
  id: string; page_id: string; heading?: string; title?: string;
  segments?: Segment[]; summary?: string; [key: string]: unknown;
}
export interface ReviewIssue {
  id: string; page_id?: string; question_id?: string; reason?: string;
  severity?: string; [key: string]: unknown;
}
export interface Dataset {
  schema_version: string; dataset_id: string; dataset_version?: string;
  pages: Page[]; questions: Question[]; answers: Answer[];
  tables?: SourceTable[]; page_extras?: PageExtra[]; review_issues?: ReviewIssue[];
  ready_for_production?: boolean; quality_note?: string;
  [key: string]: unknown;
}
export interface StudyQuestion {
  id: string; pageId: string; pageNumber: number; era: string; chapter: string;
  section: string; order: number; source: Question; answers: Answer[];
  tables: SourceTable[]; extras: PageExtra[];
}
