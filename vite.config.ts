import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [svelte()],

  // Relative asset paths: the Rust `asyar-extension://` scheme handler serves
  // `./view.js` / `./assets/*` out of the install directory, not from `/`.
  base: './',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      // Dual entry, and the filenames are load-bearing: the protocol handler
      // derives `window.__ASYAR_ROLE__` from the requested HTML filename, and
      // `asyar-sdk/view` / `asyar-sdk/worker` throw at module load when the
      // role does not match.
      input: {
        worker: resolve(rootDir, 'worker.html'),
        view: resolve(rootDir, 'view.html'),
      },
      output: {
        // Hash-free entry names so worker.html loads `./worker.js` and the
        // manifest's `background.main` names a file that exists.
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
