/* global window, document, Element, MouseEvent, PointerEvent, HTMLElement, SVGElement, HTMLInputElement, HTMLButtonElement, HTMLAnchorElement, HTMLLabelElement, HTMLTextAreaElement, HTMLSelectElement, MutationObserver, chrome */

// click-helper.js
// This script is injected into the page to handle click operations

if (window.__CLICK_HELPER_INITIALIZED__) {
  // Already initialized, skip
} else {
  window.__CLICK_HELPER_INITIALIZED__ = true;

  const SCROLL_READY_MAX_MS = 150;
  const RECT_STABLE_EPSILON_PX = 1;

  function nowMs() {
    return window.performance && typeof window.performance.now === 'function'
      ? window.performance.now()
      : Date.now();
  }

  function rectToPlain(rect) {
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    };
  }

  function rectsBasicallyEqual(left, right) {
    if (!left || !right) return false;
    return (
      Math.abs(left.left - right.left) <= RECT_STABLE_EPSILON_PX &&
      Math.abs(left.top - right.top) <= RECT_STABLE_EPSILON_PX &&
      Math.abs(left.right - right.right) <= RECT_STABLE_EPSILON_PX &&
      Math.abs(left.bottom - right.bottom) <= RECT_STABLE_EPSILON_PX &&
      Math.abs(left.width - right.width) <= RECT_STABLE_EPSILON_PX &&
      Math.abs(left.height - right.height) <= RECT_STABLE_EPSILON_PX
    );
  }

  function rectIntersectsViewport(rect) {
    return (
      rect.bottom >= 0 &&
      rect.top <= window.innerHeight &&
      rect.right >= 0 &&
      rect.left <= window.innerWidth
    );
  }

  function requestNextFrame(callback) {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(callback);
      return true;
    }
    return false;
  }

  function waitForElementReadyAfterScroll(element, { maxMs = SCROLL_READY_MAX_MS } = {}) {
    const startedAt = nowMs();
    try {
      element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
    } catch {
      return Promise.resolve({ waitedMs: 0, reason: 'scroll_failed', ready: false });
    }

    return new Promise((resolve) => {
      let lastRect = null;
      let stableFrames = 0;
      const deadline = startedAt + Math.max(0, maxMs);
      let done = false;
      let timeoutId = null;

      const finish = (reason, ready) => {
        if (done) return;
        done = true;
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        resolve({
          waitedMs: Math.max(0, Math.round(nowMs() - startedAt)),
          reason,
          ready,
          stableFrames,
        });
      };

      const check = () => {
        if (done) return;
        if (!(element instanceof Element) || !element.isConnected) {
          if (nowMs() >= deadline) {
            finish('timeout_disconnected', false);
            return;
          }
          if (!requestNextFrame(check)) finish('raf_unavailable', false);
          return;
        }

        const rect = element.getBoundingClientRect();
        const usable =
          Number.isFinite(rect.width) &&
          Number.isFinite(rect.height) &&
          rect.width > 0 &&
          rect.height > 0 &&
          rectIntersectsViewport(rect);

        if (usable && rectsBasicallyEqual(rect, lastRect)) {
          stableFrames += 1;
        } else {
          stableFrames = usable ? 1 : 0;
        }
        lastRect = rectToPlain(rect);

        if (stableFrames >= 2) {
          finish('ready', true);
          return;
        }
        if (nowMs() >= deadline) {
          finish('timeout', false);
          return;
        }
        if (!requestNextFrame(check)) finish('raf_unavailable', false);
      };

      timeoutId = setTimeout(
        () => {
          finish(
            element instanceof Element && element.isConnected ? 'timeout' : 'timeout_disconnected',
            false,
          );
        },
        Math.max(0, maxMs),
      );
      check();
    });
  }

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
        const ancestorSelector =
          'button, a[href], label, summary, option, input, textarea, select, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [onclick], [tabindex]:not([tabindex^="-"])';
        const candidateIsActionable = candidate.matches?.(ancestorSelector) === true;
        const comboAncestor = !candidateIsActionable
          ? candidate.closest?.(
              '[role="combobox"], .arco-cascader, .arco-select-view, .arco-picker, .arco-input-tag',
            ) || null
          : null;
        if (comboAncestor instanceof Element && comboAncestor !== candidate) {
          return comboAncestor;
        }
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
        const scrollWait = await waitForElementReadyAfterScroll(element);

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
          waitDiagnostics: { scroll: scrollWait },
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

        // First scroll so that the element is in view, then check visibility.
        const scrollWait = await waitForElementReadyAfterScroll(element);
        elementInfo.isVisible = isElementVisible(element);
        elementInfo.waitDiagnostics = { scroll: scrollWait };
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

      // B-023 verification window. Length depends on the caller's intent:
      //   - waitForNavigation === true  →  full `timeout` (legacy behaviour).
      //   - waitForNavigation === false →  short ~400ms window so fast-click
      //     callers still get signal without long blocking.
      // `beforeunload` short-circuits the window (we already have the verdict).
      const VERIFY_FAST_WINDOW_MS = 400;
      const verifyWindowMs = waitForNavigation
        ? Math.max(0, Number(timeout) || VERIFY_FAST_WINDOW_MS)
        : VERIFY_FAST_WINDOW_MS;

      // Page-local pre-click snapshot.
      const urlBefore = String(window.location.href || '');
      const hashBefore = String(window.location.hash || '');
      const focusBefore = document.activeElement;
      const stateBefore = snapshotTargetState(element);

      // B-023: raw signals, no verdict.
      let beforeUnloadFired = false;
      let domChanged = false;
      let domAddedDialog = false;
      let domAddedMenu = false;

      const DIALOG_SELECTOR = '[role="dialog"], [aria-modal="true"], dialog[open]';
      const MENU_SELECTOR =
        '[role="menu"]:not([aria-hidden="true"]), [role="listbox"]:not([aria-hidden="true"])';

      const beforeUnloadListener = () => {
        beforeUnloadFired = true;
      };
      window.addEventListener('beforeunload', beforeUnloadListener);

      const mutationObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList' || mutation.type === 'attributes') {
            domChanged = true;
          }
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (!(node instanceof Element)) continue;
              if (node.matches?.(DIALOG_SELECTOR) || node.querySelector?.(DIALOG_SELECTOR)) {
                domAddedDialog = true;
              }
              if (node.matches?.(MENU_SELECTOR) || node.querySelector?.(MENU_SELECTOR)) {
                domAddedMenu = true;
              }
            }
          }
        }
      });
      try {
        mutationObserver.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            'aria-expanded',
            'aria-selected',
            'aria-hidden',
            'open',
            'checked',
            'value',
            'disabled',
          ],
        });
      } catch {
        // Detached body edge case — treat the observer as absent rather than crash.
      }

      let dispatchSucceeded = false;
      try {
        if (
          element &&
          (elementInfo.clickMethod === 'selector' || elementInfo.clickMethod === 'ref')
        ) {
          if (double) {
            dispatchClickSequence(element, clickX, clickY, options, true);
          } else {
            dispatchClickSequence(element, clickX, clickY, options, false);
          }
          dispatchSucceeded = true;
        } else {
          if (double) simulateDoubleClick(clickX, clickY, options);
          else simulateClick(clickX, clickY, options);
          // coordinate-based path is best-effort; treat as dispatched iff an
          // element was resolvable at the coord.
          dispatchSucceeded = element != null;
        }
      } catch {
        dispatchSucceeded = false;
      }

      const outcomeWait = await waitForClickOutcomeWindow(verifyWindowMs, () => {
        const hrefNow = String(window.location.href || '');
        const hashNow = String(window.location.hash || '');
        if (beforeUnloadFired) return 'beforeunload';
        if (hrefNow !== urlBefore) return hashNow !== hashBefore ? 'hash_changed' : 'url_changed';
        if (hashNow !== hashBefore) return 'hash_changed';
        if (domAddedDialog) return 'dialog_opened';
        if (domAddedMenu) return 'menu_opened';
        if (diffTargetState(stateBefore, snapshotTargetState(element)) != null) {
          return 'target_state_changed';
        }
        if (!waitForNavigation && document.activeElement !== focusBefore) return 'focus_changed';
        return null;
      });

      window.removeEventListener('beforeunload', beforeUnloadListener);
      try {
        mutationObserver.disconnect();
      } catch {
        // ignore
      }

      const urlAfter = String(window.location.href || '');
      const hashAfter = String(window.location.hash || '');
      const stateAfter = snapshotTargetState(element);
      const focusChanged = document.activeElement !== focusBefore;
      const targetStateDelta = diffTargetState(stateBefore, stateAfter);

      return {
        // Compat alias for callers that only ever looked at `success`.
        // The real success verdict is computed in the background layer from
        // `signals` — see `mergeClickSignals()` in interaction.ts. A caller
        // reading `success` at this layer is getting "dispatch succeeded",
        // not "outcome verified".
        success: dispatchSucceeded,
        dispatchSucceeded,
        message: dispatchSucceeded
          ? 'Click dispatched; awaiting outcome verification in background layer'
          : 'Click dispatch failed',
        elementInfo,
        // Compat: background layer will overwrite with verification.navigationOccurred.
        navigationOccurred: beforeUnloadFired,
        signals: {
          beforeUnloadFired,
          urlBefore,
          urlAfter,
          hashBefore,
          hashAfter,
          domChanged,
          domAddedDialog,
          domAddedMenu,
          focusChanged,
          targetStateDelta,
          waitDiagnostics: {
            verification: outcomeWait,
          },
        },
      };
    } catch (error) {
      return {
        error: `Error clicking element: ${error.message}`,
      };
    }
  }

  function snapshotTargetState(element) {
    if (!(element instanceof Element)) return null;
    const get = (name) => {
      try {
        return element.getAttribute(name);
      } catch {
        return null;
      }
    };
    return {
      ariaExpanded: get('aria-expanded'),
      ariaSelected: get('aria-selected'),
      ariaPressed: get('aria-pressed'),
      ariaChecked: get('aria-checked'),
      open: get('open'),
      disabled: get('disabled'),
      checked: element instanceof HTMLInputElement ? String(element.checked) : get('checked'),
      value:
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
          ? String(element.value ?? '')
          : null,
    };
  }

  function diffTargetState(before, after) {
    if (!before || !after) return null;
    const changed = {};
    let anyChanged = false;
    for (const key of Object.keys(before)) {
      if (before[key] !== after[key]) {
        changed[key] = { before: before[key], after: after[key] };
        anyChanged = true;
      }
    }
    return anyChanged ? changed : null;
  }

  function waitForClickOutcomeWindow(ms, earlyExitCheck) {
    return new Promise((resolve) => {
      const startedAt = nowMs();
      let done = false;
      let timeoutId = null;
      const finish = (reason) => {
        if (done) return;
        done = true;
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        resolve({
          waitedMs: Math.max(0, Math.round(nowMs() - startedAt)),
          reason,
        });
      };
      const initialReason = earlyExitCheck ? earlyExitCheck() : null;
      if (initialReason) {
        finish(initialReason);
        return;
      }
      const deadline = startedAt + Math.max(0, ms);
      const tick = () => {
        if (done) return;
        const reason = earlyExitCheck ? earlyExitCheck() : null;
        if (reason) {
          finish(reason);
          return;
        }
        if (nowMs() >= deadline) {
          finish('timeout');
          return;
        }
        if (!requestNextFrame(tick)) finish('raf_unavailable');
      };
      timeoutId = setTimeout(() => finish('timeout'), Math.max(0, ms));
      tick();
    });
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
    const nativeClickable =
      element instanceof HTMLElement ||
      element instanceof SVGElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLButtonElement ||
      element instanceof HTMLAnchorElement ||
      element instanceof HTMLLabelElement;
    const useNativeClick = nativeClickable && base.button === 0;
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
      element.dispatchEvent(new PointerEvent('pointerup', pointerBase));
    } catch {}
    if (useNativeClick && typeof element.click === 'function') {
      try {
        element.click();
      } catch {}
    } else {
      try {
        element.dispatchEvent(click);
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
        if (useNativeClick && typeof element.click === 'function') {
          try {
            element.click();
          } catch {}
        } else {
          try {
            element.dispatchEvent(new MouseEvent('click', base));
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
