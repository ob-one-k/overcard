// Shared input validation for signup, admin user management and org settings.
// Each validator returns an error message string, or null when the value is valid.

function validatePassword(pw) {
  if (!pw || typeof pw !== "string" || pw.length < 8) return "Password must be at least 8 characters";
  if (pw.length > 128) return "Password must be 128 characters or less";
  if (!/[A-Z]/.test(pw)) return "Password must contain at least one uppercase letter";
  if (!/[0-9]/.test(pw)) return "Password must contain at least one digit";
  return null;
}

function validateEmail(email) {
  if (!email || typeof email !== "string") return "Email is required";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Invalid email format";
  return null;
}

function validateName(value, label) {
  if (!value || typeof value !== "string" || !value.trim()) return label + " is required";
  if (value.trim().length > 50) return label + " must be 50 characters or less";
  return null;
}

// Accepts common formats: +1 (555) 123-4567, 555.123.4567, +44 20 7946 0958
function validatePhone(phone, required) {
  if (!phone || (typeof phone === "string" && !phone.trim())) return required ? "Phone number is required" : null;
  if (typeof phone !== "string" || phone.length > 30 || !/^\+?[0-9\s().-]+$/.test(phone.trim())) return "Invalid phone number";
  var digits = phone.replace(/\D/g, "").length;
  if (digits < 7 || digits > 15) return "Phone number must have 7–15 digits";
  return null;
}

// Validates { firstName, lastName, email, phone, password } for a new account.
function validateNewUser(body) {
  return validateName(body.firstName, "First name")
    || validateName(body.lastName, "Last name")
    || validateEmail(body.email)
    || validatePhone(body.phone, true)
    || validatePassword(body.password);
}

function cleanNewUser(body) {
  return {
    firstName: body.firstName.trim(),
    lastName:  body.lastName.trim(),
    email:     body.email.toLowerCase().trim(),
    phone:     body.phone.trim(),
  };
}

// Org profile — name required on create; other fields optional, free text with length caps
var ORG_LIMITS = { name: 100, industry: 100, website: 200, phone: 30, address: 300 };

function validateOrg(fields, requireName) {
  if (requireName || fields.name !== undefined) {
    if (!fields.name || typeof fields.name !== "string" || !fields.name.trim()) return "Company name is required";
  }
  for (var k in ORG_LIMITS) {
    var v = fields[k];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string") return "Invalid " + k;
    if (v.trim().length > ORG_LIMITS[k]) return k[0].toUpperCase() + k.slice(1) + " must be " + ORG_LIMITS[k] + " characters or less";
  }
  if (fields.phone) { var pe = validatePhone(fields.phone, false); if (pe) return "Company " + pe.toLowerCase(); }
  // http(s) URL or bare domain only — rejects javascript:/data: so it's safe to render as a link later
  if (fields.website && !/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/[^\s]*)?$/i.test(fields.website.trim())) return "Invalid website";
  return null;
}

// Only the known org keys, trimmed; empty strings become null so fields can be cleared
function cleanOrg(fields) {
  var out = {};
  for (var k in ORG_LIMITS) {
    if (fields[k] === undefined) continue;
    var v = typeof fields[k] === "string" ? fields[k].trim() : fields[k];
    out[k] = v === "" ? null : v;
  }
  return out;
}

module.exports = {
  validatePassword, validateEmail, validateName, validatePhone,
  validateNewUser, cleanNewUser, validateOrg, cleanOrg,
};
