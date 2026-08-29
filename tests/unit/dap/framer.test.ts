import { describe, it, expect, beforeEach } from 'vitest';
import { DapFramer, CONTENT_LENGTH_HEADER, HEADER_SEPARATOR } from '../../../src/dap/framer.js';
import { DapFramingError } from '../../../src/dap/types.js';
import type { DapMessage } from '../../../src/dap/types.js';

describe('DapFramer', () => {
  let framer: DapFramer;

  beforeEach(() => {
    framer = new DapFramer();
  });

  describe('frame', () => {
    it('should encode a message with Content-Length header', () => {
      const message: DapMessage = { seq: 1, type: 'request' };
      const result = framer.frame(message);
      const str = result.toString('utf-8');

      expect(str).toContain(`${CONTENT_LENGTH_HEADER}: `);
      expect(str).toContain(HEADER_SEPARATOR);

      const json = JSON.stringify(message);
      const byteLength = Buffer.byteLength(json, 'utf-8');
      expect(str).toBe(`Content-Length: ${byteLength}\r\n\r\n${json}`);
    });

    it('should use byte length not string length for UTF-8 multi-byte characters', () => {
      const message = { seq: 1, type: 'event', event: 'output', body: { text: '日本語テスト' } } as DapMessage;
      const result = framer.frame(message);
      const str = result.toString('utf-8');

      const json = JSON.stringify(message);
      const byteLength = Buffer.byteLength(json, 'utf-8');

      expect(byteLength).toBeGreaterThan(json.length);
      expect(str).toContain(`Content-Length: ${byteLength}`);
    });
  });

  describe('unframe', () => {
    it('should decode a complete framed message', () => {
      const message: DapMessage = { seq: 1, type: 'request' };
      const framed = framer.frame(message);

      const result = framer.unframe(framed);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(message);
    });

    it('should handle partial headers across chunks', () => {
      const message: DapMessage = { seq: 2, type: 'response' };
      const framed = framer.frame(message);

      const splitPoint = 5;
      const chunk1 = framed.subarray(0, splitPoint);
      const chunk2 = framed.subarray(splitPoint);

      const result1 = framer.unframe(chunk1);
      expect(result1).toHaveLength(0);

      const result2 = framer.unframe(chunk2);
      expect(result2).toHaveLength(1);
      expect(result2[0]).toEqual(message);
    });

    it('should handle partial bodies across chunks', () => {
      const message: DapMessage = { seq: 3, type: 'event' };
      const framed = framer.frame(message);

      const json = JSON.stringify(message);
      const headerEnd = framed.indexOf('\r\n\r\n') + 4;
      const bodySplitPoint = headerEnd + Math.floor(json.length / 2);

      const chunk1 = framed.subarray(0, bodySplitPoint);
      const chunk2 = framed.subarray(bodySplitPoint);

      const result1 = framer.unframe(chunk1);
      expect(result1).toHaveLength(0);

      const result2 = framer.unframe(chunk2);
      expect(result2).toHaveLength(1);
      expect(result2[0]).toEqual(message);
    });

    it('should handle multiple messages in a single chunk', () => {
      const msg1: DapMessage = { seq: 1, type: 'request' };
      const msg2: DapMessage = { seq: 2, type: 'response' };
      const msg3: DapMessage = { seq: 3, type: 'event' };

      const combined = Buffer.concat([
        framer.frame(msg1),
        framer.frame(msg2),
        framer.frame(msg3),
      ]);

      const result = framer.unframe(combined);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(msg1);
      expect(result[1]).toEqual(msg2);
      expect(result[2]).toEqual(msg3);
    });

    it('should handle empty buffer input', () => {
      const result = framer.unframe(Buffer.alloc(0));
      expect(result).toHaveLength(0);
    });

    it('should handle UTF-8 multi-byte characters correctly in Content-Length', () => {
      const message = { seq: 1, type: 'event', event: 'output', body: { text: '🚀✨' } } as DapMessage;
      const framed = framer.frame(message);

      const result = framer.unframe(framed);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(message);
    });

    it('should throw DapFramingError for invalid Content-Length header', () => {
      const invalid = Buffer.from('Invalid-Header: 42\r\n\r\n{}');
      expect(() => framer.unframe(invalid)).toThrow(DapFramingError);
    });

    it('should throw DapFramingError for invalid JSON body', () => {
      const invalid = Buffer.from('Content-Length: 11\r\n\r\nnot-valid{}');
      expect(() => framer.unframe(invalid)).toThrow(DapFramingError);
      expect(() => framer.unframe(invalid)).toThrow('Invalid JSON body');
    });
  });

  describe('reset', () => {
    it('should clear internal buffer state', () => {
      const message: DapMessage = { seq: 1, type: 'request' };
      const framed = framer.frame(message);

      const partial = framed.subarray(0, 10);
      framer.unframe(partial);

      framer.reset();

      const result = framer.unframe(framed);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(message);
    });
  });

  describe('round-trip', () => {
    it('should correctly round-trip a complex DAP message', () => {
      const message = {
        seq: 42,
        type: 'request' as const,
        command: 'setBreakpoints',
        arguments: {
          source: { path: '/app/src/index.ts' },
          breakpoints: [{ line: 10 }, { line: 25 }],
        },
      };

      const framed = framer.frame(message);
      const result = framer.unframe(framed);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(message);
    });
  });
});
