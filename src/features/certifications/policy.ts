import { PolicyError, policyStatus } from '@/features/issues/issue-policy'

// The certifications permission choke point. Reuses the generic PolicyError/
// policyStatus from issue-policy (assert-then-throw; actions map .code →
// 403/404/400). Client-safe: this module imports NOTHING server-only. The real
// gate is the service's assert*/validation helpers on the server; the messages
// live in the service because the server actions surface them verbatim as toasts.
export { PolicyError, policyStatus }
