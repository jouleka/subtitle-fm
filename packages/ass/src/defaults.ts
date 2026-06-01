import type { ParsedAss, AssCue, AssStyle, AssScriptInfo } from "./types";

export interface DefaultParsedAssInput {
  id: string;
  orderIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  styleName: string;
  speakerId: string | null;
}

const DEFAULT_INFO: AssScriptInfo = {
  Title: "Subtitle.fm",
  ScriptType: "v4.00+",
  WrapStyle: "0",
  ScaledBorderAndShadow: "yes",
  PlayResX: "1920",
  PlayResY: "1080",
};

const DEFAULT_STYLE: AssStyle = {
  Name: "Default",
  Fontname: "Arial",
  Fontsize: "48",
  PrimaryColour: "&H00FFFFFF",
  SecondaryColour: "&H000000FF",
  OutlineColour: "&H00000000",
  BackColour: "&H00000000",
  Bold: "0",
  Italic: "0",
  Underline: "0",
  StrikeOut: "0",
  ScaleX: "100",
  ScaleY: "100",
  Spacing: "0",
  Angle: "0",
  BorderStyle: "1",
  Outline: "2",
  Shadow: "1",
  Alignment: "2",
  MarginL: "60",
  MarginR: "60",
  MarginV: "80",
  Encoding: "1",
};

/**
 * Build a minimal ParsedAss from the editor's live cue list. The synthetic
 * info + single Default style are placeholders until the pipeline emits real
 * ASS headers; LiveCue editor input maps 1:1 onto DefaultParsedAssInput.
 */
export function defaultParsedAss(cues: DefaultParsedAssInput[]): ParsedAss {
  const assCues: AssCue[] = cues
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((c) => ({
      layer: 0,
      startMs: c.startMs,
      endMs: c.endMs,
      styleName: c.styleName || "Default",
      speaker: c.speakerId ?? "",
      marginL: 0,
      marginR: 0,
      marginV: 0,
      text: c.text,
    }));

  return {
    info: { ...DEFAULT_INFO },
    styles: [{ ...DEFAULT_STYLE }],
    cues: assCues,
  };
}
