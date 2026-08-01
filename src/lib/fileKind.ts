const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic"];

export function fileExtension(name: string): string {
  const leaf = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  return leaf.includes(".") ? leaf.split(".").pop()!.toLowerCase() : "";
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(fileExtension(name));
}
