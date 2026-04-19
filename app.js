// JavaScript 버전 - PDF 서명 애플리케이션 (TypeScript 스타일 타입 주석 적용)
import {
  findAgentAnchor,
  calculateAnchorPlacement,
  isAnchorResult
} from './insurance-types.js';

const { PDFDocument } = window.PDFLib;
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc =
  './node_modules/pdfjs-dist/build/pdf.worker.min.js';

/**
 * DOM 요소 타입 정의
 * @typedef {Object} AppElements
 * @property {HTMLInputElement} pdfFile - PDF 파일 입력
 * @property {HTMLInputElement} pdfUrl - PDF URL 입력
 * @property {HTMLInputElement} signFile - 서명 파일 입력
 * @property {HTMLInputElement} signUrl - 서명 URL 입력
 * @property {HTMLInputElement} signWidth - 서명 너비 입력
 * @property {HTMLInputElement} offsetX - X 오프셋 입력
 * @property {HTMLInputElement} offsetY - Y 오프셋 입력
 * @property {HTMLButtonElement} signButton - 서명 버튼
 * @property {HTMLParagraphElement} status - 상태 표시
 * @property {HTMLElement} dropZonePdf - PDF 드롭존
 * @property {HTMLElement} dropZoneSign - 서명 드롭존
 * @property {HTMLImageElement} signPreview - 서명 미리보기
 * @property {HTMLCanvasElement} pdfPreviewCanvas - PDF 미리보기 캔버스
 */

/**
 * @type {AppElements}
 */
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
  dropZonePdf: document.getElementById('dropZonePdf'),
  dropZoneSign: document.getElementById('dropZoneSign'),
  signPreview: document.getElementById('signPreview'),
  pdfPreviewCanvas: document.getElementById('pdfPreviewCanvas'),
};

// 드래그앤드롭으로 선택한 파일들을 저장하는 변수
let draggedPdfFile = null;
let draggedSignFile = null;

/**
 * 상태 타입 정의
 * @typedef {''|'success'|'error'} StatusType
 */

/**
 * 상태 설정 함수
 * @param {string} message - 표시할 메시지
 * @param {StatusType} [type=''] - 상태 타입
 */
function setStatus(message, type = '') {
  el.status.textContent = message;
  el.status.className = `status ${type}`.trim();
}

function findPdfHeaderOffset(bytes, maxScan = 1024) {
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
  console.log(`[normalizePdfBytes] 입력 바이트 크기: ${bytes.length}`);

  const offset = findPdfHeaderOffset(bytes);
  console.log(`[normalizePdfBytes] PDF 헤더 오프셋: ${offset}`);

  if (offset < 0) {
    // 16진수로 첫 100바이트 확인
    const hexString = Array.from(bytes.slice(0, 100))
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ');
    console.error(`[normalizePdfBytes] 첫 100바이트(16진수): ${hexString}`);
    throw new Error(
      '올바른 PDF 헤더(%PDF-)를 찾지 못했습니다. URL이 실제 PDF가 아닌 HTML/로그인 응답일 수 있습니다.'
    );
  }

  if (offset === 0) {
    console.log(`[normalizePdfBytes] 이미 정규화됨 (offset=0)`);
    return bytes;
  }

  console.log(`[normalizePdfBytes] ${offset}바이트 슬라이싱`);
  const sliced = bytes.slice(offset);
  console.log(`[normalizePdfBytes] 정규화 후 바이트 크기: ${sliced.length}`);

  // 정규화 후 첫 5바이트 확인
  const normalizedHeader = String.fromCharCode(...sliced.slice(0, 5));
  console.log(`[normalizePdfBytes] 정규화 후 헤더: ${normalizedHeader}`);

  return sliced;
}

function isPng(bytes) {
  return bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78;
}

