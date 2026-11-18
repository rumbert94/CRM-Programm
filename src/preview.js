// Schnellansicht: rendert das erzeugte PDF als Bilder (funktioniert auch auf
// Android/iPad, wo PDFs nicht in einer Seite eingebettet angezeigt werden).
let pdfjsPromise;
function pdfjs() {
  pdfjsPromise ||= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjsPromise;
}

let renderToken = 0;
export async function renderPreview(container, bytes) {
  const token = ++renderToken;
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes }).promise;
  const width = Math.max(200, container.clientWidth - 24);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvases = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = (width / vp1.width) * dpr;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = width + 'px';
    canvas.className = 'pv-page';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    if (token !== renderToken) return; // neuere Vorschau unterwegs
    canvases.push(canvas);
  }
  doc.destroy();
  if (token !== renderToken) return;
  container.replaceChildren(...canvases);
}
