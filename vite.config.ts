import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

/** `import b64 from './x.glb?b64'` gives the file as a plain base64 string: no data: URL
 * with a binary model MIME type ends up in the page, so it can be shared publicly */
/** three's GLTFLoader probes for AVIF/WebP support with tiny embedded test images. The car
 * uses neither, and an embedded AVIF can't be reviewed for public sharing, so drop them
 * (the probe then simply reports "unsupported") */
const stripImageProbes = () => ({
  name: 'strip-image-probes',
  transform(code: string, id: string) {
    if (!id.includes('GLTFLoader')) return null;
    const out = code.replace(/(['"])data:image\/(avif|webp);base64,[A-Za-z0-9+/=]+\1/g, "''");
    return out === code ? null : { code: out, map: null };
  },
});

const base64Import = () => ({
  name: 'base64-import',
  enforce: 'pre' as const,
  load(id: string) {
    if (!id.endsWith('?b64')) return null;
    const file = id.slice(0, -4);
    return `export default ${JSON.stringify(readFileSync(file).toString('base64'))};`;
  },
});

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [base64Import(), stripImageProbes(), viteSingleFile()] : [base64Import(), stripImageProbes()],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
}));
