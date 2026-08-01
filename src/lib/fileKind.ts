const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic"];
const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "mkv", "avi", "m4v"];

// Fed directly to a file input's `accept` attribute wherever only photos
// should be selectable — built from the same list `isImageFile` checks
// against, so the picker's filter can never drift out of sync with what
// Lockbox itself actually treats as an image.
export const IMAGE_ACCEPT = IMAGE_EXTENSIONS.map((ext) => `.${ext}`).join(",");
export const VIDEO_ACCEPT = VIDEO_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export function fileExtension(name: string): string {
  const leaf = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  return leaf.includes(".") ? leaf.split(".").pop()!.toLowerCase() : "";
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(fileExtension(name));
}

export function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.includes(fileExtension(name));
}
