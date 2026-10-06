export type AppointmentStatus = "scheduled" | "cancelled";

export interface Appointment {
  id: string;
  customerName: string;
  customerEmail: string;
  startAt: string;
  endAt: string;
  notes?: string;
  status: AppointmentStatus;
  createdAt: string;
  cancelledAt?: string;
}

export interface CreateAppointmentInput {
  customerName: string;
  customerEmail: string;
  startAt: string;
  endAt: string;
  notes?: string;
}

export interface AppointmentQuery {
  status?: AppointmentStatus;
  fromMs?: number;
  toMs?: number;
}

export interface AppointmentRepository {
  create(input: CreateAppointmentInput, now: Date): Appointment;
  get(id: string): Appointment | undefined;
  list(query?: AppointmentQuery): Appointment[];
  findConflicts(startAt: string, endAt: string): Appointment[];
  cancel(id: string, cancelledAt: Date): Appointment | undefined;
}
