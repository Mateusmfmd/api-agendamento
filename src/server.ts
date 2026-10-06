import { createApp } from "./app.js";

function positivePort(value: string | undefined): number {
  const port = Number(value ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT deve ser um inteiro entre 1 e 65535");
  }
  return port;
}

function cancellationHours(value: string | undefined): number {
  const hours = Number(value ?? "24");
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error("CANCELLATION_WINDOW_HOURS deve ser um número não negativo");
  }
  return hours;
}

const host = process.env.HOST ?? "0.0.0.0";
const port = positivePort(process.env.PORT);
const windowHours = cancellationHours(process.env.CANCELLATION_WINDOW_HOURS);
const server = createApp({ cancellationWindowHours: windowHours });

server.listen(port, host, () => {
  console.log(`API de agendamento escutando em http://${host}:${port}`);
});

function shutdown(signal: string): void {
  console.log(`Recebido ${signal}; encerrando servidor...`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
