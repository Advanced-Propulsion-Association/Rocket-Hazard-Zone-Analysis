/// <reference types="vitest" />
import { mergeConfig, defineConfig } from 'vite'
import { defineConfig as defineVitestConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default mergeConfig(
  defineConfig({
    plugins: [react(), tailwindcss()],
    optimizeDeps: { include: ['react-plotly.js'] },
  }),
  defineVitestConfig({
    test: {
      environment: 'jsdom',
      globals: true,
    },
  })
)
