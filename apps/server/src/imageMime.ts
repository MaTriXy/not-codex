import Mime from "@effect/platform-node/Mime";

export const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/tiff": ".tiff",
  "image/webp": ".webp",
};

export const SAFE_IMAGE_FILE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".tiff",
  ".webp",
]);

function isBase64Char(code: number): boolean {
  return (
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b ||
    code === 0x2f ||
    code === 0x3d
  );
}

function isBase64Whitespace(code: number): boolean {
  return code === 0x0d || code === 0x0a || code === 0x20;
}

export function parseBase64DataUrl(
  dataUrl: string,
): { readonly mimeType: string; readonly base64: string } | null {
  // Do not run a regular expression across the payload: multi-megabyte data URLs
  // can make V8's RegExp engine exhaust the JavaScript call stack.
  const trimmed = dataUrl.trim();
  if (trimmed.length < 6 || trimmed.slice(0, 5).toLowerCase() !== "data:") {
    return null;
  }

  const commaIndex = trimmed.indexOf(",", 5);
  if (commaIndex < 0) {
    return null;
  }

  const headerParts: Array<string> = [];
  for (const part of trimmed.slice(5, commaIndex).split(";")) {
    const partTrimmed = part.trim();
    if (partTrimmed.length > 0) {
      headerParts.push(partTrimmed);
    }
  }
  if (headerParts.length < 2) {
    return null;
  }
  const trailingToken = headerParts.at(-1)?.toLowerCase();
  if (trailingToken !== "base64") {
    return null;
  }

  const mimeType = headerParts[0]?.toLowerCase();
  if (!mimeType) return null;

  const payload = trimmed.slice(commaIndex + 1);
  let base64Length = 0;
  let hasWhitespace = false;
  for (let index = 0; index < payload.length; index += 1) {
    const code = payload.charCodeAt(index);
    if (isBase64Char(code)) {
      base64Length += 1;
      continue;
    }
    if (!isBase64Whitespace(code)) {
      return null;
    }
    hasWhitespace = true;
  }

  if (base64Length === 0 || base64Length % 4 !== 0) {
    return null;
  }

  let base64 = payload;
  if (hasWhitespace) {
    const compacted = Buffer.allocUnsafe(base64Length);
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < payload.length; readIndex += 1) {
      const code = payload.charCodeAt(readIndex);
      if (isBase64Char(code)) {
        compacted[writeIndex] = code;
        writeIndex += 1;
      }
    }
    base64 = compacted.toString("ascii");
  }

  const firstPaddingIndex = base64.indexOf("=");
  if (
    firstPaddingIndex >= 0 &&
    (firstPaddingIndex < base64.length - 2 ||
      base64.slice(firstPaddingIndex).length > 2 ||
      !base64
        .slice(firstPaddingIndex)
        .split("")
        .every((char) => char === "="))
  ) {
    return null;
  }

  return { mimeType, base64 };
}

export function inferImageExtension(input: { mimeType: string; fileName?: string }): string {
  const key = input.mimeType.toLowerCase();
  const fromMime = Object.hasOwn(IMAGE_EXTENSION_BY_MIME_TYPE, key)
    ? IMAGE_EXTENSION_BY_MIME_TYPE[key]
    : undefined;
  if (fromMime) {
    return fromMime;
  }

  const fromMimeExtension = Mime.getExtension(input.mimeType);
  if (fromMimeExtension && SAFE_IMAGE_FILE_EXTENSIONS.has(fromMimeExtension)) {
    return fromMimeExtension;
  }

  const fileName = input.fileName?.trim() ?? "";
  const extensionMatch = /\.([a-z0-9]{1,8})$/i.exec(fileName);
  const fileNameExtension = extensionMatch ? `.${extensionMatch[1]!.toLowerCase()}` : "";
  if (SAFE_IMAGE_FILE_EXTENSIONS.has(fileNameExtension)) {
    return fileNameExtension;
  }

  return ".bin";
}
