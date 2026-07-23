function isSensitiveKey(key) {
  return /(?:secret|cookie|csrf|access[_-]?token|refresh[_-]?token|verification[_-]?token|encrypt[_-]?key)/i.test(
    key,
  );
}

export function redact(value, key = "") {
  if (isSensitiveKey(key) && value !== undefined && value !== null && value !== "") {
    return "<redacted>";
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redact(childValue, childKey),
      ]),
    );
  }
  return value;
}

export function emitJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(redact(value), null, 2)}\n`);
}
