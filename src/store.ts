import { randomUUID } from "node:crypto";
import type {
  Appointment,
  AppointmentQuery,
  AppointmentRepository,
  CreateAppointmentInput,
} from "./types.js";

function clone(appointment: Appointment): Appointment {
  return { ...appointment };
}

/** Repositório deliberadamente efêmero: os dados existem somente neste processo. */
export class InMemoryAppointmentStore implements AppointmentRepository {
  private readonly appointments = new Map<string, Appointment>();

  create(input: CreateAppointmentInput, now: Date): Appointment {
    const appointment: Appointment = {
      id: randomUUID(),
      ...input,
      status: "scheduled",
      createdAt: now.toISOString(),
    };
    this.appointments.set(appointment.id, appointment);
    return clone(appointment);
  }

  get(id: string): Appointment | undefined {
    const appointment = this.appointments.get(id);
    return appointment ? clone(appointment) : undefined;
  }

  list(query: AppointmentQuery = {}): Appointment[] {
    return [...this.appointments.values()]
      .filter((appointment) => {
        if (query.status && appointment.status !== query.status) return false;
        const startMs = Date.parse(appointment.startAt);
        const endMs = Date.parse(appointment.endAt);
        if (query.fromMs !== undefined && endMs <= query.fromMs) return false;
        if (query.toMs !== undefined && startMs >= query.toMs) return false;
        return true;
      })
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
      .map(clone);
  }

  findConflicts(startAt: string, endAt: string): Appointment[] {
    const startMs = Date.parse(startAt);
    const endMs = Date.parse(endAt);
    return [...this.appointments.values()]
      .filter((appointment) => {
        if (appointment.status !== "scheduled") return false;
        const existingStartMs = Date.parse(appointment.startAt);
        const existingEndMs = Date.parse(appointment.endAt);
        return startMs < existingEndMs && endMs > existingStartMs;
      })
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
      .map(clone);
  }

  cancel(id: string, cancelledAt: Date): Appointment | undefined {
    const appointment = this.appointments.get(id);
    if (!appointment) return undefined;
    appointment.status = "cancelled";
    appointment.cancelledAt = cancelledAt.toISOString();
    return clone(appointment);
  }
}
