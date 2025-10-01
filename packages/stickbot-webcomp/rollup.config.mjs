import path from 'node:path';
import { fileURLToPath } from 'node:url';
import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const pkgDir = path.dirname(fileURLToPath(import.meta.url));
const input = path.resolve(pkgDir, 'src/index.ts');

export default {
  input,
  treeshake: true,
  output: [
    {
      file: path.resolve(pkgDir, 'dist/stickbot-webcomp.esm.js'),
      format: 'esm',
      sourcemap: true
    },
    {
      file: path.resolve(pkgDir, 'dist/stickbot-webcomp.global.js'),
      format: 'iife',
      name: 'StickBotComponent',
      sourcemap: true
    }
  ],
  plugins: [
    nodeResolve({
      extensions: ['.ts', '.js']
    }),
    typescript({
      tsconfig: false,
      compilerOptions: {
        target: 'ES2019',
        module: 'ESNext',
        moduleResolution: 'bundler',
        sourceMap: true,
        resolveJsonModule: true
      }
    })
  ]
};
