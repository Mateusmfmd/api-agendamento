import assert from "node:assert/strict";
import { request as httpRequest, type Server } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";

const NOW = new Date("2030-01-01T10:00:00.000Z");

type HttpResult = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

async function request(base: string, method: string, path: string, body?: unknown): Promise<HttpResult> {
  const url = new URL(path, base);
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method,
        headers: serialized
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(serialized) }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = text;
          try {
            parsed = JSON.parse(text);
          } catch {
            // Respostas YAML/texto permanecem string.
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (serialized) req.write(serialized);
    req.end();
  });
}

function appointmentPayload(startHours: number, durationHours = 1) {
  return {
    customerName: "Maria Silva",
    customerEmail: "MARIA@EXAMPLE.COM",
    startAt: new Date(NOW.getTime() + startHours * 3_600_000).toISOString(),
    endAt: new Date(NOW.getTime() + (startHours + durationHours) * 3_600_000).toISOString(),
    notes: "Consulta inicial",
  };
}

async function withApp(run: (base: string) => Promise<void>): Promise<void> {
  const server = createApp({ now: () => new Date(NOW), cancellationWindowHours: 24 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Servidor não obteve porta");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("health e OpenAPI são publicados", async () => {
  await withApp(async (base) => {
    const health = await request(base, "GET", "/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, {
      status: "ok",
      service: "api-agendamento",
      storage: "memory",
      timestamp: NOW.toISOString(),
    });

    const openapi = await request(base, "GET", "/openapi.yaml");
    assert.equal(openapi.status, 200);
    assert.match(String(openapi.body), /openapi: 3\.0\.3/);
    assert.match(String(openapi.body), /\/appointments:/);
  });
});

test("cria, consulta e lista agendamentos normalizados", async () => {
  await withApp(async (base) => {
    const created = await request(base, "POST", "/appointments", appointmentPayload(48));
    assert.equal(created.status, 201);
    const appointment = created.body as Record<string, unknown>;
    assert.equal(appointment.customerEmail, "maria@example.com");
    assert.equal(appointment.status, "scheduled");
    assert.equal(typeof appointment.id, "string");
    assert.equal(appointment.startAt, "2030-01-03T10:00:00.000Z");

    const fetched = await request(base, "GET", `/appointments/${appointment.id}`);
    assert.equal(fetched.status, 200);
    assert.deepEqual(fetched.body, appointment);

    const listed = await request(base, "GET", "/appointments?status=scheduled");
    assert.equal(listed.status, 200);
    assert.equal((listed.body as { total: number }).total, 1);
  });
});

test("impede sobreposição, mas permite intervalos adjacentes", async () => {
  await withApp(async (base) => {
    const first = await request(base, "POST", "/appointments", appointmentPayload(48));
    assert.equal(first.status, 201);

    const conflict = await request(base, "POST", "/appointments", appointmentPayload(48.5, 1));
    assert.equal(conflict.status, 409);
    assert.equal((conflict.body as { error: { code: string } }).error.code, "APPOINTMENT_CONFLICT");

    const adjacent = await request(base, "POST", "/appointments", appointmentPayload(49));
    assert.equal(adjacent.status, 201);
  });
});

test("valida payload e filtros", async () => {
  await withApp(async (base) => {
    const invalid = await request(base, "POST", "/appointments", {
      customerName: "",
      customerEmail: "not-an-email",
      startAt: "2030-01-03T10:00:00",
      endAt: "2030-01-03T09:00:00Z",
    });
    assert.equal(invalid.status, 422);

    const invalidFilter = await request(base, "GET", "/appointments?status=unknown");
    assert.equal(invalidFilter.status, 400);

    const first = await request(base, "POST", "/appointments", appointmentPayload(48));
    assert.equal(first.status, 201);
    const outside = await request(
      base,
      "GET",
      "/appointments?from=2030-01-04T00:00:00Z",
    );
    assert.equal(outside.status, 200);
    assert.equal((outside.body as { total: number }).total, 0);
  });
});

test("aplica janela de cancelamento e marca o status", async () => {
  await withApp(async (base) => {
    const tooLate = await request(base, "POST", "/appointments", appointmentPayload(12));
    const tooLateId = (tooLate.body as { id: string }).id;
    const rejected = await request(base, "DELETE", `/appointments/${tooLateId}`);
    assert.equal(rejected.status, 422);
    assert.equal((rejected.body as { error: { code: string } }).error.code, "CANCELLATION_WINDOW");

    const cancellable = await request(base, "POST", "/appointments", appointmentPayload(48));
    const cancellableId = (cancellable.body as { id: string }).id;
    const cancelled = await request(base, "POST", `/appointments/${cancellableId}/cancel`);
    assert.equal(cancelled.status, 200);
    assert.equal((cancelled.body as { status: string }).status, "cancelled");
    assert.equal((cancelled.body as { cancelledAt: string }).cancelledAt, NOW.toISOString());

    const repeated = await request(base, "DELETE", `/appointments/${cancellableId}`);
    assert.equal(repeated.status, 409);
    const cancelledList = await request(base, "GET", "/appointments?status=cancelled");
    assert.equal((cancelledList.body as { total: number }).total, 1);
  });
});

test("retorna 404 para agendamento inexistente", async () => {
  await withApp(async (base) => {
    const response = await request(base, "GET", "/appointments/not-found");
    assert.equal(response.status, 404);
    assert.equal((response.body as { error: { code: string } }).error.code, "APPOINTMENT_NOT_FOUND");
  });
});
