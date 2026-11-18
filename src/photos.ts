/** Shrinking photos to fit one database document, and reading the words in them. */

const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => rej(new Error("That picture couldn't be read."));
  i.src = src;
});

/** A JPEG data URL under ~700 KB. */
export async function compressImage(file: Blob | string, background = ''): Promise<string> {
  const url = typeof file === 'string' ? file : URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let max = 1800, q = 0.82, data = '';
    for (let i = 0; i < 10; i++) {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext('2d')!;
      if (background) { g.fillStyle = background; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(img, 0, 0, c.width, c.height);
      data = c.toDataURL('image/jpeg', q);
      if (data.length < 700_000) return data;
      if (q > 0.6) q -= 0.08; else max = Math.round(max * 0.8);
    }
    return data;
  } finally { if (typeof file !== 'string') URL.revokeObjectURL(url); }
}

interface Worker { recognize: (d: string) => Promise<{ data: { text: string } }>; terminate: () => Promise<void> }
interface Tess { createWorker: (lang: string, oem: number, opts?: object) => Promise<Worker> }
let tesseract: Promise<Tess> | null = null;

/** The words in a picture ('' if none). Loads the reader on first use. */
export async function readText(data: string): Promise<string> {
  if (!tesseract) {
    tesseract = new Promise<Tess>((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = () => res((window as unknown as { Tesseract: Tess }).Tesseract);
      s.onerror = () => { tesseract = null; rej(new Error("Couldn't load the text reader. Check the connection.")); };
      document.head.append(s);
    });
  }
  const T = await tesseract;
  const worker = await T.createWorker('eng', 1);
  try {
    const text = (await worker.recognize(data)).data.text.replace(/\n{3,}/g, '\n\n').trim();
    // Drawings and photos of things give scraps of noise; keep only text with some real words in it.
    return (text.match(/\p{L}{3,}/gu) || []).length >= 3 ? text : '';
  } finally { await worker.terminate(); }
}
