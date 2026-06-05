import { Readable } from 'node:stream';
import { HttpError } from '../http-error';

export type MultipartFile = {
  fieldName: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
};

export type MultipartForm = {
  fields: Record<string, string>;
  files: MultipartFile[];
};

type ParseOptions = {
  maxBytes: number;
};

function getBoundary(contentType: string) {
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  return (match?.[1] || match?.[2] || '').trim();
}

async function readLimited(stream: Readable, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new HttpError(413, '上传文件过大');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function parseContentDisposition(value: string) {
  const out: Record<string, string> = {};
  value.split(';').forEach((part, index) => {
    const trimmed = part.trim();
    if (index === 0) {
      out.type = trimmed.toLowerCase();
      return;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    let val = trimmed.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    out[key] = val;
  });
  return out;
}

function trimPartPayload(part: Buffer) {
  if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
    return Buffer.from(part.subarray(0, part.length - 2));
  }
  return Buffer.from(part);
}

export async function parseMultipartForm(
  stream: Readable,
  contentType: string,
  options: ParseOptions,
): Promise<MultipartForm> {
  const boundary = getBoundary(contentType);
  if (!boundary) throw new HttpError(400, '缺少 multipart boundary');

  const raw = await readLimited(stream, options.maxBytes);
  const marker = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];

  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(marker, cursor);
    if (start < 0) break;
    const nextStart = raw.indexOf(marker, start + marker.length);
    if (nextStart < 0) break;

    let part = raw.subarray(start + marker.length, nextStart);
    if (part.subarray(0, 2).toString() === '--') break;
    if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
    part = trimPartPayload(part);

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd < 0) {
      cursor = nextStart;
      continue;
    }

    const headerText = part.subarray(0, headerEnd).toString('utf8');
    const payload = part.subarray(headerEnd + 4);
    const headers = new Map<string, string>();
    headerText.split('\r\n').forEach((line) => {
      const colon = line.indexOf(':');
      if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    });

    const disposition = parseContentDisposition(headers.get('content-disposition') || '');
    const fieldName = disposition.name || '';
    if (!fieldName) {
      cursor = nextStart;
      continue;
    }

    if (disposition.filename !== undefined) {
      files.push({
        fieldName,
        filename: disposition.filename,
        contentType: headers.get('content-type') || 'application/octet-stream',
        buffer: Buffer.from(payload),
      });
    } else {
      fields[fieldName] = payload.toString('utf8');
    }

    cursor = nextStart;
  }

  return { fields, files };
}
