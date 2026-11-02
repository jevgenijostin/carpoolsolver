import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ base: process.env.GITHUB_PAGES ? '/carpoolsolver/' : '/', plugins: [tailwindcss()], build: { outDir: 'dist/app' } });
