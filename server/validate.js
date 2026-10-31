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
  return validateBranding(fields);
}

// Logo: raster data: URL only (no SVG — it can carry script), capped at ~300 KB.
// Accent: #rrggbb. null / "" clears either.
var LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
function validateBranding(fields) {
  if (fields.logo !== undefined && fields.logo !== null && fields.logo !== "") {
    if (typeof fields.logo !== "string" || !LOGO_RE.test(fields.logo)) return "Logo must be a PNG, JPEG or WebP image";
    if (fields.logo.length > 400000) return "Logo image is too large (max ~300 KB)";
  }
  if (fields.accentColor !== undefined && fields.accentColor !== null && fields.accentColor !== "") {
    if (typeof fields.accentColor !== "string" || !/^#[0-9a-f]{6}$/i.test(fields.accentColor)) return "Accent colour must be a hex colour like #A8FF3E";
  }
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
  ["logo", "accentColor"].forEach(function(k) {
    if (fields[k] === undefined) return;
    out[k] = fields[k] ? String(fields[k]) : null;
    if (k === "accentColor" && out[k]) out[k] = out[k].toUpperCase();
  });
  return out;
}

// ─── TEXT LIMITS ──────────────────────────────────────────────────────────────
// Mirrors LIMITS in src/lib/constants.js. Content saved before the limits existed stays as it
// is until someone edits it, so autosave of an old deck never starts failing.
var LIMITS = { cardTitle: 21, script: 180, bullet: 36, deckName: 21, stackLabel: 21, sessionName: 50, clipTitle: 50 };

function clampText(v, n) { return typeof v === "string" && v.length > n ? v.slice(0, n) : v; }

// Visible characters of a card script ({{NAME}} counts as its "[NAME]" spelling)
function scriptLength(raw) {
  if (typeof raw !== "string" || !raw) return 0;
  return raw.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*\[([^\]]+)\]/g, "$1").replace(/\*(.+?)\*/g, "$1")
    .replace(/\{\{NAME\}\}/g, "[NAME]").length;
}

function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

// Cards that are new or changed get their title and bullets cut to the limits (copies of
// older cards land here too, so cutting beats rejecting). A script edited past its limit is
// an error — the editor never sends one — unless it only got shorter.
function limitCards(cards, oldCards) {
  if (!isObj(cards)) return null;
  oldCards = isObj(oldCards) ? oldCards : {};
  for (var id in cards) {
    var c = cards[id], old = isObj(oldCards[id]) ? oldCards[id] : null;
    if (!isObj(c)) continue;
    if (typeof c.title === "string" && (!old || old.title !== c.title)) c.title = clampText(c.title, LIMITS.cardTitle);
    if (Array.isArray(c.overview)) {
      var oldOv = old && Array.isArray(old.overview) ? old.overview : [];
      c.overview = c.overview.map(function(b, i) { return typeof b === "string" && oldOv[i] !== b ? clampText(b, LIMITS.bullet) : b; });
    }
    if (typeof c.prompt === "string" && (!old || old.prompt !== c.prompt)) {
      var len = scriptLength(c.prompt);
      if (len > LIMITS.script && (!old || len > scriptLength(old.prompt))) {
        return "Card scripts can be up to " + LIMITS.script + " characters (\"" + String(c.title || "Untitled").slice(0, 40) + "\")";
      }
    }
  }
  return null;
}

// Applies the limits to a deck payload in place. existing = the stored deck (null when new).
// Returns an error message, or null.
function limitDeck(body, existing) {
  var name = typeof body.name === "string" ? body.name.trim() : body.name;
  if (typeof name === "string" && name.length > LIMITS.deckName && (!existing || (existing.name || "").trim() !== name)) {
    return "Deck names can be up to " + LIMITS.deckName + " characters";
  }
  // A brand-new deck's starting cards are a template or a copy — only cut, never reject
  var err = limitCards(body.cards, existing ? existing.cards : null);
  if (err && existing) return err;
  if (Array.isArray(body.objStacks)) {
    var oldStacks = {};
    ((existing && existing.objStacks) || []).forEach(function(st) { if (isObj(st) && st.id) oldStacks[st.id] = st; });
    for (var i = 0; i < body.objStacks.length; i++) {
      var st = body.objStacks[i], oldSt = oldStacks[st.id] || null;
      if (typeof st.label === "string" && (!oldSt || oldSt.label !== st.label)) st.label = clampText(st.label, LIMITS.stackLabel);
      var e2 = limitCards(st.cards, oldSt ? oldSt.cards : null);
      if (e2 && existing) return e2;
    }
  }
  return null;
}

module.exports = {
  validatePassword, validateEmail, validateName, validatePhone,
  validateNewUser, cleanNewUser, validateOrg, cleanOrg,
  LIMITS, clampText, scriptLength, limitDeck,
};