function isJpeg(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// 파일 타입 정의
/** @typedef {'pdf' | 'sign'} FileType */

function handleFileSelect(file, type) {
  if (!file) return;

  console.log(`[파일 선택] ${type}: ${file.name} (${file.size} bytes)`);

  // 드래그앤드롭으로 선택한 파일을 별도 변수에 저장
  if (type === 'pdf') {
    draggedPdfFile = file;
  } else {
    draggedSignFile = file;
  }

  const input = type === 'pdf' ? el.pdfFile : el.signFile;
  const container = type === 'pdf' ? el.dropZonePdf : el.dropZoneSign;

  // DataTransfer를 사용하여 input.files 업데이트 (호환성 유지)
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;

  // 시각적 피드백 업데이트
  container.classList.add('has-file');
  const filenameEl = container.querySelector('.filename');
  if (filenameEl) filenameEl.textContent = file.name;

  if (type === 'sign' && file.type.startsWith('image/')) {
    // 서명 이미지 미리보기
    const reader = new FileReader();
    reader.onload = (e) => {
      console.log('[handleFileSelect] 서명 이미지 미리보기 로드');
      el.signPreview.src = e.target?.result;
      el.signPreview.style.display = 'block';
    };
    reader.onerror = (e) => {
      console.error('[handleFileSelect] 서명 이미지 읽기 오류:', e);
    };
    reader.readAsDataURL(file);
  } else if (type === 'pdf') {
    // PDF 파일 미리보기
    console.log('[handleFileSelect] PDF 미리보기 요청');
    const reader = new FileReader();
    reader.onload = async (e) => {
      console.log('[handleFileSelect] FileReader 완료, ArrayBuffer 크기:', e.target?.result?.byteLength);
      try {
        const pdfBytes = new Uint8Array(e.target?.result);
        console.log('[handleFileSelect] Uint8Array 변환 완료, 크기:', pdfBytes.length);
        await showPdfPreview(pdfBytes);
      } catch (error) {
        console.error('[handleFileSelect] PDF 미리보기 오류:', error);
      }
    };
    reader.onerror = (e) => {
      console.error('[handleFileSelect] PDF 파일 읽기 오류:', e);
    };
    console.log('[handleFileSelect] readAsArrayBuffer 호출');
    reader.readAsArrayBuffer(file);
  }

  // 성공 메시지 표시
  setStatus(`${type === 'pdf' ? 'PDF' : '서명 이미지'} 파일이 선택되었습니다: ${file.name}`, 'success');
  setTimeout(() => setStatus(''), 2000); // 2초 후 메시지 제거
}

/**
 * PDF 미리보기 표시 함수
 * @param {Uint8Array} pdfBytes - PDF 바이트 데이터
 */
async function showPdfPreview(pdfBytes) {
  try {
    console.log('[showPdfPreview] 입력 바이트 크기:', pdfBytes.length);
    console.log('[showPdfPreview] PDF 미리보기 생성 중...');

    // Canvas 초기화
    const canvas = el.pdfPreviewCanvas;
    if (!canvas) {
      console.error('[showPdfPreview] Canvas 요소를 찾을 수 없음');
      return;
    }

    // pdf.js 로드
    if (!pdfjsLib) {
      console.error('[showPdfPreview] pdfjsLib이 로드되지 않음');
      return;
    }

    console.log('[showPdfPreview] pdf.js 문서 로드 시작');
    const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    console.log('[showPdfPreview] PDF 로드 완료, 페이지 수:', pdfDoc.numPages);

    const page = await pdfDoc.getPage(1);
    console.log('[showPdfPreview] 페이지 1 로드 완료');

    const viewport = page.getViewport({ scale: 1.5 });
    console.log('[showPdfPreview] Viewport 크기:', viewport.width, 'x', viewport.height);

    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    console.log('[showPdfPreview] Canvas 렌더링 시작');
    const renderTask = page.render({
      canvasContext: context,
      viewport: viewport
    });

    await renderTask.promise;
    console.log('[showPdfPreview] Canvas 렌더링 완료');

    // Canvas 표시 (클래스 추가)
    canvas.classList.add('visible');
    console.log('[showPdfPreview] PDF 미리보기 생성 완료');
  } catch (error) {
    console.error('[showPdfPreview] 오류:', error);
    console.error('[showPdfPreview] 오류 상세:', error.message, error.stack);
  }
}

function initDropZone(zone, type) {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((name) => {
    zone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  zone.addEventListener('dragover', () => zone.classList.add('dragover'));
  ['dragleave', 'drop'].forEach((name) => {
    zone.addEventListener(name, () => zone.classList.remove('dragover'));
  });

  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files[0];
    if (file) handleFileSelect(file, type);
  });

  zone.addEventListener('click', () => {
    const input = type === 'pdf' ? el.pdfFile : el.signFile;
    input.click();
  });
}

// 초기화
initDropZone(el.dropZonePdf, 'pdf');
initDropZone(el.dropZoneSign, 'sign');

el.pdfFile.onchange = (e) => handleFileSelect((e.target.files?.[0] || null), 'pdf');
el.signFile.onchange = (e) => handleFileSelect((e.target.files?.[0] || null), 'sign');

// 입력 바이트 검증 결과 타입
/**
 * @typedef {Object} InputBytesResult
 * @property {Uint8Array} bytes - 파일 바이트
 * @property {string} fileName - 파일 이름
 */

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

async function getInputBytes(
  fileInput,
  urlInput,
  label
) {
  console.log(`[getInputBytes] ${label} 처리 시작`);

  // 드래그앤드롭으로 선택한 파일 우선 확인
  let selectedFile = null;
  if (label === 'PDF' && draggedPdfFile) {
    selectedFile = draggedPdfFile;
    console.log(`[getInputBytes] 드래그앤드롭 PDF 파일 사용: ${selectedFile.name}`);
  } else if (label === '서명 이미지' && draggedSignFile) {
    selectedFile = draggedSignFile;
    console.log(`[getInputBytes] 드래그앤드롭 서명 파일 사용: ${selectedFile.name}`);
  }

  // 드래그앤드롭 파일이 있으면 사용
  if (selectedFile) {
    const bytes = new Uint8Array(await selectedFile.arrayBuffer());
    validateInputBytes(bytes, label, selectedFile.type || '');
    console.log(`[getInputBytes] ${label} 파일 검증 성공`);
    return { bytes, fileName: selectedFile.name };
  }

  // 기존 input.files 확인
  if (fileInput.files?.[0]) {
    const file = fileInput.files[0];
    console.log(`[getInputBytes] input.files에서 ${label} 파일 발견: ${file.name}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateInputBytes(bytes, label, file.type || '');
    return { bytes, fileName: file.name };
  }

  console.log(`[getInputBytes] ${label} 파일이 없음, URL 확인`);
  const url = urlInput.value.trim();
  if (!url) {
    throw new Error(`${label} 파일 업로드 또는 URL 입력이 필요합니다.`);
  }

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `${label} URL 요청에 실패했습니다. 브라우저 CORS 제한 또는 네트워크 문제일 수 있습니다. (${(error).message})`
    );
  }

  if (!response.ok) {
    throw new Error(`${label} URL을 불러오지 못했습니다. (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  const bytes = new Uint8Array(await response.arrayBuffer());
  validateInputBytes(bytes, label, contentType);

  // URL에서 파일명 추출 (확장자 제외)
  let fileName = 'document.pdf';
  try {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/');
    const lastSegment = pathSegments[pathSegments.length - 1];
    if (lastSegment && lastSegment.includes('.')) {
      fileName = decodeURIComponent(lastSegment);
    }
  } catch (e) {
    // URL 파싱 실패 시 기본값 유지
  }

  return { bytes, fileName };
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

// 제네릭을 활용한 메인 서명 함수
/**
 * @template T
 * @returns {Promise<void>}
 */
async function signPdf() {
  el.signButton.disabled = true;
  setStatus('파일을 불러오는 중입니다...');

  try {
    console.log('[signPdf] 시작');

    const { bytes: rawPdfBytes, fileName: originName } = await getInputBytes(el.pdfFile, el.pdfUrl, 'PDF');
    console.log(`[signPdf] PDF 원본 바이트: ${rawPdfBytes.length}, 파일명: ${originName}`);

    // 원본 바이트의 첫 5바이트 확인
    const originalHeader = String.fromCharCode(...rawPdfBytes.slice(0, 5));
    console.log(`[signPdf] 원본 PDF 헤더: ${originalHeader}`);

    const pdfBytes = normalizePdfBytes(rawPdfBytes);
    console.log(`[signPdf] 정규화 후 PDF 바이트: ${pdfBytes.length}`);

    // 정규화 후 헤더 확인
    const normalizedHeader = String.fromCharCode(...pdfBytes.slice(0, 5));
    console.log(`[signPdf] 정규화 후 PDF 헤더: ${normalizedHeader}`);

    const { bytes: signBytes } = await getInputBytes(el.signFile, el.signUrl, '서명 이미지');
    console.log(`[signPdf] 서명 이미지 바이트: ${signBytes.length}`);

    setStatus('서명 위치를 탐색하는 중입니다...');

    // findAgentAnchor는 pdf.js를 사용하는데, ArrayBuffer를 detach할 수 있으므로
    // 미리 복사본을 만들어 사용 (앵커 찾기용)
    const pdfBytesForAnchor = new Uint8Array(pdfBytes);
    console.log(`[signPdf] 앵커 찾기용 pdfBytes 복사본 생성: ${pdfBytesForAnchor.length}`);

    // 제네릭 함수 사용 (pdfjsLib 전달)
    const anchor = await findAgentAnchor(pdfBytesForAnchor, pdfjsLib);
    console.log(`[signPdf] 앵커 찾기 결과:`, anchor);

    // PDFDocument.load 전에 pdfBytes 상태 확인
    console.log(`[signPdf] PDFDocument.load 전 pdfBytes 타입: ${pdfBytes.constructor.name}`);
    console.log(`[signPdf] PDFDocument.load 전 pdfBytes 크기: ${pdfBytes.length}`);
    console.log(`[signPdf] PDFDocument.load 전 첫 5바이트: ${String.fromCharCode(...pdfBytes.slice(0, 5))}`);

    const pdfDoc = await PDFDocument.load(pdfBytes);
    console.log(`[signPdf] PDF 문서 로드 성공, 페이지: ${pdfDoc.getPageCount()}`);

    const image = isPng(signBytes)
      ? await pdfDoc.embedPng(signBytes)
      : await pdfDoc.embedJpg(signBytes);
    console.log(`[signPdf] 이미지 임베딩 성공, 크기: ${image.width}x${image.height}`);

    const signWidth = Number(el.signWidth.value) || 120;
    const signHeight = (image.height / image.width) * signWidth;
    const dx = Number(el.offsetX.value) || 0;
    const dy = Number(el.offsetY.value) || 0;

    let pageIndex = pdfDoc.getPageCount() - 1;
    let x = 420 + dx;
    let y = 72 + dy;

    if (isAnchorResult(anchor)) {
      const placement = calculateAnchorPlacement(anchor, {
        signWidth,
        signHeight,
        offsetX: dx,
        offsetY: dy,
      });
      pageIndex = placement.pageIndex;
      x = placement.x;
      y = placement.y;
    }

    const page = pdfDoc.getPage(pageIndex);
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();

    x = Math.max(0, Math.min(x, pageWidth - signWidth));
    y = Math.max(0, Math.min(y, pageHeight - signHeight));

    console.log(`[signPdf] 서명 위치: (${x}, ${y}), 크기: ${signWidth}x${signHeight}`);

    page.drawImage(image, { x, y, width: signWidth, height: signHeight, opacity: 1 });
    console.log(`[signPdf] 이미지 그리기 완료`);

    const output = await pdfDoc.save();
    console.log(`[signPdf] PDF 저장 완료, 크기: ${output.length}`);

    // 출력파일명 생성: 원본파일명_추가서명.pdf
    const nameWithoutExt = originName.replace(/\.[^/.]+$/, "");
    const finalFileName = `${nameWithoutExt}_추가서명.pdf`;

    downloadPdf(output, finalFileName);
    console.log(`[signPdf] PDF 다운로드 완료: ${finalFileName}`);

    const successMessage = isAnchorResult(anchor)
      ? `완료! [${anchor.docType}] 양식을 감지하여 서명을 배치했습니다.`
      : '완료! 문구 탐색 실패로 기본 위치에 서명을 배치했습니다.';

    setStatus(successMessage, 'success');
  } catch (error) {
    console.error('[signPdf] 오류 발생:', error);
    setStatus(`실패: ${(error).message}`, 'error');
  } finally {
    el.signButton.disabled = false;
  }
}

el.signButton.addEventListener('click', () => signPdf());
