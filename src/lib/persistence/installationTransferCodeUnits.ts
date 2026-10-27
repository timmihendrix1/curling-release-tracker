// Private storage representation, not encryption or application admission.
const maximum = 1048576;
export function encodeTransferCodeUnits(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > maximum) throw null;
  const chunks = ["u16:"];
  for (let offset = 0; offset < raw.length; offset += 4096) {
    let chunk = "";
    for (let i = offset; i < Math.min(raw.length, offset + 4096); i++) chunk += raw.charCodeAt(i).toString(16).padStart(4, "0");
    chunks.push(chunk);
  }
  return chunks.join("");
}
export function isTransferCodeUnits(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4 + maximum * 4 && value.startsWith("u16:") && value.length % 4 === 0 && /^[0-9a-f]*$/.test(value.slice(4));
}
export function decodeTransferCodeUnits(value: unknown): string {
  if (!isTransferCodeUnits(value)) throw null;
  const chunks: string[] = [];
  for (let offset = 4; offset < value.length; offset += 16384) {
    const codes: number[] = [];
    for (let i = offset; i < Math.min(value.length, offset + 16384); i += 4) codes.push(Number.parseInt(value.slice(i, i + 4), 16));
    chunks.push(String.fromCharCode(...codes));
  }
  return chunks.join("");
}
