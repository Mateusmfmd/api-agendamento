import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import type { AppointmentRepository } from "./types.js";
import { InMemoryAppointmentStore } from "./store.js";
import {
  ApiError,
  ensureCanCancel,
  normalizeIsoDate,
  parseDateFilter,
  parseStatus,
  validateCreatePayload,
} from "./validation.js";

const MAX_BODY_BYTES = 1_048_576;

export interface AppOptions {
  store?: AppointmentRepository;
  now?: () => Date;
  cancellationWindowHours?: number;
}

function jsonHeaders(): Record<string, string> {
  return { "content-type": "application/json; charset=utf-8" };
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, { ...jsonHeaders(), "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.statusCode, {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  });
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError(413, "BODY_TOO_LARGE", "O corpo excede o limite de 1 MB"));
        req.resume();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (body.trim() === "") {
        reject(new ApiError(400, "EMPTY_BODY", "O corpo JSON é obrigatório"));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new ApiError(400, "INVALID_JSON", "O corpo não contém JSON válido"));
      }
    });
    req.on("error", () => reject(new ApiError(400, "REQUEST_ERROR", "Falha ao ler a requisição")));
  });
}

function routeSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map(decodeURIComponent);
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: Required<Pick<AppOptions, "store" | "now" | "cancellationWindowHours">>,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const segments = routeSegments(url.pathname);

  if (method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      status: "ok",
      service: "api-agendamento",
      storage: "memory",
      timestamp: options.now().toISOString(),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/openapi.yaml") {
    const document = await readFile(new URL("../openapi.yaml", import.meta.url), "utf8");
    res.writeHead(200, {
      "content-type": "application/yaml; charset=utf-8",
      "content-length": Buffer.byteLength(document),
    });
    res.end(document);
    return;
  }

  if (method === "POST" && url.pathname === "/appointments") {
    const input = validateCreatePayload(await readJsonBody(req), options.now());
    const conflicts = options.store.findConflicts(input.startAt, input.endAt);
    if (conflicts.length > 0) {
      throw new ApiError(409, "APPOINTMENT_CONFLICT", "O horário informado já está ocupado", {
        conflictingAppointmentId: conflicts[0]?.id,
      });
    }
    sendJson(res, 201, options.store.create(input, options.now()));
    return;
  }

  if (method === "GET" && url.pathname === "/appointments") {
    const from = parseDateFilter(url.searchParams.get("from"), "from");
    const to = parseDateFilter(url.searchParams.get("to"), "to");
    if (from !== undefined && to !== undefined && from >= to) {
      throw new ApiError(400, "INVALID_FILTER", "from deve ser anterior a to");
    }
    const data = options.store.list({
      status: parseStatus(url.searchParams.get("status")),
      fromMs: from,
      toMs: to,
    });
    sendJson(res, 200, { data, total: data.length });
    return;
  }

  if (segments[0] === "appointments" && segments[1] && segments.length === 2) {
    const appointment = options.store.get(segments[1]);
    if (!appointment) {
      throw new ApiError(404, "APPOINTMENT_NOT_FOUND", "Agendamento não encontrado");
    }
    if (method === "GET") {
      sendJson(res, 200, appointment);
      return;
    }
    if (method === "DELETE") {
      ensureCanCancel(appointment, options.now(), options.cancellationWindowHours);
      sendJson(res, 200, options.store.cancel(appointment.id, options.now()));
      return;
    }
  }

  if (
    method === "POST" &&
    segments[0] === "appointments" &&
    segments[1] &&
    segments[2] === "cancel" &&
    segments.length === 3
  ) {
    const appointment = options.store.get(segments[1]);
    if (!appointment) {
      throw new ApiError(404, "APPOINTMENT_NOT_FOUND", "Agendamento não encontrado");
    }
    ensureCanCancel(appointment, options.now(), options.cancellationWindowHours);
    sendJson(res, 200, options.store.cancel(appointment.id, options.now()));
    return;
  }

  if (segments[0] === "appointments" && segments[1]) {
    res.setHeader("allow", "GET, DELETE");
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Método não permitido para esta rota");
  }
  throw new ApiError(404, "ROUTE_NOT_FOUND", "Rota não encontrada");
}

export function createApp(appOptions: AppOptions = {}): Server {
  const cancellationWindowHours = appOptions.cancellationWindowHours ?? 24;
  if (!Number.isFinite(cancellationWindowHours) || cancellationWindowHours < 0) {
    throw new Error("cancellationWindowHours deve ser um número não negativo");
  }
  const options = {
    store: appOptions.store ?? new InMemoryAppointmentStore(),
    now: appOptions.now ?? (() => new Date()),
    cancellationWindowHours,
  };
  return createServer((req, res) => {
    void handleRequest(req, res, options).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof ApiError) {
        sendError(res, error);
        return;
      }
      console.error(error);
      sendError(res, new ApiError(500, "INTERNAL_ERROR", "Erro interno do servidor"));
    });
  });
}
