const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContactInput(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid input" };
  }

  const { name, email, message, turnstileToken } = body;

  if (typeof name !== "string" || typeof email !== "string" ||
      typeof message !== "string" || typeof turnstileToken !== "string") {
    return { ok: false, error: "Invalid input" };
  }

  const trimmedName = name.trim();
  const trimmedMessage = message.trim();
  const trimmedToken = turnstileToken.trim();

  if (trimmedName.length < 1 || trimmedName.length > 120) {
    return { ok: false, error: "Invalid input" };
  }
  if (email.length < 3 || email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: "Invalid input" };
  }
  if (trimmedMessage.length < 1 || trimmedMessage.length > 2000) {
    return { ok: false, error: "Invalid input" };
  }
  if (trimmedToken.length < 1) {
    return { ok: false, error: "Invalid input" };
  }

  return {
    ok: true,
    value: {
      name: trimmedName,
      email,
      message: trimmedMessage,
      turnstileToken: trimmedToken
    }
  };
}
