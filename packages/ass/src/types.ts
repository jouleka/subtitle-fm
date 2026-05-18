export interface AssEvent {
  startMs: number;
  endMs: number;
  style: string;
  speaker: string;
  text: string;
  rawOverrideTags: string;
}

export interface ParsedAss {
  scriptInfo: Record<string, string>;
  styles: Array<Record<string, string>>;
  events: AssEvent[];
}
