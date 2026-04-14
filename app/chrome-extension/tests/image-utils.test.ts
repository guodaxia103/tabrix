import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageBitmapFromUrl } from '@/utils/image-utils';

describe('image-utils', () => {
  const createImageBitmapMock = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    createImageBitmapMock.mockReset().mockResolvedValue({ width: 1, height: 1 });
    fetchMock.mockReset();
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    vi.stubGlobal('fetch', fetchMock);
  });

  it('decodes data URLs locally without fetch', async () => {
    await createImageBitmapFromUrl('data:image/png;base64,Zm9v');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);

    const blob = createImageBitmapMock.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
  });

  it('still fetches non-data URLs', async () => {
    fetchMock.mockResolvedValue({
      blob: vi.fn().mockResolvedValue(new Blob(['bar'], { type: 'image/png' })),
    });

    await createImageBitmapFromUrl('https://example.com/test.png');

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/test.png');
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
  });
});
