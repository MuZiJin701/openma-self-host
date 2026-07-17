interface Crypto {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

const IV_BYTES = 12;
const KEY_BYTES = 32;

/** Generic Node-side AES-GCM implementation for user secrets. */
export class WebCryptoAesGcm implements Crypto {
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(
    private readonly secret: string,
    private readonly label = "oma.secrets",
  ) {
    if (!secret) throw new Error("WebCryptoAesGcm: secret must be non-empty");
  }

  private async importKey(): Promise<CryptoKey> {
    const seed = new TextEncoder().encode(`${this.secret}|${this.label}`);
    const digest = await crypto.subtle.digest("SHA-256", seed);
    return crypto.subtle.importKey(
      "raw",
      digest.slice(0, KEY_BYTES),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  private async getKey(): Promise<CryptoKey> {
    if (!this.keyPromise) this.keyPromise = this.importKey();
    return this.keyPromise;
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await this.getKey(),
      new TextEncoder().encode(plaintext),
    );
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.byteLength);
    return encode(combined);
  }

  async decrypt(ciphertext: string): Promise<string> {
    const combined = decode(ciphertext);
    if (combined.byteLength <= IV_BYTES) {
      throw new Error("WebCryptoAesGcm.decrypt: ciphertext too short");
    }
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: combined.slice(0, IV_BYTES) },
      await this.getKey(),
      combined.slice(IV_BYTES),
    );
    return new TextDecoder().decode(plaintext);
  }
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "==".slice(0, (4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
