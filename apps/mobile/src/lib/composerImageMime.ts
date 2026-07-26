const SUPPORTED_COMPOSER_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Returns the provider-supported canonical MIME type for an image. */
export function normalizeComposerImageMimeType(value: string | null | undefined): string | null {
  const mimeType = value?.trim().toLowerCase();
  if (mimeType === "image/jpg") {
    return "image/jpeg";
  }
  return mimeType && SUPPORTED_COMPOSER_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : null;
}
