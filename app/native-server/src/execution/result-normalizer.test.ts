import { normalizeToolCallResult } from './result-normalizer';

describe('normalizeToolCallResult', () => {
  it('returns success summary for normal tool results', () => {
    const normalized = normalizeToolCallResult('chrome_read_page', {
      content: [{ type: 'text', text: 'Page content loaded' }],
      isError: false,
    });

    expect(normalized.executionResult.status).toBe('success');
    expect(normalized.stepSummary).toBe('Page content loaded');
    expect(normalized.executionResult.errors).toEqual([]);
  });

  it('returns failure summary for tool errors', () => {
    const normalized = normalizeToolCallResult('chrome_read_page', {
      content: [{ type: 'text', text: 'Tab not found' }],
      isError: true,
    });

    expect(normalized.executionResult.status).toBe('failure');
    expect(normalized.errorCode).toBe('tool_call_error');
    expect(normalized.errorSummary).toBe('Tab not found');
  });
});
