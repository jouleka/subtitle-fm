import type { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

/**
 * DEV-only: expose a small surface on `window.__y` so manual verification
 * can poke the Y.Doc from the browser console (set cue text by index,
 * read the array, etc.). No-op in production builds.
 */
export function exposeDocForDebug(provider: HocuspocusProvider): void {
  if (!import.meta.env.DEV) return;
  if (typeof window === "undefined") return;
  (window as unknown as {
    __y: {
      setCueText: (i: number, text: string) => void;
      provider: HocuspocusProvider;
    };
  }).__y = {
    provider,
    setCueText(i, text) {
      const yArr = provider.document.getArray<Y.Map<unknown>>("cues");
      const item = yArr.get(i);
      if (!item) return;
      const yText = item.get("text") as Y.Text;
      yText.delete(0, yText.length);
      yText.insert(0, text);
    },
  };
}
