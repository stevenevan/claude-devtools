// Fails open (unmatched key = plaintext), so the pattern must be broad:
// over-masking a benign key is a free reveal-click, under-masking is a leak.
const SECRET_KEY_PATTERN =
  /PASSWORD|PASSWD|SECRET|CREDENTIAL|PRIVATE_KEY|PASSPHRASE|TOKEN|_KEY$|_PAT$|AUTH|API_KEY/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}
