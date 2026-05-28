// Vite resolves these to URLs at build time: in dev it serves from the
// package; in prod it copies + hashes the files into the build output.
// Isolating these here keeps the editor page's imports readable.
//
// modernWasmUrl is the SIMD build — JASSUB selects it automatically when the
// browser supports WebAssembly SIMD, falling back to wasmUrl otherwise.
import workerUrl from "jassub/dist/jassub-worker.js?url";
import wasmUrl from "jassub/dist/jassub-worker.wasm?url";
import modernWasmUrl from "jassub/dist/jassub-worker-modern.wasm?url";

export const jassubAssets = { workerUrl, wasmUrl, modernWasmUrl } as const;
