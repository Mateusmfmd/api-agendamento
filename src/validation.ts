import type {
  Appointment,
  AppointmentStatus,
  CreateAppointmentInput,
} from "./types.js";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const ISO_DATE_TIME_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function normalizeIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_DATE_TIME_WITH_ZONE.test(value)) {
    throw new ApiError(
      422,
      "INVALID_DATE",
      `${field} deve ser uma data ISO 8601 com timezone explícito`,
    );
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(422, "INVALID_DATE", `${field} não é uma data válida`);
  }
  return new Date(parsed).toISOString();
}

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(422, "INVALID_FIELD", `${field} é obrigatório`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ApiError(422, "INVALID_FIELD", `${field} excede ${maxLength} caracteres`);
  }
  return trimmed;
}

export function validateCreatePayload(
  payload: unknown,
  now: Date,
): CreateAppointmentInput {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(422, "INVALID_BODY", "O corpo deve ser um objeto JSON");
  }
  const body = payload as Record<string, unknown>;
  const customerName = requireString(body.customerName, "customerName", 120);
  const customerEmail = requireString(body.customerEmail, "customerEmail", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw new ApiError(422, "INVALID_EMAIL", "customerEmail deve ser um e-mail válido");
  }

  const startAt = normalizeIsoDate(body.startAt, "startAt");
  const endAt = normalizeIsoDate(body.endAt, "endAt");
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  if (startMs <= now.getTime()) {
    throw new ApiError(422, "START_IN_PAST", "startAt deve estar no futuro");
  }
  if (endMs <= startMs) {
    throw new ApiError(422, "INVALID_INTERVAL", "endAt deve ser posterior a startAt");
  }

  let notes: string | undefined;
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string" || body.notes.length > 500) {
      throw new ApiError(422, "INVALID_FIELD", "notes deve ter no máximo 500 caracteres");
    }
    notes = body.notes.trim() || undefined;
  }

  return { customerName, customerEmail, startAt, endAt, ...(notes ? { notes } : {}) };
}

export function parseStatus(value: string | null): AppointmentStatus | undefined {
  if (value === null || value === "") return undefined;
  if (value !== "scheduled" && value !== "cancelled") {
    throw new ApiError(400, "INVALID_FILTER", "status deve ser scheduled ou cancelled");
  }
  return value;
}

export function parseDateFilter(value: string | null, field: string): number | undefined {
  if (value === null || value === "") return undefined;
  return Date.parse(normalizeIsoDate(value, field));
}

export function ensureCanCancel(
  appointment: Appointment,
  now: Date,
  cancellationWindowHours: number,
): void {
  if (appointment.status === "cancelled") {
    throw new ApiError(409, "ALREADY_CANCELLED", "O agendamento já está cancelado");
  }
  const remainingMs = Date.parse(appointment.startAt) - now.getTime();
  const minimumMs = cancellationWindowHours * 60 * 60 * 1000;
  if (remainingMs < minimumMs) {
    throw new ApiError(
      422,
      "CANCELLATION_WINDOW",
      `Cancelamentos exigem pelo menos ${cancellationWindowHours} horas de antecedência`,
      { hoursRequired: cancellationWindowHours, hoursRemaining: Math.max(0, remainingMs / 3600000) },
    );
  }
}
