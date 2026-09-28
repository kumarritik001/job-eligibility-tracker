declare module 'pdfkit' {
  import type { Buffer } from 'node:buffer';

  interface PDFDocumentStream {
    on(event: 'data', listener: (chunk: Buffer) => void): this;
    on(event: 'end', listener: () => void): this;
    text(text: string, options?: Record<string, unknown>): this;
    moveDown(amount?: number): this;
    addPage(options?: Record<string, unknown>): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    readonly y: number;
    readonly page: { width: number; height: number };
    end(): void;
  }

  export default class PDFDocument {
    constructor(options?: Record<string, unknown>);
    on(event: 'data', listener: (chunk: Buffer) => void): this;
    on(event: 'end', listener: () => void): this;
    text(text: string, options?: Record<string, unknown>): this;
    moveDown(amount?: number): this;
    addPage(options?: Record<string, unknown>): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    readonly y: number;
    readonly page: { width: number; height: number };
    end(): void;
  }
}
