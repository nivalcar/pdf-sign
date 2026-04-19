// JavaScript 버전 - 보험 타입별 처리 모듈

/**
 * 보험 타입 정의
 * @typedef {'장기'|'일반'|'자동차'} InsuranceType
 */

/**
 * 보험 설정 인터페이스
 * @typedef {Object} InsuranceConfig
 * @property {InsuranceType} type - 보험 타입
 * @property {string} keyword - 검색 키워드
 * @property {string} detectPattern - 감지 패턴
 */

/**
 * 앵커 찾기 결과 인터페이스
 * @typedef {Object} AnchorResult
 * @property {number} pageIndex - 페이지 인덱스
 * @property {number} x - X 좌표
 * @property {number} y - Y 좌표
 * @property {number} width - 너비
 * @property {string} text - 텍스트
 * @property {InsuranceType} docType - 감지된 문서 타입
 */

// 보험 타입별 설정
const INSURANCE_CONFIGS = {
  장기: { type: '장기', keyword: '보험모집인', detectPattern: '보험상품' },
  일반: { type: '일반', keyword: '설계사', detectPattern: '일반보험상품' },
  자동차: { type: '자동차', keyword: '설계사', detectPattern: '자동차보험상품' }
};

/**
 * 보험 타입 감지 함수
 * @param {string} text - 분석할 텍스트
 * @returns {InsuranceType|null} 감지된 보험 타입 또는 null
 */
function detectInsuranceType(text) {
  for (const config of Object.values(INSURANCE_CONFIGS)) {
    if (text.includes(config.detectPattern)) {
      return config.type;
    }
  }
  return null;
}

/**
 * 타입별 키워드 가져오기
 * @param {InsuranceType} type - 보험 타입
 * @returns {string} 해당 타입의 키워드
 */
function getInsuranceKeyword(type) {
  return INSURANCE_CONFIGS[type].keyword;
}

/**
 * 앵커 찾기 함수 (보험 타입별 서명 위치 탐색)
 * @param {Uint8Array} pdfBytes - PDF 바이트 데이터
 * @param {Object} pdfjsLibInstance - pdf.js 라이브러리 인스턴스
 * @returns {Promise<AnchorResult|null>} 앵커 결과 또는 null
 */
async function findAgentAnchor(pdfBytes, pdfjsLibInstance) {
  console.log(`[findAgentAnchor] PDF 바이트 크기: ${pdfBytes.length}`);

  // PDF 헤더 확인
  const header = String.fromCharCode(...pdfBytes.slice(0, 5));
  console.log(`[findAgentAnchor] PDF 헤더: ${header}`);

  if (!header.startsWith('%PDF')) {
    console.error(`[findAgentAnchor] 잘못된 PDF 헤더: ${header}`);
    throw new Error(`[findAgentAnchor] PDF 헤더 오류 - 받은 헤더: ${header}`);
  }

  const doc = await pdfjsLibInstance.getDocument({ data: pdfBytes }).promise;
  console.log(`[findAgentAnchor] PDF 로드 성공, 페이지 수: ${doc.numPages}`);

  // 1단계: 양식 유형 판별을 위한 전체 텍스트 수집 (주로 1페이지)
  const firstPage = await doc.getPage(1);
  const firstPageContent = await firstPage.getTextContent();
  const fullSpecText = firstPageContent.items.map((it) => it.str).join(' ');

  console.log(`[findAgentAnchor] 첫 페이지 텍스트 길이: ${fullSpecText.length}`);

  // 타입 감지
  const detectedType = detectInsuranceType(fullSpecText) || '장기';
  const anchorKeyword = getInsuranceKeyword(detectedType);

  console.log(`[감지된 양식: ${detectedType}] 기준 키워드: ${anchorKeyword}`);

  // 기존 로직 유지하되 타입 안전성 추가
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
    const page = await doc.getPage(pageNo);
    const textContent = await page.getTextContent();
    const items = textContent.items;

    console.log(`[findAgentAnchor] 페이지 ${pageNo}: ${items.length}개 항목`);

    // 2단계: 기준 키워드 탐색
    const baseItems = items.filter((item) =>
      String(item.str || '').includes(anchorKeyword)
    );

    console.log(`[findAgentAnchor] 페이지 ${pageNo}: '${anchorKeyword}' 찾은 개수: ${baseItems.length}`);

    for (const baseItem of baseItems) {
      const baseY = baseItem.transform[5];
      const baseX = baseItem.transform[4];

      // 3단계: 동일 선상 우측에서 '(서명/인)' 탐색
      const signTargets = items.filter((item) => {
        const itemY = item.transform[5];
        const itemX = item.transform[4];
        return Math.abs(itemY - baseY) < 5 && itemX >= baseX;
      });

      for (const item of signTargets) {
        const fullText = String(item.str || '');
        const cleanText = fullText.replace(/\s+/g, '');
        if (
          cleanText.includes('(서명/인)') ||
          cleanText.includes('서명/인') ||
          cleanText.endsWith('인)')
        ) {
          let x = item.transform[4];
          let width = item.width || 40;

          // 이름과 '(서명/인)'이 한 아이템에 묶여 있는 경우 처리
          const signPartIdx = fullText.indexOf('(');
          if (signPartIdx > 0) {
            const ratio = signPartIdx / fullText.length;
            x += width * ratio;
            width = width * (1 - ratio);
          }

          console.log(`[findAgentAnchor] 서명 위치 찾음: 페이지 ${pageNo}, (${x}, ${item.transform[5]})`);

          return {
            pageIndex: pageNo - 1,
            x: x,
            y: item.transform[5],
            width: width,
            text: fullText,
            docType: detectedType,
          };
        }
      }
    }
  }

  console.log(`[findAgentAnchor] 서명 위치를 찾지 못함, 기본 위치 사용`);
  return null;
}

/**
 * 보험 타입 유효성 검증
 * @param {string} type - 검증할 타입
 * @returns {boolean} 유효한 타입인지 여부
 */
function isValidInsuranceType(type) {
  return ['장기', '일반', '자동차'].includes(type);
}

/**
 * 보험 타입 검증 및 반환
 * @param {string} type - 검증할 타입
 * @returns {InsuranceType} 검증된 보험 타입
 * @throws {Error} 유효하지 않은 타입일 경우
 */
function assertInsuranceType(type) {
  if (!isValidInsuranceType(type)) {
    throw new Error(`유효하지 않은 보험 타입: ${type}`);
  }
  return type;
}

/**
 * 앵커 결과 타입 가드
 * @param {AnchorResult|null} result - 검사할 결과
 * @returns {boolean} AnchorResult인지 여부
 */
function isAnchorResult(result) {
  return result !== null;
}

// 모듈 익스포트
export {
  INSURANCE_CONFIGS,
  detectInsuranceType,
  getInsuranceKeyword,
  findAgentAnchor,
  isValidInsuranceType,
  assertInsuranceType,
  isAnchorResult
};
