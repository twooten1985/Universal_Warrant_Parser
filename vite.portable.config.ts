import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { defineConfig } from 'vite';

/** CSS only. The viewer script is an IIFE so it loads from a file:// page. */
export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    outDir: 'dist/portable',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/portable/style-entry.ts'),
      output: {
        format: 'es',
        entryFileNames: 'style-entry.js',
        assetFileNames: 'viewer.css',
      },
    },
  },
});
