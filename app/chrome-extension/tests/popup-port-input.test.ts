import { describe, expect, it } from 'vitest';
import { resolvePopupPortUpdate } from '@/common/popup-port-input';

describe('popup port input guard', () => {
  it('ignores edits while the popup is busy', () => {
    expect(
      resolvePopupPortUpdate({
        currentPort: 12306,
        nextValue: '4567',
        allowEdit: false,
      }),
    ).toBe(12306);
  });

  it('applies edits once the popup is idle', () => {
    expect(
      resolvePopupPortUpdate({
        currentPort: 12306,
        nextValue: '4567',
        allowEdit: true,
      }),
    ).toBe(4567);
  });
});
