// ============================================================================
// utils/errors.js
// Plain application error classes.
// IMPORTANT: These errors deliberately have NO MongoDB "TransientTransactionError"
// labels, so session.withTransaction() aborts immediately instead of retrying.
// ============================================================================

export class AppError extends Error {
  constructor(statusCode, code, message, details = null) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function assertPositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      `${fieldName} must be a positive integer (minor units, e.g. 100 = $1.00).`
    );
  }
}

export function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", `${fieldName} is required.`);
  }
}
