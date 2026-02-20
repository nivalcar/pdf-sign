const { PDFDocument } = window.PDFLib;
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const el = {
  pdfFile: document.getElementById('pdfFile'),
  pdfUrl: document.getElementById('pdfUrl'),
  signFile: document.getElementById('signFile'),
  signUrl: document.getElementById('signUrl'),
  signWidth: document.getElementById('signWidth'),
  offsetX: document.getElementById('offsetX'),
  offsetY: document.getElementById('offsetY'),
  signButton: document.getElementById('signButton'),
  status: document.getElementById('status'),
};

function setStatus(message, type = '') {
  el.status.textContent = message;
  el.status.className = `status ${type}`.trim();
}

function findPdfHeaderOffset(bytes, maxScan = bytes.length) {
  const end = Math.min(bytes.length - 4, maxScan);
  for (let i = 0; i <= end; i += 1) {
    if (
      bytes[i] === 0x25 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x44 &&
      bytes[i + 3] === 0x46 &&
      bytes[i + 4] === 0x2d
    ) {
      return i;
    }
  }
  return -1;
}

function isPdf(bytes) {
  return findPdfHeaderOffset(bytes) >= 0;
}

function normalizePdfBytes(bytes) {
  const offset = findPdfHeaderOffset(bytes);
  if (offset < 0) {
    throw new Error(
      '올바른 PDF 헤더(%PDF-)를 찾지 못했습니다. 파일 전체에서 헤더를 찾았지만 없어 HTML/로그인 응답일 가능성이 큽니다.'
    );
  }

  if (offset === 0) {
    return bytes;
  }

  return bytes.slice(offset);
}

function isPng(bytes) {
  return bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78;
}

function isJpeg(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function validateInputBytes(bytes, label, contentType = '') {
  if (label === 'PDF' && !isPdf(bytes)) {
    const typeHint = contentType ? ` (응답 타입: ${contentType})` : '';
    throw new Error(
      `올바른 PDF 파일이 아닙니다${typeHint}. URL 입력 시 로그인 페이지/HTML이 내려오거나 CORS로 차단될 수 있어요. PDF 파일 업로드를 권장합니다.`
    );
  }

  if (label === '서명 이미지' && !isPng(bytes) && !isJpeg(bytes)) {
    throw new Error('서명 이미지는 PNG 또는 JPG 파일만 지원합니다.');
  }
}

async function getInputBytes(fileInput, urlInput, label) {
  if (fileInput.files?.[0]) {
    const bytes = new Uint8Array(await fileInput.files[0].arrayBuffer());
    validateInputBytes(bytes, label, fileInput.files[0].type || '');
    return bytes;
  }

  const url = urlInput.value.trim();
  if (!url) {
    throw new Error(`${label} 파일 업로드 또는 URL 입력이 필요합니다.`);
  }

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `${label} URL 요청에 실패했습니다. 브라우저 CORS 제한 또는 네트워크 문제일 수 있습니다. (${error.message})`
    );
  }

  if (!response.ok) {
    throw new Error(`${label} URL을 불러오지 못했습니다. (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  const bytes = new Uint8Array(await response.arrayBuffer());
  validateInputBytes(bytes, label, contentType);
  return bytes;
}

async function findAgentAnchor(pdfBytes) {
  const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
    const page = await doc.getPage(pageNo);
    const textContent = await page.getTextContent();

    let bestMatch = null;

    for (const item of textContent.items) {
      const text = String(item.str || '');
      if (!text) continue;

      const hasMainToken = text.includes('보험모집인') || text.includes('조정국');
      if (!hasMainToken) continue;

      const score =
        (text.includes('보험모집인') ? 2 : 0) +
        (text.includes('조정국') ? 2 : 0) +
        (text.includes('서명') || text.includes('인') ? 1 : 0);

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          pageIndex: pageNo - 1,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width || 120,
          score,
        };
      }
    }

    if (bestMatch) return bestMatch;
  }

  return null;
}

function downloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function signPdf() {
  el.signButton.disabled = true;
  setStatus('파일을 불러오는 중입니다...');

  try {
    const rawPdfBytes = await getInputBytes(el.pdfFile, el.pdfUrl, 'PDF');
    const pdfBytes = normalizePdfBytes(rawPdfBytes);
    const signBytes = await getInputBytes(el.signFile, el.signUrl, '서명 이미지');

    setStatus('서명 위치를 탐색하는 중입니다...');
    let anchor = null;
    try {
      anchor = await findAgentAnchor(pdfBytes);
    } catch (error) {
      console.warn('앵커 탐색 실패, 기본 위치로 진행합니다:', error);
    }

    const pdfDoc = await PDFDocument.load(pdfBytes);
    const image = isPng(signBytes)
      ? await pdfDoc.embedPng(signBytes)
      : await pdfDoc.embedJpg(signBytes);

    const signWidth = Number(el.signWidth.value) || 64;
    const signHeight = (image.height / image.width) * signWidth;
    const dx = Number(el.offsetX.value) || 0;
    const dy = Number(el.offsetY.value) || 0;

    let pageIndex = pdfDoc.getPageCount() - 1;
    let x = 420 + dx;
    let y = 72 + dy;

    if (anchor) {
      pageIndex = anchor.pageIndex;
      x = anchor.x + anchor.width - signWidth - 8 + dx;
      y = anchor.y + dy;
    }

    const page = pdfDoc.getPage(pageIndex);
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();

    x = Math.max(0, Math.min(x, pageWidth - signWidth));
    y = Math.max(0, Math.min(y, pageHeight - signHeight));

    page.drawImage(image, { x, y, width: signWidth, height: signHeight, opacity: 1 });

    const output = await pdfDoc.save();
    downloadPdf(output, 'signed.pdf');

    setStatus(
      anchor
        ? '완료! 보험모집인 문구 기준으로 서명을 배치해 다운로드했습니다.'
        : '완료! 문구 탐색 실패로 기본 위치에 서명을 배치해 다운로드했습니다.',
      'success'
    );
  } catch (error) {
    setStatus(`실패: ${error.message}`, 'error');
  } finally {
    el.signButton.disabled = false;
  }
}

el.signButton.addEventListener('click', signPdf);
