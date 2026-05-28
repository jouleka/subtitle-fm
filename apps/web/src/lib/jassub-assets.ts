// Vite resolves these to URLs at build time: in dev it serves from the
// package; in prod it copies + hashes the files into the build output.
// Isolating these here keeps the editor page's imports readable.
import workerUrl from "jassub/dist/jassub-worker.js?url";
import wasmUrl from "jassub/dist/jassub-worker.wasm?url";

export const jassubAssets = { workerUrl, wasmUrl } as const;
