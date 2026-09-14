export interface ElementorCaptureData {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  message: string;
  company: string;
}

export type ElementorPayloadResult =
  | { ok: true; data: ElementorCaptureData }
  | { ok: false; error: string };

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value !== "string") {
    return null;
  }
  return value.trim();
}

function invalidField(fieldName: string): ElementorPayloadResult {
  return { ok: false, error: `Invalid Elementor ${fieldName}: expected a string value` };
}

/**
 * Parse both Elementor's nested `fields` payload and the flat shape accepted
 * by direct callers. Empty/contact-free payloads are valid webhook outcomes;
 * malformed JSON, field containers, field entries, and named values are not.
 */
export function parseElementorPayload(raw: unknown): ElementorPayloadResult {
  if (!isRecord(raw)) {
    return { ok: false, error: "Invalid Elementor payload: expected an object" };
  }

  let fullName = "";
  let firstName = "";
  let lastName = "";
  let email = "";
  let phone = "";
  let message = "";
  let company = "";

  if (raw.fields !== undefined) {
    let fields: unknown = raw.fields;
    if (typeof fields === "string") {
      try {
        fields = JSON.parse(fields);
      } catch {
        return { ok: false, error: "Invalid Elementor payload: fields must be valid JSON" };
      }
    }
    if (!isRecord(fields)) {
      return { ok: false, error: "Invalid Elementor payload: fields must be an object" };
    }

    const entries = Object.entries(fields);
    for (const [key, value] of entries) {
      if (!isRecord(value)) {
        return key === "name"
          ? invalidField("name")
          : { ok: false, error: `Invalid Elementor field "${key}": expected an object` };
      }
      if (key === "name" && (!("value" in value) || stringValue(value.value) === null)) {
        return invalidField("name");
      }
      if ("value" in value && stringValue(value.value) === null) {
        return invalidField(`field "${key}"`);
      }
    }

    const fieldVal = (key: string): string => {
      const entry = fields[key];
      return isRecord(entry) && typeof entry.value === "string" ? entry.value.trim() : "";
    };

    fullName = fieldVal("name");
    email = fieldVal("email").toLowerCase();
    phone = fieldVal("field_0bb8c14");
    company = fieldVal("field_0565986");
    message = fieldVal("message");

    // Survive field-ID changes by looking at Elementor's title/type metadata.
    for (const value of Object.values(fields)) {
      if (!isRecord(value) || value.type === "acceptance") continue;
      const title = typeof value.title === "string" ? value.title.toLowerCase() : "";
      const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
      const fieldValue = typeof value.value === "string" ? value.value.trim() : "";
      if (!fieldValue) continue;

      if (!phone && (title.includes("phone") || title.includes("mobile") || title.includes("telephone"))) phone = fieldValue;
      if (!company && (title.includes("business") || title.includes("company"))) company = fieldValue;
      if (!email && (type === "email" || title.includes("email"))) email = fieldValue.toLowerCase();
      if (!fullName && (title.includes("full name") || title.includes("name"))) fullName = fieldValue;
      if (!message && (type === "textarea" || title.includes("message") || title.includes("comment"))) message = fieldValue;
    }

    const nameParts = fullName.split(/\s+/).filter(Boolean);
    firstName = nameParts[0] ?? "";
    lastName = nameParts.slice(1).join(" ");
  } else {
    const stringField = (...keys: string[]): string | null => {
      for (const key of keys) {
        if (!(key in raw)) continue;
        const value = stringValue(raw[key]);
        if (value === null) return null;
        if (value) return value;
      }
      return "";
    };

    const flatName = stringField("name", "full_name", "fullName");
    if (flatName === null) return invalidField("name");
    fullName = flatName;
    const explicitFirst = stringField("firstName", "first_name");
    if (explicitFirst === null) return invalidField("first name");
    const explicitLast = stringField("lastName", "last_name");
    if (explicitLast === null) return invalidField("last name");
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    firstName = explicitFirst || nameParts[0] || "";
    lastName = explicitLast || nameParts.slice(1).join(" ") || "";

    const flatEmail = stringField("email", "email_address");
    if (flatEmail === null) return invalidField("email");
    email = flatEmail.toLowerCase();
    const flatPhone = stringField("phone", "phone_number", "telephone", "mobile", "field_0bb8c14");
    if (flatPhone === null) return invalidField("phone");
    phone = flatPhone;
    const flatMessage = stringField("message", "msg", "comment", "comments", "inquiry", "note");
    if (flatMessage === null) return invalidField("message");
    message = flatMessage;
    const flatCompany = stringField("company", "companyName", "company_name", "business", "business_name", "field_0565986");
    if (flatCompany === null) return invalidField("company");
    company = flatCompany;

    if (!phone) {
      for (const value of Object.values(raw)) {
        if (typeof value === "string" && /^\+?[\d\s\-().]{7,20}$/.test(value.trim()) && !value.includes("@")) {
          phone = value.trim();
          break;
        }
      }
    }
  }

  return { ok: true, data: { firstName, lastName, fullName, email, phone, message, company } };
}