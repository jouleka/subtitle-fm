/**
 * Minimal valid ASS fixtures used across tests. Kept inline rather than as
 * separate files so tests stay self-contained and the fixtures double as
 * documentation of what the format looks like.
 */

export const MINIMAL_ASS = `[Script Info]
Title: Test
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello world
Dialogue: 0,0:00:04.00,0:00:06.00,Default,Speaker A,0,0,0,,Second line
`;

/**
 * Karaoke + transform + line-break — the "did override tags survive?" fixture.
 * Edits to the editor must never structurally parse these tags.
 */
export const OVERRIDE_HEAVY_ASS = `[Script Info]
Title: Override test
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,{\\k50}Ka{\\k60}ra{\\k40}o{\\k30}ke line
Dialogue: 0,0:00:05.50,0:00:08.50,Default,,0,0,0,,{\\fad(300,200)\\pos(960,540)}With\\Nline break
Dialogue: 0,0:00:09.00,0:00:11.00,Default,,0,0,0,,{\\t(0,1000,\\frz360)}Spinning text
`;
