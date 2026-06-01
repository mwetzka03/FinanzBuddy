import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    watch: {
      ignored: [
        '**/src-tauri/target/**',
        '**/src-tauri/.cargo/**',
        '**/src-tauri/**/*.db',
        '**/src-tauri/**/*.db-wal',
        '**/src-tauri/**/*.db-shm',
      ],
    },
  },
});

