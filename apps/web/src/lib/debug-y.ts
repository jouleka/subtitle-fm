import type { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

export function exposeDocForDebug(provider: HocuspocusProvider): void {
  if (!import.meta.env.DEV) return;
  if (typeof window === "undefined") return;
  (window as unknown as {
    __y: {
      setCueText: (i: number, text: string) => void;
      setNeedsReview: (i: number, value: boolean) => void;
    };
  }).__y = {
    setCueText(i, text) {
      const yArr = provider.document.getArray<Y.Map<unknown>>("cues");
      const item = yArr.get(i);
      if (!item) return;
      const yText = item.get("text") as Y.Text;
      yText.delete(0, yText.length);
      yText.insert(0, text);
    },
    setNeedsReview(i, value) {
      const yArr = provider.document.getArray<Y.Map<unknown>>("cues");
      const item = yArr.get(i);
      if (!item) return;
      item.set("needsReview", Boolean(value));
    },
  };
}
