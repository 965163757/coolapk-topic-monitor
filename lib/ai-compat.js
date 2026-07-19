export function isUnsupportedImageInputError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return /image_url|input_image|image input|图片输入/.test(message)
    && /unknown|unsupported|expected|not support|不支持/.test(message);
}
