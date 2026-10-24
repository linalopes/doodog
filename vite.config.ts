import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: 'localhost',
    port: 5173,
  },
  /**
   * Phase 02+ note: MuJoCo WebAssembly builds that use threads need
   * SharedArrayBuffer, which requires cross-origin isolation:
   *   Cross-Origin-Opener-Policy: same-origin
   *   Cross-Origin-Embedder-Policy: require-corp
   * Those headers are deliberately not enabled yet because they also restrict
   * third-party resources (fonts, the sandboxed iframe's srcdoc assets). They
   * will be introduced together with the physics adapter.
   */
});
