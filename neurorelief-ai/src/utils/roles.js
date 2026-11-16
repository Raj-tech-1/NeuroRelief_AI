// Home route for each backend-verified role. UI routing only; the server enforces real access.
// doctor_applicant: a doctor who applied publicly and is waiting for (or was refused) admin verification.
const ROLE_HOME = { user: '/dashboard', doctor: '/doctor', doctor_applicant: '/doctor/application', admin: '/admin' }

// Returns null for a missing or unrecognised role.
export function homeForRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_HOME, role) ? ROLE_HOME[role] : null
}

// Roles that sign in through the Doctor Portal
export const DOCTOR_PORTAL_ROLES = ['doctor', 'doctor_applicant']
