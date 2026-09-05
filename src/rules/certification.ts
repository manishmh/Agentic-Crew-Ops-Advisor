/**
 * RULE-CERT-06 — all certifications must be valid on the duty date (2H).
 *
 * Matches validate.py: a certification is expired iff valid_to < duty date
 * (calendar-date string comparison). valid_from is intentionally NOT
 * evaluated — the dataset carries future valid_from values (e.g. C-1042's
 * licence from 2030) while validate.py judges expiry only.
 */

import type { Certification, CertificationType, DateStr } from "../domain/types.js";
import type { RuleCheck } from "./evidence.js";

export const CERT_RULE_ID = "RULE-CERT-06";

export interface CertStatusEvidence {
  certType: CertificationType;
  validTo: DateStr;
  dutyDate: DateStr;
  valid: boolean;
}

export interface CertificationEvidence {
  ruleId: typeof CERT_RULE_ID;
  legal: boolean;
  dutyDate: DateStr;
  certs: CertStatusEvidence[];
  expired: CertificationType[];
  violation?: string;
}

export function checkCertificationsOnDate(
  certs: readonly Certification[],
  dutyDate: DateStr,
): RuleCheck<CertificationEvidence> {
  const statuses: CertStatusEvidence[] = certs.map((c) => ({
    certType: c.certType,
    validTo: c.validTo,
    dutyDate,
    valid: !(c.validTo < dutyDate),
  }));
  const expired = statuses.filter((s) => !s.valid).map((s) => s.certType);
  const legal = expired.length === 0;
  return {
    ruleId: CERT_RULE_ID,
    passed: legal,
    evidence: {
      ruleId: CERT_RULE_ID,
      legal,
      dutyDate,
      certs: statuses,
      expired,
      violation: legal
        ? undefined
        : `RULE-CERT-06 breached on ${dutyDate}: expired certification(s) [${expired.join(", ")}]`,
    },
  };
}
