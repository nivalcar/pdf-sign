// 보험 유형별 전략 및 공통 처리 모듈

/**
 * @typedef {'장기'|'일반'|'자동차'} InsuranceType
 */

/**
 * @typedef {Object} AnchorResult
 * @property {number} pageIndex
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {string} text
 * @property {InsuranceType} docType
 */

/**
 * @typedef {Object} PlacementInput
 * @property {number} signWidth
 * @property {number} signHeight
 * @property {number} offsetX
 * @property {number} offsetY
 */

/**
 * @typedef {Object} PlacementResult
 * @property {number} pageIndex
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} PdfTextItem
 * @property {string} str
 * @property {number[]} transform
 * @property {number} [width]
 */

/**
 * 보험 유형별 공통 계약.
 * @template {InsuranceType} TType
 */
class InsuranceDocumentStrategy {
  /**
   * @param {TType} type
   */
  constructor(type) {
    if (new.target === InsuranceDocumentStrategy) {
      throw new Error('InsuranceDocumentStrategy는 직접 생성할 수 없습니다.');
    }
    this.type = type;
  }

  /**
   * @returns {string[]}
   */
  get detectPatterns() {
    throw new Error('detectPatterns를 구현해야 합니다.');
  }

  /**
   * @returns {string}
   */
  get anchorKeyword() {
    throw new Error('anchorKeyword를 구현해야 합니다.');
  }

  /**
   * @param {string} text
   * @returns {boolean}
   */
  matches(text) {
    return this.detectPatterns.some((pattern) => text.includes(pattern));
  }

  /**
   * @param {PdfTextItem[]} items
   * @param {number} pageIndex
   * @returns {AnchorResult|null}
   */
  findAnchorOnPage(items, pageIndex) {
    const baseItems = items.filter((item) =>
      String(item.str || '').includes(this.anchorKeyword)
    );

    for (const baseItem of baseItems) {
      const baseY = baseItem.transform[5];
      const baseX = baseItem.transform[4];
      const signTargets = items.filter((item) => {
        const itemY = item.transform[5];
        const itemX = item.transform[4];
        return Math.abs(itemY - baseY) < 5 && itemX >= baseX;
      });

      for (const item of signTargets) {
        const fullText = String(item.str || '');
        const cleanText = fullText.replace(/\s+/g, '');

        if (!this.isSignatureLabel(cleanText)) {
          continue;
        }

        const geometry = this.resolveAnchorGeometry(item, fullText);
        return {
          pageIndex,
          x: geometry.x,
          y: item.transform[5],
          width: geometry.width,
          text: fullText,
          docType: this.type,
        };
      }
    }

    return null;
  }

  /**
   * @param {string} cleanText
   * @returns {boolean}
   */
  isSignatureLabel(cleanText) {
    return (
      cleanText.includes('(서명/인)') ||
      cleanText.includes('서명/인') ||
      cleanText.endsWith('인)')
    );
  }

  /**
   * @param {PdfTextItem} item
   * @param {string} fullText
   * @returns {{x: number, width: number}}
   */
  resolveAnchorGeometry(item, fullText) {
    let x = item.transform[4];
    let width = item.width || 40;

    const signPartIndex = fullText.indexOf('(');
    if (signPartIndex > 0 && fullText.length > 0) {
      const ratio = signPartIndex / fullText.length;
      x += width * ratio;
      width *= 1 - ratio;
    }

    return { x, width };
  }

  /**
   * @param {AnchorResult} anchor
   * @param {PlacementInput} input
   * @returns {PlacementResult}
   */
  calculatePlacement(anchor, input) {
    const { signWidth, signHeight, offsetX, offsetY } = input;
    const x = anchor.x + anchor.width / 2 - signWidth / 2 + offsetX;
    const textCenterY = anchor.y + 5;
    const y = textCenterY - signHeight / 2 + offsetY;

    return {
      pageIndex: anchor.pageIndex,
      x,
      y,
    };
  }
}

class LongTermInsuranceStrategy extends InsuranceDocumentStrategy {
  constructor() {
    super('장기');
  }

  get detectPatterns() {
    return ['보험상품 비교 설명 확인서', '건강보험', '종합보험'];
  }

  get anchorKeyword() {
    return '보험모집인';
  }
}

class GeneralInsuranceStrategy extends InsuranceDocumentStrategy {
  constructor() {
    super('일반');
  }

  get detectPatterns() {
    return ['일반보험상품 비교 설명 확인서', '사고배상책임보험'];
  }

  get anchorKeyword() {
    return '설계사';
  }
}

class AutoInsuranceStrategy extends InsuranceDocumentStrategy {
  constructor() {
    super('자동차');
  }

  get detectPatterns() {
    return ['자동차보험상품 비교 설명 확인서', '자동차보험료 비교·공시', '한화개인용자동차보험'];
  }

  get anchorKeyword() {
    return '설계사';
  }
}

class InsuranceStrategyRegistry {
  /**
   * @param {InsuranceDocumentStrategy<InsuranceType>[]} strategies
   * @param {InsuranceType} [fallbackType='장기']
   */
  constructor(strategies, fallbackType = '장기') {
    this.strategies = strategies;
    this.strategyMap = new Map(strategies.map((strategy) => [strategy.type, strategy]));
    this.fallbackType = fallbackType;
  }

  /**
   * @param {string} text
   * @returns {InsuranceDocumentStrategy<InsuranceType>|null}
   */
  detect(text) {
    return this.strategies.find((strategy) => strategy.matches(text)) || null;
  }

