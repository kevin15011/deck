import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type { DriverImageInput } from "@deck/core/session/driver";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Host paths are managed; bound reads again at the native protocol boundary. */
export function prepareImages(images: readonly DriverImageInput[] = []) {
  if (images.length > 8) throw new Error("image-input-invalid");
  let total = 0;
  return images.map(image => {
    let fd: number | undefined;
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(image.mimeType)) throw new Error();
      fd = openSync(image.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES || (total += stat.size) > 20 * 1024 * 1024) throw new Error();
      const bytes = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = readSync(fd, bytes, length, bytes.length - length, null);
        if (read === 0) break;
        length += read;
      }
      if (length !== stat.size) throw new Error();
      return { ...image, data: bytes.subarray(0, length).toString("base64") };
    } catch { throw new Error("image-input-invalid"); }
    finally { if (fd !== undefined) closeSync(fd); }
  });
}

/** Native CLIs can echo user image parts; never persist their bytes or managed paths. */
export function redactImagePayload<T>(value: T): T {
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") return item.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]*/gi, "[image omitted]");
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== "object") return item;
    const object = item as Record<string, unknown>;
    if (object.type === "image" || object.type === "localImage" || object.type === "file" && typeof object.mime === "string" && object.mime.startsWith("image/")) {
      return { type: object.type, ...(typeof object.mime === "string" ? { mime: object.mime } : {}), omitted: true };
    }
    return Object.fromEntries(Object.entries(object).map(([key, nested]) => [key, visit(nested)]));
  };
  return visit(value) as T;
}
