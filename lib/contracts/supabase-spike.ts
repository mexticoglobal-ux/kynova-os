export type SupabaseSpikeStatus = "setup" | "sent" | "required" | "signed_out" | "error";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_PATTERN = /^\d{6,10}$/;

export function parseSpikeEmail(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

export function parseSpikeOtp(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const otp = value.trim();
  return OTP_PATTERN.test(otp) ? otp : null;
}
