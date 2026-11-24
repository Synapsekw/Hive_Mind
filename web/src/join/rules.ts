// The rules for a password a person chooses after joining. Pure, so the screen checks them
// before sending anything and the server checks them again; neither trusts the other.

export type PasswordFault = "short" | "long" | "different";

/** Fewer characters than this is refused. */
export const PASSWORD_MIN = 10;
/** The auth server's hash (bcrypt) reads this many bytes and no more. */
export const PASSWORD_MAX_BYTES = 72;

/**
 * What is wrong with a password typed twice, or null when nothing is. The length is named
 * before the difference. Nothing typed is changed: spaces count like any other character.
 */
export function checkPassword(
  password: unknown,
  repeat: unknown,
): PasswordFault | null {
  if (typeof password !== "string" || [...password].length < PASSWORD_MIN)
    return "short";
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES)
    return "long";
  if (password !== repeat) return "different";
  return null;
}
