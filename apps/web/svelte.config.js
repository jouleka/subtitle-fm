import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

function origin(value) {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

const apiOrigin = origin(process.env.PUBLIC_API_URL);
const collabOrigin = origin(process.env.PUBLIC_COLLAB_URL);
const connectSources = [
  'self',
  'https://*.r2.cloudflarestorage.com',
  ...(apiOrigin ? [apiOrigin] : ['http://localhost:3000']),
  ...(collabOrigin ? [collabOrigin] : ['ws://localhost:1234']),
];

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'base-uri': ['self'],
        'connect-src': connectSources,
        'font-src': ['self', 'data:'],
        'form-action': ['self'],
        'frame-ancestors': ['none'],
        'img-src': ['self', 'data:', 'https:'],
        'media-src': ['self', 'blob:', 'https:'],
        'object-src': ['none'],
        'script-src': ['self', 'wasm-unsafe-eval'],
        'style-src': ['self', 'unsafe-inline'],
        'worker-src': ['self', 'blob:'],
      },
    },
    alias: {
      $lib: 'src/lib',
    },
  },
};

export default config;
