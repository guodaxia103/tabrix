/**
 * @fileoverview Offscreen Document Entry Point
 *
 * The offscreen document exists to:
 *   1. Keep the MV3 service worker alive (Port heartbeat to background).
 *   2. Host the GIF encoder worker.
 *
 * The semantic-similarity engine was removed as part of the MKEP pruning
 * during MKEP pruning. Any future on-device model
 * inference for Memory/Knowledge will be re-introduced from a dedicated
 * offscreen entrypoint.
 */

import { MessageTarget, type SendMessageType } from '@/common/message-types';
import { handleGifMessage } from './gif-encoder';
import { initKeepalive } from './rr-keepalive';

initKeepalive();

interface OffscreenMessage {
  target: MessageTarget | string;
  type: SendMessageType | string;
}

type MessageResponse = {
  result?: string;
  error?: string;
  success?: boolean;
};

chrome.runtime.onMessage.addListener(
  (
    message: OffscreenMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void,
  ) => {
    if (message.target !== MessageTarget.Offscreen) {
      return;
    }

    if (handleGifMessage(message, sendResponse)) {
      return true;
    }

    sendResponse({ error: `Unknown offscreen message type: ${message.type}` });
    return false;
  },
);

console.log('Offscreen: handler loaded (keepalive + gif-encoder only)');
