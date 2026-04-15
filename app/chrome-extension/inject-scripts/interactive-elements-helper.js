/* global window, document, Element, CSS, Node, XPathResult, chrome */

// interactive-elements-helper.js
// This script is injected into the page to find interactive elements.
// Final version by Calvin, featuring a multi-layered fallback strategy
// and comprehensive element support, built on a performant and reliable core.

(function () {
  // Prevent re-initialization
  if (window.__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__) {
    return;
  }
  window.__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__ = true;

  /**
   * @typedef {Object} ElementInfo
   * @property {string} type - The type of the element (e.g., 'button', 'link').
   * @property {string} selector - A CSS selector to uniquely identify the element.
   * @property {string} text - The visible text or accessible name of the element.
   * @property {boolean} isInteractive - Whether the element is currently interactive.
   * @property {Object} [coordinates] - The coordinates of the element if requested.
   * @property {boolean} [disabled] - For elements that can be disabled.
   * @property {string} [href] - For links.
   * @property {boolean} [checked] - for checkboxes and radio buttons.
   */

  /**
   * Configuration for element types and their corresponding selectors.
   * Now more comprehensive with common ARIA roles.
   */
  const ELEMENT_CONFIG = {
    button:
      'button, input[type="button"], input[type="submit"], [role="button"], svg[role="button"]',
    link: 'a[href], [role="link"]',
    input:
      'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])',
    checkbox: 'input[type="checkbox"], [role="checkbox"]',
    radio: 'input[type="radio"], [role="radio"]',
    textarea: 'textarea, [role="textbox"], [role="searchbox"]',
    select: 'select, [role="combobox"]',
    tab: '[role="tab"]',
    // Generic interactive elements: combines tabindex, common roles, and explicit handlers.
    // Includes SVG elements with interactive attributes.
    interactive: `[onclick], [tabindex]:not([tabindex^="-"]), [role="menuitem"], [role="slider"], [role="option"], [role="treeitem"], [role="switch"], svg[onclick], svg[tabindex]:not([tabindex^="-"])`,
  };

  // A combined selector for ANY interactive element, used in the fallback logic.
  const ANY_INTERACTIVE_SELECTOR = Object.values(ELEMENT_CONFIG).join(', ');

  // Query helpers that pierce open shadow roots. These are used only in fallback paths or
  // when a selector is explicitly provided, to keep costs bounded.
  function* walkAllNodesDeep(root) {
    const stack = [root];
    const MAX = 12000; // safety bound
    let count = 0;
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (++count > MAX) break;
      yield node;
      const anyNode = /** @type {any} */ (node);
      try {
        const children = node.children ? Array.from(node.children) : [];
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        const sr = anyNode && anyNode.shadowRoot ? anyNode.shadowRoot : null;
        if (sr && sr.children) {
          const srChildren = Array.from(sr.children);
          for (let i = srChildren.length - 1; i >= 0; i--) stack.push(srChildren[i]);
        }
      } catch (_) {
        /* ignore */
      }
    }
  }

  function querySelectorAllDeep(selector, root = document) {
    const results = [];
    for (const node of walkAllNodesDeep(root)) {
      if (!(node instanceof Element)) continue;
      try {
        if (node.matches && node.matches(selector)) results.push(node);
      } catch (_) {
        /* ignore invalid selectors for given node */
      }
    }
    return results;
  }

  // --- Core Helper Functions ---

  /**
   * Checks if an element is genuinely visible on the page.
   * "Visible" means it's not styled with display:none, visibility:hidden, etc.
   * This check intentionally IGNORES whether the element is within the current viewport.
   * @param {Element} el The element to check.
   * @returns {boolean} True if the element is visible.
   */
  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;

    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity) === 0
    ) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || el.tagName === 'A'; // Allow zero-size anchors as they can still be navigated
  }

  function isElementInViewport(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  /**
   * Checks if an element is considered interactive (not disabled or hidden from accessibility).
   * @param {Element} el The element to check.
   * @returns {boolean} True if the element is interactive.
   */
  function isElementInteractive(el) {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
      return false;
    }
    if (el.closest('[aria-hidden="true"]')) {
      return false;
    }
    return true;
  }

  /**
   * Generates a reasonably stable CSS selector for a given element.
   * @param {Element} el The element.
   * @returns {string} A CSS selector.
   */
  function generateSelector(el) {
    if (!(el instanceof Element)) return '';

    if (el.id) {
      const idSelector = `#${CSS.escape(el.id)}`;
      if (document.querySelectorAll(idSelector).length === 1) return idSelector;
    }

    for (const attr of ['data-testid', 'data-cy', 'name']) {
      const attrValue = el.getAttribute(attr);
      if (attrValue) {
        const attrSelector = `[${attr}="${CSS.escape(attrValue)}"]`;
        if (document.querySelectorAll(attrSelector).length === 1) return attrSelector;
      }
    }

    let path = '';
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName !== 'BODY') {
      let selector = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName,
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      path = path ? `${selector} > ${path}` : selector;
      current = parent;
    }
    return path ? `body > ${path}` : 'body';
  }

  /**
   * Finds the accessible name for an element (label, aria-label, etc.).
   * @param {Element} el The element.
   * @returns {string} The accessible name.
   */
  function getAccessibleName(el) {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const labelElement = document.getElementById(labelledby);
      if (labelElement) return labelElement.textContent?.trim() || '';
    }
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent?.trim() || '';
    }
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent?.trim() || '';
    return (
      el.getAttribute('placeholder') ||
      el.getAttribute('value') ||
      el.textContent?.trim() ||
      el.getAttribute('title') ||
      ''
    );
  }

  /**
   * Simple subsequence matching for fuzzy search.
   * @param {string} text The text to search within.
   * @param {string} query The query subsequence.
   * @returns {boolean}
   */
  function fuzzyMatch(text, query) {
    if (!text || !query) return false;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let textIndex = 0;
    let queryIndex = 0;
    while (textIndex < lowerText.length && queryIndex < lowerQuery.length) {
      if (lowerText[textIndex] === lowerQuery[queryIndex]) {
        queryIndex++;
      }
      textIndex++;
    }
    return queryIndex === lowerQuery.length;
  }

  /**
   * Creates the standardized info object for an element.
   * Modified to handle the new 'text' type from the final fallback.
   */
  function createElementInfo(el, type, includeCoordinates, isInteractiveOverride = null) {
    const isActuallyInteractive = isElementInteractive(el);
    const info = {
      type,
      selector: generateSelector(el),
      text: getAccessibleName(el) || el.textContent?.trim(),
      isInteractive: isInteractiveOverride !== null ? isInteractiveOverride : isActuallyInteractive,
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
    };
    if (includeCoordinates) {
      const rect = el.getBoundingClientRect();
      info.coordinates = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        },
      };
    }
    info.inViewport = isElementInViewport(el);
    return info;
  }

  function countInteractiveDescendants(el, limit = 12) {
    if (!el || !(el instanceof Element)) return 0;
    let count = 0;
    const descendants = el.querySelectorAll(ANY_INTERACTIVE_SELECTOR);
    for (const node of descendants) {
      if (!(node instanceof Element)) continue;
      if (!isElementVisible(node) || !isElementInteractive(node)) continue;
      count += 1;
      if (count >= limit) return count;
    }
    return count;
  }

  function getQueryMatchKind(text, query) {
    const normalizedText = String(text || '')
      .trim()
      .toLowerCase();
    const normalizedQuery = String(query || '')
      .trim()
      .toLowerCase();
    if (!normalizedText || !normalizedQuery) return 'none';
    if (normalizedText === normalizedQuery) return 'exact';
    if (normalizedText.startsWith(normalizedQuery)) return 'prefix';
    if (normalizedText.includes(normalizedQuery)) return 'substring';
    if (fuzzyMatch(normalizedText, normalizedQuery)) return 'fuzzy';
    return 'none';
  }

  function scoreElementForQuery(el, textQuery) {
    const accessibleName = (getAccessibleName(el) || '').trim();
    const text = (accessibleName || el.textContent || '').trim();
    const rect = el.getBoundingClientRect();
    const area = Math.max(1, rect.width * rect.height);
    const tag = el.tagName.toLowerCase();
    const query = String(textQuery || '').trim();
    const matchKind = getQueryMatchKind(text, query);
    const interactiveDescendants = countInteractiveDescendants(el);
    const textLength = text.length;
    const queryLength = query.length;
    let score = 0;

    if (query) {
      if (matchKind === 'exact') score += 120;
      else if (matchKind === 'prefix') score += 80;
      else if (matchKind === 'substring') score += 50;
      else if (matchKind === 'fuzzy') score += 20;
    }

    if (isElementInViewport(el)) score += 40;
    if (isElementInteractive(el)) score += 15;

    if (tag === 'button' || tag === 'a') score += 20;
    if (
      el.matches('[role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]')
    )
      score += 18;
    if (el.matches('select, [role="combobox"]')) score += 16;
    if (el.matches('input, textarea')) score += 12;
    if (el.matches('[aria-haspopup], [aria-expanded], [aria-controls]')) score += 14;
    if (
      el.matches(
        '.arco-btn, .arco-link, .arco-cascader-list-item, .arco-dropdown-option, .arco-table-cell',
      )
    )
      score += 10;

    if (queryLength > 0) {
      if (textLength > queryLength + 18) score -= 12;
      if (textLength > queryLength + 48) score -= 28;
      if (matchKind === 'exact' && textLength <= queryLength + 4) score += 18;
    }

    if (area < 2500) score += 12;
    else if (area < 12000) score += 6;
    else if (area > 150000) score -= 25;
    else if (area > 60000) score -= 12;

    if (interactiveDescendants >= 6) score -= 18;
    if (interactiveDescendants >= 10) score -= 18;

    if (tag === 'div' || tag === 'section' || tag === 'main' || tag === 'article') {
      score -= 10;
      if (area > 30000) score -= 18;
      if (interactiveDescendants >= 4) score -= 24;
    }

    if (
      tag === 'li' &&
      (el.matches('[role="option"], [role="menuitem"]') ||
        el.className.includes('option') ||
        el.className.includes('item'))
    ) {
      score += 12;
    }

    if (el.id && /^arco-tabs-\d+-panel-\d+$/.test(el.id)) {
      score -= 80;
    }

    return score;
  }

  function sortElementsForQuery(elements, textQuery) {
    return [...elements].sort((left, right) => {
      const scoreDiff =
        scoreElementForQuery(right, textQuery) - scoreElementForQuery(left, textQuery);
      if (scoreDiff !== 0) return scoreDiff;

      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      const leftArea = Math.max(1, leftRect.width * leftRect.height);
      const rightArea = Math.max(1, rightRect.width * rightRect.height);
      if (leftArea !== rightArea) return leftArea - rightArea;

      return leftRect.top - rightRect.top;
    });
  }

  function findTextElementsByContent(textQuery) {
    const query = String(textQuery || '').trim();
    if (!query) return [];

    const matched = new Set();
    const allElements = document.body ? Array.from(document.body.querySelectorAll('*')) : [];

    for (const el of allElements) {
      if (!(el instanceof Element)) continue;
      if (!isElementVisible(el)) continue;

      const text = (getAccessibleName(el) || el.textContent || '').trim();
      const matchKind = getQueryMatchKind(text, query);
      if (matchKind === 'none') continue;

      matched.add(el);
    }

    const reduced = Array.from(matched).filter((el) => {
      return !Array.from(matched).some((other) => other !== el && el.contains(other));
    });

    return sortElementsForQuery(reduced, query);
  }

  /**
   * [CORE UTILITY] Finds interactive elements based on a set of types.
   * This is our high-performance Layer 1 search function.
   */
  function findInteractiveElements(options = {}) {
    const { textQuery, includeCoordinates = true, types = Object.keys(ELEMENT_CONFIG) } = options;

    const selectorsToFind = types
      .map((type) => ELEMENT_CONFIG[type])
      .filter(Boolean)
      .join(', ');
    if (!selectorsToFind) return [];

    const targetElements = querySelectorAllDeep(selectorsToFind);
    const uniqueElements = new Set(targetElements);
    const results = [];

    for (const el of uniqueElements) {
      if (!isElementVisible(el) || !isElementInteractive(el)) continue;

      const accessibleName = getAccessibleName(el);
      if (textQuery && !fuzzyMatch(accessibleName, textQuery)) continue;

      let elementType = 'unknown';
      for (const [type, typeSelector] of Object.entries(ELEMENT_CONFIG)) {
        if (el.matches(typeSelector)) {
          elementType = type;
          break;
        }
      }
      results.push(createElementInfo(el, elementType, includeCoordinates));
    }
    if (!textQuery) return results;
    const sorted = sortElementsForQuery(
      Array.from(uniqueElements).filter((el) => {
        if (!isElementVisible(el) || !isElementInteractive(el)) return false;
        const accessibleName = getAccessibleName(el);
        return fuzzyMatch(accessibleName, textQuery);
      }),
      textQuery,
    );
    return sorted.map((el) => {
      let elementType = 'unknown';
      for (const [type, typeSelector] of Object.entries(ELEMENT_CONFIG)) {
        if (el.matches(typeSelector)) {
          elementType = type;
          break;
        }
      }
      return createElementInfo(el, elementType, includeCoordinates);
    });
  }

  /**
   * [ORCHESTRATOR] The main entry point that implements the 3-layer fallback logic.
   * @param {object} options - The main search options.
   * @returns {ElementInfo[]}
   */
  function findElementsByTextWithFallback(options = {}) {
    const { textQuery, includeCoordinates = true } = options;

    if (!textQuery) {
      return findInteractiveElements({ ...options, types: Object.keys(ELEMENT_CONFIG) });
    }

    // --- Layer 1: High-reliability search for interactive elements matching text ---
    let results = findInteractiveElements({ ...options, types: Object.keys(ELEMENT_CONFIG) });
    if (results.length > 0) {
      return results;
    }

    // --- Layer 2: Find text, then find its interactive ancestor ---
    const lowerCaseText = textQuery.toLowerCase();
    const xPath = `//text()[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${lowerCaseText}')]`;
    const textNodes = document.evaluate(
      xPath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );

    const interactiveElements = new Set();
    if (textNodes.snapshotLength > 0) {
      for (let i = 0; i < textNodes.snapshotLength; i++) {
        const parentElement = textNodes.snapshotItem(i).parentElement;
        if (parentElement) {
          const candidates = [];
          let current = parentElement;
          let depth = 0;
          while (current && current instanceof Element && depth < 8) {
            if (
              current.matches &&
              current.matches(ANY_INTERACTIVE_SELECTOR) &&
              isElementVisible(current) &&
              isElementInteractive(current)
            ) {
              candidates.push(current);
            }
            current = current.parentElement;
            depth += 1;
          }

          const bestAncestor = sortElementsForQuery(candidates, textQuery)[0];
          if (bestAncestor) {
            interactiveElements.add(bestAncestor);
          }
        }
      }

      if (interactiveElements.size > 0) {
        return sortElementsForQuery(Array.from(interactiveElements), textQuery).map((el) => {
          let elementType = 'interactive';
          for (const [type, typeSelector] of Object.entries(ELEMENT_CONFIG)) {
            if (el.matches(typeSelector)) {
              elementType = type;
              break;
            }
          }
          return createElementInfo(el, elementType, includeCoordinates);
        });
      }
    }

    // --- Layer 3: Final fallback, return any element containing the text ---
    const leafElements = new Set();
    for (let i = 0; i < textNodes.snapshotLength; i++) {
      const parentElement = textNodes.snapshotItem(i).parentElement;
      if (parentElement && isElementVisible(parentElement)) {
        leafElements.add(parentElement);
      }
    }

    const fallbackMatches = findTextElementsByContent(textQuery);
    for (const el of fallbackMatches) {
      leafElements.add(el);
    }

    const finalElements = Array.from(leafElements).filter((el) => {
      return ![...leafElements].some((otherEl) => el !== otherEl && el.contains(otherEl));
    });

    return sortElementsForQuery(finalElements, textQuery).map((el) =>
      createElementInfo(el, 'text', includeCoordinates, true),
    );
  }

  // --- Chrome Message Listener ---
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'getInteractiveElements') {
      try {
        let elements;
        if (request.selector) {
          // If a selector is provided, bypass the text-based logic and use a direct query.
          const foundEls = querySelectorAllDeep(request.selector);
          elements = sortElementsForQuery(foundEls, request.textQuery || '').map((el) =>
            createElementInfo(
              el,
              'selected',
              request.includeCoordinates !== false,
              isElementInteractive(el),
            ),
          );
        } else {
          // Otherwise, use our powerful multi-layered text search
          elements = findElementsByTextWithFallback(request);
        }
        sendResponse({ success: true, elements });
      } catch (error) {
        console.error('Error in getInteractiveElements:', error);
        sendResponse({ success: false, error: error.message });
      }
      return true; // Async response
    } else if (request.action === 'chrome_get_interactive_elements_ping') {
      sendResponse({ status: 'pong' });
      return false;
    }
  });

  console.log('Interactive elements helper script loaded');
})();
