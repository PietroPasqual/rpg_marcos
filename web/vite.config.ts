import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Em desenvolvimento, /api é encaminhado para a API de catálogo (uvicorn main_api:app --port 8000).
// Aponte para outro endereço com VITE_API_PROXY; em produção use VITE_API_BASE (veja src/api/client.ts).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://localhost:8000' } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
