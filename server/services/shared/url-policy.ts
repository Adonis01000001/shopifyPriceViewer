import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(normalized);

  if (version === 0) return true;

  if (version === 4) {
    const parts = normalized.split(".").map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) {
      return true;
    }
    const [first, second, third] = parts;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 0 || second === 168)) ||
      (first === 198 &&
        (second === 18 || second === 19 || (second === 51 && third === 100))) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }

  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    if (isIP(mappedIpv4) === 4) return isPrivateAddress(mappedIpv4);
  }

  const ipv6Parts = normalized.split("::");
  if (ipv6Parts.length <= 2) {
    const left = ipv6Parts[0] ? ipv6Parts[0].split(":") : [];
    const right = ipv6Parts[1] ? ipv6Parts[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    if (missing >= 0) {
      const groups = [
        ...left,
        ...Array.from({ length: missing }, () => "0"),
        ...right,
      ].map(group => Number.parseInt(group, 16));
      if (
        groups.length === 8 &&
        groups.slice(0, 5).every(group => group === 0) &&
        groups[5] === 0xffff
      ) {
        const mappedIpv4 = [
          groups[6] >> 8,
          groups[6] & 0xff,
          groups[7] >> 8,
          groups[7] & 0xff,
        ].join(".");
        return isPrivateAddress(mappedIpv4);
      }
    }
  }

  return (
    /^f[cd]/.test(normalized) ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

export async function assertPublicUrl(urlValue: string): Promise<void> {
  const url = new URL(urlValue);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Private network targets are not allowed");
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(entry => isPrivateAddress(entry.address))
  ) {
    throw new Error("Private network targets are not allowed");
  }
}