  /**
   * @param {InsuranceType} type
   * @returns {InsuranceDocumentStrategy<InsuranceType>}
   */
  get(type) {
    const strategy = this.strategyMap.get(type);
    if (!strategy) {
      throw new Error(`지원하지 않는 보험 유형입니다: ${type}`);
    }
    return strategy;
  }

  /**
   * @param {string} text
   * @returns {InsuranceDocumentStrategy<InsuranceType>}
   */
  resolve(text) {
    return this.detect(text) || this.get(this.fallbackType);
  }

  /**
   * @param {string} type
   * @returns {boolean}
   */
  has(type) {
    return this.strategyMap.has(type);
  }
}

/**
 * @template {InsuranceDocumentStrategy<InsuranceType>} TStrategy
 */
class InsuranceDocumentProcessor {
  /**
   * @param {TStrategy} strategy
   */
  constructor(strategy) {
    this.strategy = strategy;
  }

  /**
   * @param {PdfjsDocumentProxy} doc
   * @returns {Promise<AnchorResult|null>}
   */
  async findAnchor(doc) {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      const page = await doc.getPage(pageNo);
      const textContent = await page.getTextContent();
      const items = /** @type {PdfTextItem[]} */ (textContent.items);
      const anchor = this.strategy.findAnchorOnPage(items, pageNo - 1);
      if (anchor) {
        return anchor;
      }
    }

    return null;
  }
}

const DEFAULT_INSURANCE_REGISTRY = new InsuranceStrategyRegistry([
  new AutoInsuranceStrategy(),
  new GeneralInsuranceStrategy(),
  new LongTermInsuranceStrategy(),
]);

/**
 * @typedef {Object} PdfjsPageProxy
 * @property {() => Promise<{items: PdfTextItem[]}>} getTextContent
 */

/**
 * @typedef {Object} PdfjsDocumentProxy
 * @property {number} numPages
 * @property {(pageNo: number) => Promise<PdfjsPageProxy>} getPage
 */

/**
 * @param {string} text
 * @returns {InsuranceType|null}
 */
function detectInsuranceType(text) {
  return DEFAULT_INSURANCE_REGISTRY.detect(text)?.type || null;
}

/**
 * @param {InsuranceType} type
 * @returns {string}
 */
function getInsuranceKeyword(type) {
  return DEFAULT_INSURANCE_REGISTRY.get(type).anchorKeyword;
}

/**
 * @param {string} type
 * @returns {boolean}
 */
function isValidInsuranceType(type) {
  return DEFAULT_INSURANCE_REGISTRY.has(type);
}

/**
 * @param {string} type
 * @returns {InsuranceType}
 */
function assertInsuranceType(type) {
  if (!isValidInsuranceType(type)) {
    throw new Error(`유효하지 않은 보험 유형입니다: ${type}`);
  }
  return /** @type {InsuranceType} */ (type);
}

/**
 * @param {AnchorResult|null} result
 * @returns {result is AnchorResult}
 */
function isAnchorResult(result) {
  return result !== null;
}

/**
 * @param {Uint8Array} pdfBytes
 * @param {{ getDocument: (options: { data: Uint8Array }) => { promise: Promise<PdfjsDocumentProxy> } }} pdfjsLibInstance
 * @param {InsuranceStrategyRegistry} [registry=DEFAULT_INSURANCE_REGISTRY]
 * @returns {Promise<AnchorResult|null>}
 */
async function findAgentAnchor(pdfBytes, pdfjsLibInstance, registry = DEFAULT_INSURANCE_REGISTRY) {
  const header = String.fromCharCode(...pdfBytes.slice(0, 5));
  if (!header.startsWith('%PDF')) {
    throw new Error(`[findAgentAnchor] PDF 헤더 오류 - 받은 헤더: ${header}`);
  }

  const doc = await pdfjsLibInstance.getDocument({ data: pdfBytes }).promise;
  const firstPage = await doc.getPage(1);
  const firstPageContent = await firstPage.getTextContent();
  const fullSpecText = firstPageContent.items.map((item) => item.str).join(' ');
  const strategy = registry.resolve(fullSpecText);
  const processor = new InsuranceDocumentProcessor(strategy);

  return processor.findAnchor(doc);
}

/**
 * @param {AnchorResult} anchor
 * @param {PlacementInput} input
 * @param {InsuranceStrategyRegistry} [registry=DEFAULT_INSURANCE_REGISTRY]
 * @returns {PlacementResult}
 */
function calculateAnchorPlacement(anchor, input, registry = DEFAULT_INSURANCE_REGISTRY) {
  return registry.get(anchor.docType).calculatePlacement(anchor, input);
}

const INSURANCE_CONFIGS = Object.freeze({
  longTerm: Object.freeze({
    type: '장기',
    keyword: getInsuranceKeyword('장기'),
    detectPatterns: [...DEFAULT_INSURANCE_REGISTRY.get('장기').detectPatterns],
  }),
  general: Object.freeze({
    type: '일반',
    keyword: getInsuranceKeyword('일반'),
    detectPatterns: [...DEFAULT_INSURANCE_REGISTRY.get('일반').detectPatterns],
  }),
  auto: Object.freeze({
    type: '자동차',
    keyword: getInsuranceKeyword('자동차'),
    detectPatterns: [...DEFAULT_INSURANCE_REGISTRY.get('자동차').detectPatterns],
  }),
});

export {
  INSURANCE_CONFIGS,
  InsuranceDocumentStrategy,
  InsuranceDocumentProcessor,
  InsuranceStrategyRegistry,
  detectInsuranceType,
  getInsuranceKeyword,
  findAgentAnchor,
  calculateAnchorPlacement,
  isValidInsuranceType,
  assertInsuranceType,
  isAnchorResult,
};
