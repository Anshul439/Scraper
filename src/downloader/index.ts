// src/downloader/index.ts
import axios from 'axios';
import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { basename } from 'path';

export async function downloadPdf(url: string, outDir = 'data') {
  try {
    const fileName = basename(new URL(url).pathname) || `file-${Date.now()}.pdf`;
    const site = new URL(url).hostname.replace(/\./g, '-');
    const dir = `${outDir}/${site}`;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const outPath = `${dir}/${fileName}`;

    const res = await axios.get(url, { responseType: 'stream', timeout: 30_000 });
    const writer = createWriteStream(outPath);
    res.data.pipe(writer);

    await new Promise<void>((resolve, reject) => {
      writer.on('finish', () => resolve());
      writer.on('error', (err) => reject(err));
    });

    return { path: outPath, fileName, url };
  } catch (err) {
    return { error: (err as Error).message, url };
  }
}
