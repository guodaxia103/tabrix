import { describe, expect, it } from 'vitest';
import { buildNavigateUrlPatterns } from '../entrypoints/background/tools/browser/common';

describe('buildNavigateUrlPatterns', () => {
  it('does not add www variants for localhost', () => {
    const patterns = buildNavigateUrlPatterns('http://localhost:12306/demo');

    expect(patterns).toContain('http://localhost:12306/*');
    expect(patterns).not.toContain('http://www.localhost:12306/*');
  });

  it('does not add www variants for IPv4 hosts', () => {
    const patterns = buildNavigateUrlPatterns('http://127.0.0.1:8080/demo');

    expect(patterns).toContain('http://127.0.0.1:8080/*');
    expect(patterns).not.toContain('http://www.127.0.0.1:8080/*');
  });

  it('does not add www variants for IPv6 hosts', () => {
    const patterns = buildNavigateUrlPatterns('http://[::1]:8080/demo');

    expect(patterns).toContain('http://[::1]:8080/*');
    expect(patterns).not.toContain('http://www.[::1]:8080/*');
  });

  it('still adds www variants for normal hostnames', () => {
    const patterns = buildNavigateUrlPatterns('https://example.com/docs');

    expect(patterns).toContain('https://example.com/*');
    expect(patterns).toContain('https://www.example.com/*');
    expect(patterns).toContain('http://example.com/*');
    expect(patterns).toContain('http://www.example.com/*');
  });
});
