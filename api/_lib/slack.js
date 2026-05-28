export function escapeForSlack(input) {
  if (input == null) return "";
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildSlackPayload({ name, email, message }, mention = "") {
  const prefix = mention ? `${mention} ` : "";
  const text = [
    `${prefix}New Bonfire contact form`,
    `*Name:* ${escapeForSlack(name)}`,
    `*Email:* ${escapeForSlack(email)}`,
    `*Message:*`,
    escapeForSlack(message)
  ].join("\n");
  return { text };
}
