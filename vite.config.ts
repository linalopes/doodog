import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: 'localhost',
    port: 5173,
  },
  /**
   * The physics experiment uses the single-threaded `@mujoco/mujoco` build.
   * That build does not need SharedArrayBuffer, so these headers stay off:
   *   Cross-Origin-Opener-Policy: same-origin
   *   Cross-Origin-Embedder-Policy: require-corp
   * The multi-threaded build (`@mujoco/mujoco/mt`) would require them. They
   * would also block Google Fonts and can stop the sandboxed p5 iframe from
   * loading its classic script. Do not enable them for the single-thread build.
   */
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
});
