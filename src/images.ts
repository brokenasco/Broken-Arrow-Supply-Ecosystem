import { deflateSync, inflateSync } from "node:zlib";
import { DomainError } from "./policy.ts";
export interface ImageProvider {
  name: "SIMULATION" | "OPENAI";
  model: string;
  generate(
    input: { prompt: string; jobId: string },
    signal: AbortSignal,
  ): Promise<{ bytes: Buffer; reference: string; usage: object }>;
}
function crc(bytes: Buffer) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const b = Buffer.alloc(data.length + 12);
  b.writeUInt32BE(data.length);
  b.write(type, 4);
  data.copy(b, 8);
  b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4);
  return b;
}
const signature = Buffer.from("89504e470d0a1a0a", "hex");
// Validate and strip ancillary metadata; never store provider URLs or active formats.
export function png(bytes: Buffer) {
  if (
    bytes.length > 8 * 1024 * 1024 ||
    bytes.length < 45 ||
    !bytes.subarray(0, 8).equals(signature)
  )
    throw new DomainError("Invalid PNG asset");
  let offset = 8,
    width = 0,
    height = 0,
    channels = 0,
    ended = false;
  const compressed: Buffer[] = [];
  const chunks: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new DomainError("Invalid PNG chunk");
    const n = bytes.readUInt32BE(offset),
      end = offset + n + 12;
    if (end > bytes.length) throw new DomainError("Invalid PNG chunk");
    const type = bytes.toString("ascii", offset + 4, offset + 8),
      data = bytes.subarray(offset + 8, end - 4);
    if (
      crc(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
    )
      throw new DomainError("Invalid PNG checksum");
    if (offset === 8 && type !== "IHDR")
      throw new DomainError("PNG header required");
    if (type === "IHDR") {
      if (width || n !== 13) throw new DomainError("Invalid PNG header");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (
        !width ||
        !height ||
        width > 2048 ||
        height > 2048 ||
        data[8] !== 8 ||
        !channels ||
        data[10] ||
        data[11] ||
        data[12]
      )
        throw new DomainError(
          "Only non-interlaced 8-bit RGB/RGBA PNG up to 2048px is supported",
        );
      chunks.push(chunk(type, data));
    } else if (type === "IDAT") {
      compressed.push(data);
      chunks.push(chunk(type, data));
    } else if (type === "IEND") {
      if (n || end !== bytes.length)
        throw new DomainError("Invalid PNG ending");
      chunks.push(chunk(type, data));
      ended = true;
    } else if (type[0] === type[0].toUpperCase())
      throw new DomainError("Unsupported PNG critical chunk");
    offset = end;
  }
  if (!ended || !compressed.length) throw new DomainError("Incomplete PNG");
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(compressed), {
      maxOutputLength: (width * channels + 1) * height,
    });
  } catch {
    throw new DomainError("Invalid PNG pixels");
  }
  if (raw.length !== (width * channels + 1) * height)
    throw new DomainError("Invalid PNG dimensions");
  for (let y = 0; y < height; y++)
    if (raw[y * (width * channels + 1)] > 4)
      throw new DomainError("Invalid PNG filter");
  return {
    bytes: Buffer.concat([signature, ...chunks]),
    width,
    height,
    alpha: channels === 4,
  };
}
export class SimulationImageProvider implements ImageProvider {
  name = "SIMULATION" as const;
  model = "local-test-pattern-v1";
  async generate(
    _input: { prompt: string; jobId: string },
    _signal: AbortSignal,
  ) {
    const size = 128,
      raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = y * (size * 4 + 1) + 1 + x * 4;
        raw[i] = x * 2;
        raw[i + 1] = y * 2;
        raw[i + 2] = 100;
        raw[i + 3] = 255;
      }
    const h = Buffer.alloc(13);
    h.writeUInt32BE(size);
    h.writeUInt32BE(size, 4);
    h[8] = 8;
    h[9] = 6;
    return {
      bytes: Buffer.concat([
        signature,
        chunk("IHDR", h),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
      ]),
      reference: "SIMULATION",
      usage: { costCents: 0, simulation: true },
    };
  }
}
export class OpenAIImageProvider implements ImageProvider {
  name = "OPENAI" as const;
  model = "gpt-image-1";
  #key: string;
  #fetch: typeof fetch;
  constructor(key: string, transport: typeof fetch = fetch) {
    this.#key = key;
    this.#fetch = transport;
  }
  async generate(
    input: { prompt: string; jobId: string },
    signal: AbortSignal,
  ) {
    const response = await this.#fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Bearer ${this.#key}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": input.jobId,
        },
        body: JSON.stringify({
          model: this.model,
          prompt: input.prompt,
          n: 1,
          size: "1024x1024",
          quality: "low",
          output_format: "png",
          background: "opaque",
          moderation: "auto",
        }),
      },
    );
    if (!response.ok) throw new Error("IMAGE_PROVIDER_FAILED");
    if (!response.body) throw new Error("IMAGE_PROVIDER_INVALID");
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 12 * 1024 * 1024)
          throw new Error("IMAGE_PROVIDER_OVERSIZED");
        parts.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const data = JSON.parse(Buffer.concat(parts).toString("utf8"));
    const encoded = data?.data?.[0]?.b64_json;
    if (
      !Array.isArray(data?.data) ||
      data.data.length !== 1 ||
      typeof encoded !== "string" ||
      !encoded.length ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    )
      throw new Error("IMAGE_PROVIDER_INVALID");
    return {
      bytes: Buffer.from(encoded, "base64"),
      reference:
        response.headers.get("x-request-id")?.slice(0, 200) ?? input.jobId,
      usage: Object.fromEntries(
        ["input_tokens", "output_tokens", "total_tokens"]
          .filter(
            (k) => Number.isSafeInteger(data.usage?.[k]) && data.usage[k] >= 0,
          )
          .map((k) => [k, data.usage[k]]),
      ),
    };
  }
}
export function imageProvider(
  company: string,
  name: string,
): ImageProvider | null {
  if (name === "SIMULATION") return new SimulationImageProvider();
  if (
    name === "OPENAI" &&
    process.env.IMAGE_COMPANY_ID === company &&
    process.env.OPENAI_API_KEY &&
    process.env.IMAGE_GENERATION_ENABLED === "true"
  )
    return new OpenAIImageProvider(process.env.OPENAI_API_KEY);
  return null;
}
