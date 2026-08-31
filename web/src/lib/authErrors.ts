import { FirebaseError } from "firebase/app";

const FRIENDLY_ERRORS: Record<string, string> = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/email-already-in-use":
    'An account already exists with that email. If you signed up with Google before, use "Continue with Google" instead of a password.',
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/invalid-email": "That doesn't look like a valid email address.",
};

export function friendlyAuthError(err: unknown): string {
  if (err instanceof FirebaseError) return FRIENDLY_ERRORS[err.code] ?? err.message;
  return err instanceof Error ? err.message : "Something went wrong.";
}
