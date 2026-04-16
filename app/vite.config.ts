import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 5173,
        host: true,
        open: true,
    },
    build: {
        target: 'esnext',
    },
    assetsInclude: ['**/*.wgsl', '**/*.ply', '**/*.spz'],
});
