import { defineConfig } from 'vite';
export default defineConfig({ publicDir: 'backend/public', server: { proxy: { '/api': 'http://127.0.0.1:3103' } } });
