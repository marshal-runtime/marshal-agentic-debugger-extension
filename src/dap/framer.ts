import type { DapMessage } from './types.js';
import { DapFramingError } from './types.js';

/** Header separator used in DAP wire protocol. */
const HEADER_SEPARATOR = '\r\n\r\n';

/** Header field name for message length. */
const CONTENT_LENGTH_HEADER = 'Content-Length';

/** Regex to extract Content-Length value from header. */
const CONTENT_LENGTH_PATTERN = /^Content-Length:\s*(\d+)\s*$/im;

/**
 * DAP message framer implementing Content-Length based wire protocol.
 *
 * The DAP base protocol frames JSON messages with HTTP-style headers:
 *
 * ```
 * Content-Length: 119\r\n
 * \r\n
 * {"seq":1,"type":"request","command":"initialize","arguments":{"clientID":"agentic-debugger"}}
 * ```
 *
 * The framer handles both encoding (JSON → framed bytes) and decoding
 * (framed bytes → JSON messages), including buffering of partial reads.
 */
export class DapFramer {
  private buffer = Buffer.alloc(0);

  /**
   * Encode a DAP message into a Content-Length framed buffer.
   *
   * @param message - The DAP message to encode.
   * @returns Framed buffer ready for transport.
   */
  frame(message: DapMessage): Buffer {
    const json = JSON.stringify(message);
    const body = Buffer.from(json, 'utf-8');
    const header = `${CONTENT_LENGTH_HEADER}: ${body.length}${HEADER_SEPARATOR}`;
    return Buffer.concat([Buffer.from(header, 'ascii'), body]);
  }

  /**
   * Feed raw bytes into the framer and extract any complete messages.
   *
   * Handles partial reads by buffering incomplete messages until
   * enough data arrives to complete them.
   *
   * @param data - Raw bytes received from transport.
   * @returns Array of complete DAP messages parsed from the buffer.
   */
  unframe(data: Buffer): DapMessage[] {
    this.buffer = Buffer.concat([this.buffer, data]);
    const messages: DapMessage[] = [];

    while (this.buffer.length > 0) {
      const separatorIndex = this.buffer.indexOf(HEADER_SEPARATOR);
      if (separatorIndex === -1) {
        break;
      }

      const headerRaw = this.buffer.subarray(0, separatorIndex).toString('ascii');
      const match = CONTENT_LENGTH_PATTERN.exec(headerRaw);
      if (!match?.[1]) {
        throw new DapFramingError(
          `Invalid header: missing or malformed Content-Length in "${headerRaw}"`,
        );
      }

      const contentLength = parseInt(match[1], 10);
      if (contentLength < 0 || !Number.isFinite(contentLength)) {
        throw new DapFramingError(`Invalid Content-Length value: ${match[1]}`);
      }

      const bodyStart = separatorIndex + HEADER_SEPARATOR.length;
      const messageEnd = bodyStart + contentLength;

      if (this.buffer.length < messageEnd) {
        break;
      }

      const bodyRaw = this.buffer.subarray(bodyStart, messageEnd).toString('utf-8');
      this.buffer = this.buffer.subarray(messageEnd);

      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyRaw);
      } catch {
        throw new DapFramingError(`Invalid JSON body: ${bodyRaw}`);
      }

      messages.push(parsed as DapMessage);
    }

    return messages;
  }

  /**
   * Reset the framer state, clearing any buffered partial data.
   */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

export { CONTENT_LENGTH_HEADER, HEADER_SEPARATOR };
