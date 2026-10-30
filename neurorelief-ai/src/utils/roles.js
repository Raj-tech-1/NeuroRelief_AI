// Home route for each backend-verified role. UI routing only; the server enforces real access.
const ROLE_HOME = { user: '/dashboard', doctor: '/doctor', admin: '/admin' }

// Returns null for a missing or unrecognised role.
export function homeForRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_HOME, role) ? ROLE_HOME[role] : null
}
