import { conflict, invalidInput, serviceUnavailable } from "@/src/shared/errors/app-error";

const encoder = new TextEncoder();
const commonFragments = ["password", "qwerty", "admin", "festival", "computer", "1234", "abcd"];

export async function assertSecureAdminPassword(password: string, email: string): Promise<void> {
  const localPart = email.split("@")[0]?.toLowerCase() ?? "";
  const normalized = password.toLowerCase();
  const hasRequiredClasses = /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
  const hasCommonPattern = commonFragments.some((fragment) => normalized.includes(fragment)) || (localPart.length >= 4 && normalized.includes(localPart));

  if (password.length < 14 || !hasRequiredClasses || hasCommonPattern) {
    throw invalidInput("비밀번호는 14자 이상이며 영문 대·소문자, 숫자, 특수문자를 포함하고 이름·이메일·흔한 문구를 피해야 합니다.");
  }

  const digest = await crypto.subtle.digest("SHA-1", encoder.encode(password));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  let response: Response;
  try {
    response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "festival-52-password-check" },
      cache: "no-store",
    });
  } catch {
    throw serviceUnavailable("비밀번호 유출 여부를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (!response.ok) throw serviceUnavailable("비밀번호 유출 여부를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");

  const leaked = (await response.text()).split(/\r?\n/).some((line) => line.split(":")[0] === suffix);
  if (leaked) throw conflict("이미 유출된 적이 있는 비밀번호입니다. 비밀번호 관리기로 새 비밀번호를 만들어 주세요.");
}
