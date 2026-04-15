/* global window, document, Element, MouseEvent, PointerEvent, HTMLElement, SVGElement, HTMLInputElement, HTMLButtonElement, HTMLAnchorElement, HTMLLabelElement, chrome */

// click-helper.js
// This script is injected into the page to handle click operations

if (window.__CLICK_HELPER_INITIALIZED__) {
  // Already initialized, skip
} else {
  window.__CLICK_HELPER_INITIALIZED__ = true;
  /**
   * Click on an element matching the selector or at specific coordinates
   * @param {string} selector - CSS selector for the element to click
   * @param {boolean} waitForNavigation - Whether to wait for navigation to complete after click
   * @param {number} timeout - Timeout in milliseconds for waiting for the element or navigation
   * @param {Object} coordinates - Optional coordinates for clicking at a specific position
   * @param {number} coordinates.x - X coordinate relative to the viewport
   * @param {number} coordinates.y - Y coordinate relative to the viewport
   * @returns {Promise<Object>} - Result of the click operation
   */
  async function clickElement(
    selector,
    waitForNavigation = false,
    timeout = 5000,
    coordinates = null,
    ref = null,
    double = false,
    options = {},
  ) {
    try {
      let element = null;
      let elementInfo = null;
      let clickX, clickY;

      const resolvePreferredClickTarget = (candidate) => {
        if (!(candidate instanceof Element)) return null;
        const candidateRect = candidate.getBoundingClientRect();
        const candidateArea = Math.max(1, candidateRect.width * candidateRect.height);
        const candidateText = (candidate.innerText || candidate.textContent || '').trim();
        const comboAncestor =
          candidate.closest?.(
            '[role="combobox"], .arco-cascader, .arco-select-view, .arco-picker, .arco-input-tag',
          ) || null;
        if (comboAncestor instanceof Element) {
          return comboAncestor;
        }
        const ancestorSelector =
          'button, a[href], label, summary, option, input, textarea, select, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [onclick], [tabindex]:not([tabindex^="-"])';
        const ancestors = [];
        let current = candidate;
        let depth = 0;
        while (current && current instanceof Element && depth < 8) {
          if (current.matches?.(ancestorSelector)) {
            ancestors.push(current);
          }
          current = current.parentElement;
          depth += 1;
        }
        const scored = ancestors
          .map((el) => {
            const rect = el.getBoundingClientRect();
            const area = Math.max(1, rect.width * rect.height);
            const text = (el.innerText || el.textContent || '').trim();
            let score = 0;

            if (text && candidateText && text === candidateText) score += 30;
            if (el.tagName === 'BUTTON' || el.tagName === 'A') score += 28;
            if (
              el.matches?.(
                '[role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]',
              )
            ) {
              score += 24;
            }
            if (el.matches?.('[aria-haspopup], [aria-expanded], [aria-controls]')) score += 12;
            if (area <= candidateArea * 6) score += 18;
            if (area > candidateArea * 20) score -= 35;
            if (/^arco-tabs-\d+-panel-\d+$/.test(el.id || '')) score -= 80;
            if (
              el.tagName === 'DIV' &&
              area > 30000 &&
              el.querySelectorAll?.(ancestorSelector).length > 3
            ) {
              score -= 40;
            }

            return { el, score, area };
          })
          .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return left.area - right.area;
          });

        if (scored.length > 0 && scored[0].score > 0) {
          return scored[0].el;
        }

        return candidate;
      };

      if (ref && typeof ref === 'string') {
        // Resolve element from weak map
        let target = null;
        try {
          const map = window.__claudeElementMap;
          const weak = map && map[ref];
          target = weak && typeof weak.deref === 'function' ? weak.deref() : null;
        } catch (e) {
          // ignore
        }

        if (!target || !(target instanceof Element)) {
          return {
            error: `Element ref "${ref}" not found. Please call chrome_read_page first and ensure the ref is still valid.`,
          };
        }

        element = resolvePreferredClickTarget(target);
        element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
        await new Promise((resolve) => setTimeout(resolve, 80));

        const rect = element.getBoundingClientRect();
        clickX = rect.left + rect.width / 2;
        clickY = rect.top + rect.height / 2;
        elementInfo = {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          text: element.textContent?.trim().substring(0, 100) || '',
          href: element.href || null,
          type: element.type || null,
          isVisible: true,
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
          clickMethod: 'ref',
          ref,
        };
      } else if (
        coordinates &&
        typeof coordinates.x === 'number' &&
        typeof coordinates.y === 'number'
      ) {
        clickX = coordinates.x;
        clickY = coordinates.y;

        element = resolvePreferredClickTarget(document.elementFromPoint(clickX, clickY));

        if (element) {
          const rect = element.getBoundingClientRect();
          elementInfo = {
            tagName: element.tagName,
            id: element.id,
            className: element.className,
            text: element.textContent?.trim().substring(0, 100) || '',
            href: element.href || null,
            type: element.type || null,
            isVisible: true,
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
            clickMethod: 'coordinates',
            clickPosition: { x: clickX, y: clickY },
          };
        } else {
          elementInfo = {
            clickMethod: 'coordinates',
            clickPosition: { x: clickX, y: clickY },
            warning: 'No element found at the specified coordinates',
          };
        }
      } else {
        element = resolvePreferredClickTarget(document.querySelector(selector));
        if (!element) {
          return {
            error: `Element with selector "${selector}" not found`,
          };
        }

        const rect = element.getBoundingClientRect();
        elementInfo = {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          text: element.textContent?.trim().substring(0, 100) || '',
          href: element.href || null,
          type: element.type || null,
          isVisible: true,
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
          clickMethod: 'selector',
        };

        // First sroll so that the element is in view, then check visibility.
        element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
        await new Promise((resolve) => setTimeout(resolve, 100));
        elementInfo.isVisible = isElementVisible(element);
        if (!elementInfo.isVisible) {
          return {
            error: `Element with selector "${selector}" is not visible`,
            elementInfo,
          };
        }

        const updatedRect = element.getBoundingClientRect();
        clickX = updatedRect.left + updatedRect.width / 2;
        clickY = updatedRect.top + updatedRect.height / 2;
      }

      const allowDownloadClick = options.allowDownloadClick === true;
      const resolvedAnchor =
        element && typeof element.closest === 'function' ? element.closest('a[href]') : null;
      if (resolvedAnchor && !allowDownloadClick) {
        const href = resolvedAnchor.href || '';
        const downloadAttr = resolvedAnchor.getAttribute('download');
        const anchorText = (resolvedAnchor.textContent || '').trim();
        const parsed = (() => {
          try {
            return new URL(href, window.location.href);
          } catch {
            return null;
          }
        })();
        const path = parsed?.pathname || '';
        const lowerPath = path.toLowerCase();
        const lowerHref = href.toLowerCase();
        const lowerText = anchorText.toLowerCase();
        const isHashOrJs =
          href.startsWith('#') || lowerHref.startsWith('javascript:') || lowerHref.length === 0;
        const hasFileExt =
          /\.(zip|rar|7z|pdf|csv|xlsx?|docx?|pptx?|txt|json|xml|html?|md|png|jpe?g|gif|webp|mp4|mp3|wav|apk|dmg|exe)$/i.test(
            path,
          );
        const queryLooksDownload =
          /(?:[?&](download|dl|export|attachment|response-content-disposition)=)/i.test(href);
        const hrefKeyword = /\b(download|export|attachment|file)\b/i.test(href);
        const textKeyword = /\b(download|export|下载|导出)\b/i.test(anchorText);
        const likelyApiCall = /\/api(\/|$)/i.test(lowerPath) && !hasFileExt;
        // Score-based interception: only intercept high-confidence download intent.
        // This avoids one-size-fits-all behavior for normal clicks or API-triggered actions.
        let score = 0;
        if (downloadAttr !== null) score += 3;
        if (hasFileExt) score += 2;
        if (queryLooksDownload) score += 2;
        if (hrefKeyword) score += 1;
        if (textKeyword) score += 1;
        if (likelyApiCall) score -= 2;
        if (!isHashOrJs && score >= 2) {
          return {
            success: true,
            interceptedDownload: true,
            message:
              'High-confidence download click intercepted to avoid browser Save As dialog. Use extension-side download path.',
            downloadUrl: href,
            downloadFilename: (downloadAttr || '').trim() || null,
            elementInfo,
          };
        }
      }

      let navigationPromise;
      if (waitForNavigation) {
        navigationPromise = new Promise((resolve) => {
          const beforeUnloadListener = () => {
            window.removeEventListener('beforeunload', beforeUnloadListener);
            resolve(true);
          };
          window.addEventListener('beforeunload', beforeUnloadListener);

          setTimeout(() => {
            window.removeEventListener('beforeunload', beforeUnloadListener);
            resolve(false);
          }, timeout);
        });
      }

      if (
        element &&
        (elementInfo.clickMethod === 'selector' || elementInfo.clickMethod === 'ref')
      ) {
        if (double) {
          dispatchClickSequence(element, clickX, clickY, options, true);
        } else {
          dispatchClickSequence(element, clickX, clickY, options, false);
        }
      } else {
        if (double) simulateDoubleClick(clickX, clickY, options);
        else simulateClick(clickX, clickY, options);
      }

      // Wait for navigation if needed
      let navigationOccurred = false;
      if (waitForNavigation) {
        navigationOccurred = await navigationPromise;
      }

      return {
        success: true,
        message: 'Element clicked successfully',
        elementInfo,
        navigationOccurred,
      };
    } catch (error) {
      return {
        error: `Error clicking element: ${error.message}`,
      };
    }
  }

  /**
   * Simulate a mouse click at specific coordinates
   * @param {number} x - X coordinate relative to the viewport
   * @param {number} y - Y coordinate relative to the viewport
   */
  function simulateClick(x, y, options = {}) {
    const element = document.elementFromPoint(x, y);
    if (!element) return;
    dispatchClickSequence(element, x, y, options, false);
  }

  /**
   * Simulate a double click sequence at specific coordinates
   */
  function simulateDoubleClick(x, y, options = {}) {
    const element = document.elementFromPoint(x, y);
    if (!element) return;
    dispatchClickSequence(element, x, y, options, true);
  }

  /**
   * Simulate double click using element when available
   */
  function simulateDomDoubleClick(element, x, y, options) {
    dispatchClickSequence(element, x, y, options, true);
  }

  function normalizeMouseOpts(x, y, options = {}) {
    const bubbles = options.bubbles !== false; // default true
    const cancelable = options.cancelable !== false; // default true
    const altKey = !!(options.modifiers && options.modifiers.altKey);
    const ctrlKey = !!(options.modifiers && options.modifiers.ctrlKey);
    const metaKey = !!(options.modifiers && options.modifiers.metaKey);
    const shiftKey = !!(options.modifiers && options.modifiers.shiftKey);
    const btn = String(options.button || 'left');
    const button = btn === 'right' ? 2 : btn === 'middle' ? 1 : 0;
    const buttons = btn === 'right' ? 2 : btn === 'middle' ? 4 : 1;
    return {
      bubbles,
      cancelable,
      altKey,
      ctrlKey,
      metaKey,
      shiftKey,
      button,
      buttons,
      clientX: x,
      clientY: y,
      view: window,
    };
  }

  function dispatchClickSequence(element, x, y, options = {}, isDouble = false) {
    const base = normalizeMouseOpts(x, y, options);
    const pointerBase = {
      ...base,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };
    try {
      element.dispatchEvent(new PointerEvent('pointerdown', pointerBase));
    } catch {}
    const down = new MouseEvent('mousedown', base);
    const up = new MouseEvent('mouseup', base);
    const click = new MouseEvent('click', base);
    try {
      element.dispatchEvent(down);
    } catch {}
    try {
      element.dispatchEvent(up);
    } catch {}
    try {
      element.dispatchEvent(click);
    } catch {}
    try {
      element.dispatchEvent(new PointerEvent('pointerup', pointerBase));
    } catch {}
    const nativeClickable =
      element instanceof HTMLElement ||
      element instanceof SVGElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLButtonElement ||
      element instanceof HTMLAnchorElement ||
      element instanceof HTMLLabelElement;
    if (nativeClickable && typeof element.click === 'function') {
      try {
        element.click();
      } catch {}
    }
    if (base.button === 2) {
      // right button contextmenu
      const ctx = new MouseEvent('contextmenu', base);
      try {
        element.dispatchEvent(ctx);
      } catch {}
    }
    if (isDouble) {
      // second sequence + dblclick
      setTimeout(() => {
        try {
          element.dispatchEvent(new MouseEvent('mousedown', base));
        } catch {}
        try {
          element.dispatchEvent(new MouseEvent('mouseup', base));
        } catch {}
        try {
          element.dispatchEvent(new MouseEvent('click', base));
        } catch {}
        if (nativeClickable && typeof element.click === 'function') {
          try {
            element.click();
          } catch {}
        }
        try {
          element.dispatchEvent(new MouseEvent('dblclick', base));
        } catch {}
      }, 30);
    }
  }

  /**
   * Check if an element is visible
   * @param {Element} element - The element to check
   * @returns {boolean} - Whether the element is visible
   */
  function isElementVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      return false;
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const elementAtPoint = document.elementFromPoint(centerX, centerY);
    if (!elementAtPoint) return false;

    return element === elementAtPoint || element.contains(elementAtPoint);
  }

  // Listen for messages from the extension
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'clickElement') {
      clickElement(
        request.selector,
        request.waitForNavigation,
        request.timeout,
        request.coordinates,
        request.ref,
        !!request.double,
        {
          button: request.button,
          bubbles: request.bubbles,
          cancelable: request.cancelable,
          modifiers: request.modifiers,
          allowDownloadClick: request.allowDownloadClick === true,
        },
      )
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            error: `Unexpected error: ${error.message}`,
          });
        });
      return true; // Indicates async response
    } else if (request.action === 'chrome_click_element_ping') {
      sendResponse({ status: 'pong' });
      return false;
    }
  });
}
