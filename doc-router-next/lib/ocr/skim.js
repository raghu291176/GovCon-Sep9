const sharp = require('sharp');
const Tesseract = require('tesseract.js');

function clampText(t, max = 2000) {
  const s = t || '';
  return s.length > max ? s.slice(0, max) : s;
}

async function detectOrientationDegrees(buf) {
  try {
    const anyT = Tesseract;
    if (typeof anyT.detect === 'function') {
      const det = await anyT.detect(buf);
      const deg = Number(det?.data?.orientation?.degrees || 0);
      return [0, 90, 180, 270].includes(deg) ? deg : 0;
    }
    const worker = await anyT.createWorker();
    await worker.loadLanguage('osd');
    await worker.initialize('osd');
    await worker.setParameters({ tessedit_pageseg_mode: '0' });
    const osdRes = await worker.detect(buf);
    await worker.terminate();
    const deg = Number(osdRes?.data?.orientation?.degrees || 0);
    return [0, 90, 180, 270].includes(deg) ? deg : 0;
  } catch {
    return 0;
  }
}

async function quickTesseractRead(buf) {
  try {
    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const result = await worker.recognize(buf);
    await worker.terminate();
    return clampText(String(result?.data?.text || ''), 2000);
  } catch {
    return '';
  }
}

async function autoOrientAndSkimImage(buffer, mime) {
  let rotated = await sharp(buffer).rotate().toBuffer();
  const degrees = await detectOrientationDegrees(rotated);
  if (degrees && degrees !== 0) rotated = await sharp(rotated).rotate(degrees).toBuffer();
  const text = await quickTesseractRead(rotated);
  return { rotated, degrees: [0, 90, 180, 270].includes(degrees) ? degrees : 0, text };
}

module.exports = { autoOrientAndSkimImage };

